"""Supervisor privado do bridge/MCP existentes. Não cria nem envia mensagens."""

import argparse
from contextlib import closing
import fcntl
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[2]
DATA = Path("/data")
REQUIRED = (
    "bridge-token", "worker-token", "worker-config.json", "worker-ledger.db",
    "store/whatsapp.db", "store/activity.db", "store/messages.db",
)
SCHEMAS = {
    "worker-ledger.db": {"jobs": {"id", "digest", "state"}, "pending_acks": {"id", "lease_token", "outcome"}},
    "store/whatsapp.db": {"whatsmeow_device": {"jid"}},
    "store/activity.db": {"activity": {"contact_hash", "event_hash", "job_hash", "at"}},
    "store/messages.db": {"chats": {"jid"}, "messages": {"id"}},
}


def validate_state(state: Path) -> None:
    """Recusa importações incompletas sem registrar o conteúdo privado."""
    for directory in (state, state / "store"):
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_mode & 0o077:
            raise ValueError("invalid_state")
    marker = state / ".cloud-ready.json"
    if marker.is_symlink() or not marker.is_file():
        raise ValueError("missing_import_marker")
    if marker.stat().st_mode & 0o077:
        raise ValueError("state_not_private")
    if json.loads(marker.read_text()) != {"version": 1}:
        raise ValueError("invalid_import_marker")
    for name in REQUIRED:
        path = state / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("incomplete_import")
        if path.stat().st_mode & 0o077:
            raise ValueError("state_not_private")
    for name in ("bridge-token", "worker-token"):
        token = (state / name).read_text().strip()
        if len(token) < 32 or any(not "!" <= character <= "~" for character in token):
            raise ValueError("invalid_token")
    config = json.loads((state / "worker-config.json").read_text())
    if config.get("enabled") is not True:
        raise ValueError("worker_disabled")
    for name, tables in SCHEMAS.items():
        with closing(sqlite3.connect((state / name).resolve().as_uri() + "?mode=ro", uri=True)) as db:
            if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise ValueError("invalid_database")
            for table, required_columns in tables.items():
                # Tabelas são constantes locais, nunca interpolação do import.
                columns = {row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
                if not required_columns.issubset(columns):
                    raise ValueError("invalid_schema")
            if name == "store/whatsapp.db" and not db.execute(
                "SELECT EXISTS(SELECT 1 FROM whatsmeow_device WHERE jid IS NOT NULL AND jid<>'')"
            ).fetchone()[0]:
                raise ValueError("missing_session")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def bridge_connected(state: Path) -> bool:
    try:
        token = (state / "bridge-token").read_text().strip()
        request = Request("http://127.0.0.1:18281/api/status", headers={"Authorization": "Bearer " + token})
        # O bridge nunca passa por proxies, redirecionamentos ou rede pública.
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=2) as response:
            status = json.loads(response.read(4096))
        return status.get("connected") is True and status.get("simulation") is False
    except Exception:
        return False


def stop_process(process: subprocess.Popen | None) -> None:
    """Encerra o grupo inteiro, inclusive o MCP stdio filho do worker."""
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    except ProcessLookupError:
        pass


def health_handler(status: dict):
    class Health(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/healthz":
                self.send_error(404)
                return
            # Liveness do supervisor, não da conexão do WhatsApp. Uma queda de
            # rede não deve reiniciar o container nem zerar cobertura em loop.
            body = json.dumps({
                "phase": status["phase"],
                "bridgeConnected": status["bridgeConnected"] is True,
                "workerRunning": status["workerRunning"] is True,
            }, sort_keys=True).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass
    return Health


def run(data: Path = DATA, root: Path = ROOT) -> None:
    os.umask(0o077)
    if data == DATA and not data.is_mount():
        raise RuntimeError("persistent_volume_required")
    data.mkdir(mode=0o700, parents=True, exist_ok=True)
    state = data / "state"
    status = {"phase": "awaiting_import", "bridgeConnected": False, "workerRunning": False}
    stopped = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stopped.set())
    lock = (data / "cloud.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        lock.close()
        raise RuntimeError("cloud_already_running") from error
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), health_handler(status))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bridge = worker = None
    try:
        while not stopped.is_set():
            if not (state / ".cloud-ready.json").exists():
                status["phase"] = "awaiting_import"
            elif not (data / "enable-cloud").is_file():
                status["phase"] = "disabled"
            else:
                validate_state(state)
                status["phase"] = "connecting"
                # Filhos não publicam QR, JIDs ou erros do SDK nos logs Railway.
                child_env = os.environ.copy()
                for name in ("MEL_WHATSAPP_PAIRING", "MEL_WHATSAPP_SIMULATION"):
                    child_env.pop(name, None)
                bridge = subprocess.Popen(
                    ["/bin/bash", str(root / "integrations/whatsapp-local/run-bridge.sh")],
                    cwd=root, env=child_env, start_new_session=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                break
            stopped.wait(2)
        while bridge is not None and not stopped.is_set():
            if not (data / "enable-cloud").is_file():
                status["phase"] = "disabled"
                break
            if bridge.poll() is not None:
                raise RuntimeError("bridge_stopped")
            connected = bridge_connected(state)
            status["bridgeConnected"] = connected
            if worker is None and connected:
                worker = subprocess.Popen(
                    ["/bin/bash", str(root / "integrations/whatsapp-local/run-worker.sh")],
                    cwd=root, env=child_env, start_new_session=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            if worker is not None and worker.poll() is not None:
                raise RuntimeError("worker_stopped")
            status["workerRunning"] = worker is not None
            status["phase"] = "running" if connected and worker is not None else "connecting"
            stopped.wait(3)
    finally:
        # Primeiro a fila/MCP; depois a sessão. O ledger persistente conserva
        # started/indeterminate e ACKs pendentes conforme o protocolo existente.
        try:
            stop_process(worker)
        finally:
            try:
                stop_process(bridge)
            finally:
                status.update(phase="stopped", bridgeConnected=False, workerRunning=False)
                server.shutdown()
                server.server_close()
                lock.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            validate_state(DATA / "state")
            print('{"state":"valid"}')
        else:
            run()
    except Exception:
        # Nenhum traceback: uma exceção de I/O pode carregar caminho/segredo.
        print('{"phase":"failed","code":"cloud_runtime_unavailable"}', flush=True)
        raise SystemExit(1)
