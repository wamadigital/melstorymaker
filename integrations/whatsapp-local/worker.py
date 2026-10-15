"""Consome a fila da Mel por HTTPS e envia pelo MCP local, sem porta pública."""

import argparse
import asyncio
import hashlib
import fcntl
import json
import logging
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from uuid import UUID

import requests
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".whatsapp-local/state"
ORIGIN = "https://melstorymaker.com.br"
LOG = logging.getLogger("mel-whatsapp-worker")


def unexpired(job: dict, now: datetime | None = None) -> bool:
    expires = datetime.fromisoformat(job["expiresAt"].replace("Z", "+00:00"))
    return expires.tzinfo is not None and expires > (now or datetime.now(timezone.utc))


LEGACY_JOB_FIELDS = ("id", "leaseToken", "recipient", "message", "expiresAt")
SEQUENCE_DELAYS = (0, 2, 3, 2)


def message_parts(job: dict) -> list[dict]:
    """Valida o contrato inteiro antes de autorizar qualquer chamada de envio."""
    if not isinstance(job, dict) or not set(LEGACY_JOB_FIELDS).issubset(job) or set(job) - {
        *LEGACY_JOB_FIELDS, "messagesSequence"
    }:
        raise ValueError("invalid_job")
    for field in ("id", "leaseToken"):
        if not isinstance(job[field], str):
            raise ValueError("invalid_job")
        UUID(job[field])
    recipient = job["recipient"]
    if not isinstance(recipient, str) or not recipient.isascii() or not recipient.isdigit() or not (
        recipient.startswith("55") and len(recipient) in (12, 13)
    ):
        raise ValueError("invalid_job")
    if not isinstance(job["expiresAt"], str):
        raise ValueError("invalid_job")
    expires = datetime.fromisoformat(job["expiresAt"].replace("Z", "+00:00"))
    if expires.tzinfo is None:
        raise ValueError("invalid_job")

    def valid_text(value) -> bool:
        if not isinstance(value, str) or not value.strip() or len(value) > 4000:
            return False
        try:
            value.encode("utf-8")
            return True
        except UnicodeError:
            return False

    if not valid_text(job["message"]):
        raise ValueError("invalid_job")
    if "messagesSequence" not in job:
        return [{"message": job["message"], "delayBeforeSeconds": 0}]
    sequence = job["messagesSequence"]
    if not isinstance(sequence, list) or len(sequence) != len(SEQUENCE_DELAYS):
        raise ValueError("invalid_sequence")
    for part, delay in zip(sequence, SEQUENCE_DELAYS):
        if not isinstance(part, dict) or set(part) != {"message", "delayBeforeSeconds"} or not valid_text(part["message"]):
            raise ValueError("invalid_sequence")
        if type(part["delayBeforeSeconds"]) is not int or part["delayBeforeSeconds"] != delay:
            raise ValueError("invalid_sequence")
    return sequence


class Ledger:
    """Guarda somente IDs/hash/estado; não guarda telefone, texto ou conversas."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS pending_acks (id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('sent','indeterminate')))")
        self.db.commit()

    @staticmethod
    def digest(job: dict) -> str:
        value = [job["recipient"], job["message"]]
        if "messagesSequence" in job:
            value.extend(["messages_sequence_v2", [
                [part["message"], part["delayBeforeSeconds"]] for part in job["messagesSequence"]
            ]])
        return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()

    def get(self, job: dict) -> str | None:
        row = self.db.execute("SELECT digest,state FROM jobs WHERE id=?", (job["id"],)).fetchone()
        if not row:
            return None
        if row[0] != self.digest(job):
            return "indeterminate"
        return row[1]

    def set(self, job: dict, state: str) -> None:
        outcome = "sent" if state == "sent" else "indeterminate"
        # Estado e recibo são um só commit: crash nunca perde o ACK pendente.
        with self.db:
            self.db.execute("INSERT INTO jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state", (job["id"], self.digest(job), state))
            self.db.execute("INSERT INTO pending_acks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET lease_token=excluded.lease_token,outcome=excluded.outcome", (job["id"], job["leaseToken"], outcome))

    def pending(self) -> list[dict]:
        return [
            {"id": row[0], "leaseToken": row[1], "outcome": row[2]}
            for row in self.db.execute("SELECT id,lease_token,outcome FROM pending_acks ORDER BY id")
        ]

    def acknowledged(self, ack: dict) -> None:
        with self.db:
            self.db.execute("DELETE FROM pending_acks WHERE id=? AND lease_token=? AND outcome=?", (ack["id"], ack["leaseToken"], ack["outcome"]))

    def close(self) -> None:
        self.db.close()


class API:
    def __init__(self, token: str):
        if len(token) < 32:
            raise ValueError("Token do worker inválido")
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers["Authorization"] = "Bearer " + token
        self.session.headers["X-Mel-Worker-Protocol"] = "2"

    async def post(self, path: str, body: dict) -> dict:
        def request():
            response = self.session.post(ORIGIN + path, json=body, timeout=(5, 20), allow_redirects=False)
            response.raise_for_status()
            return response.json()
        return await asyncio.to_thread(request)

    async def claim(self) -> dict:
        return await self.post("/api/integracoes/whatsapp/reivindicar", {})

    async def result(self, job: dict, outcome: str, code: str | None = None) -> dict:
        body = {"leaseToken": job["leaseToken"], "outcome": outcome}
        if code:
            body["code"] = code
        return await self.post("/api/integracoes/whatsapp/" + job["id"] + "/resultado", body)


class LocalMCP:
    def __init__(self, session: ClientSession):
        self.session = session

    async def ready(self) -> bool:
        def check():
            direct = requests.Session()
            direct.trust_env = False
            token = (STATE / "bridge-token").read_text().strip()
            try:
                response = direct.get("http://127.0.0.1:18281/api/status", headers={"Authorization": "Bearer " + token}, timeout=(3, 3), allow_redirects=False)
                response.raise_for_status()
                value = response.json()
                return value.get("connected") is True and value.get("simulation") is False
            finally:
                direct.close()
        return await asyncio.to_thread(check)

    async def send(self, job: dict) -> bool:
        result = await asyncio.wait_for(self.session.call_tool("send_message", {"recipient": job["recipient"], "message": job["message"]}), timeout=35)
        if result.isError or not result.content:
            return False
        value = json.loads(result.content[0].text)
        return value.get("success") is True


async def report_ack(api, ledger: Ledger, ack: dict) -> bool:
    response = await api.result(ack, ack["outcome"])
    if response.get("accepted") is not True:
        return False
    ledger.acknowledged(ack)
    return True


async def reconcile(api, ledger: Ledger) -> None:
    """Repete apenas resultados; não reivindica jobs nem chama o MCP."""
    for ack in ledger.pending():
        try:
            if not await report_ack(api, ledger, ack):
                LOG.warning("Resultado local ainda não confirmado pelo sistema")
        except Exception:
            LOG.warning("Resultado local pendente de reconciliação")


async def report_job(api, ledger: Ledger, job: dict, outcome: str) -> None:
    await report_ack(api, ledger, {"id": job["id"], "leaseToken": job["leaseToken"], "outcome": outcome})


async def process(api, mcp, ledger: Ledger, job: dict, *, sleep=asyncio.sleep, clock=None) -> str:
    try:
        parts = message_parts(job)
    except (ValueError, TypeError, OverflowError):
        return "invalid_job"

    def still_unexpired() -> bool:
        return unexpired(job, clock()) if clock is not None else unexpired(job)

    previous = ledger.get(job)
    if previous:
        outcome = "sent" if previous == "sent" else "indeterminate"
        ledger.set(job, outcome)
        await report_job(api, ledger, job, outcome)
        return "reconciled"
    if not still_unexpired():
        return "expired"
    try:
        ready = await mcp.ready()
    except Exception:
        ready = False
    if not ready:
        await api.result(job, "failed", "bridge_disconnected")
        return "not_connected"
    # Se o servidor não confirmar a elegibilidade, não chama WhatsApp.
    accepted = await api.result(job, "started")
    if accepted.get("accepted") is not True:
        return "rejected"
    # O registro antecede o envio. Crash/timeout não permitem repetir o envio.
    ledger.set(job, "started")
    expired_after_start = False
    try:
        sent = still_unexpired()
        expired_after_start = not sent
        for index, part in enumerate(parts):
            if not sent:
                break
            if index:
                # A pausa começa somente depois do ACK de sucesso anterior.
                await sleep(part["delayBeforeSeconds"])
                if not still_unexpired() or not await mcp.ready():
                    sent = False
                    break
                # Revalida flag, coluna, telefone, corte e lease antes de cada parte.
                accepted = await api.result(job, "started")
                if accepted.get("accepted") is not True or not still_unexpired():
                    sent = False
                    break
            single = {field: job[field] for field in LEGACY_JOB_FIELDS}
            single["message"] = part["message"]
            sent = await mcp.send(single) is True
    except asyncio.CancelledError:
        # O shutdown não espera rede: o recibo fica para a próxima reconciliação.
        ledger.set(job, "indeterminate")
        raise
    except Exception:
        sent = False
    outcome = "sent" if sent else "indeterminate"
    ledger.set(job, outcome)
    await report_job(api, ledger, job, outcome)
    return "expired_after_start" if expired_after_start else outcome


async def iteration(api, mcp, ledger: Ledger) -> str:
    # Recibos independem do claim: o servidor nunca devolve jobs já iniciados.
    # Esta sequência é serial sob o flock mantido por run(), inclusive no restart.
    await reconcile(api, ledger)
    # Sessão offline não deve reservar jobs nem consumir suas cinco tentativas.
    try:
        ready = await mcp.ready()
    except Exception:
        ready = False
    if not ready:
        return "not_connected"
    claim = await api.claim()
    if claim.get("active") is not True:
        return "inactive"
    if claim.get("job"):
        return await process(api, mcp, ledger, claim["job"])
    return "idle"


async def run(once: bool) -> None:
    config = json.loads((STATE / "worker-config.json").read_text())
    if config.get("enabled") is not True:
        LOG.info("Worker desativado na configuração local")
        return
    lock_file = (STATE / "worker.lock").open("a")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        LOG.info("Já existe um worker ativo neste Mac")
        return
    token = (STATE / "worker-token").read_text().strip()
    api = API(token)
    ledger = Ledger(STATE / "worker-ledger.db")
    params = StdioServerParameters(command="/bin/bash", args=[str(ROOT / "integrations/whatsapp-local/run-mcp.sh")], cwd=str(ROOT), env=os.environ.copy())
    try:
        # Mesmo um MCP indisponível no restart não bloqueia recibos já gravados.
        await reconcile(api, ledger)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                if [tool.name for tool in tools.tools] != ["send_message"]:
                    raise RuntimeError("Ferramentas MCP divergem da instalação aprovada")
                mcp = LocalMCP(session)
                while True:
                    try:
                        result = await iteration(api, mcp, ledger)
                        if result == "inactive":
                            LOG.info("Automação desativada no sistema")
                        elif result != "idle":
                            LOG.info("Job processado: %s", result)
                    except Exception:
                        # Nunca escrever resposta/telefone/texto/token nos logs.
                        LOG.warning("Fila indisponível ou resultado pendente de reconciliação")
                    if once:
                        break
                    await asyncio.sleep(60)
    finally:
        ledger.close()
        api.session.close()
        lock_file.close()


if __name__ == "__main__":
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.once))
