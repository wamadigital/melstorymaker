"""Prepara ou instala LaunchAgents locais; instalar exige sessão já pareada."""

import argparse
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LABELS = ("com.melstorymaker.whatsapp.bridge", "com.melstorymaker.whatsapp.worker")


class ServiceError(RuntimeError):
    pass


def plans(root: Path) -> dict[str, dict]:
    root = Path(root).resolve()
    state = root / ".whatsapp-local/state"
    result = {}
    for label, name in zip(LABELS, ("bridge", "worker")):
        result[label] = {
            "Label": label,
            "ProgramArguments": ["/bin/bash", str(root / f"integrations/whatsapp-local/run-{name}.sh")],
            "WorkingDirectory": str(root),
            "RunAtLoad": True,
            "KeepAlive": True,
            "ThrottleInterval": 30,
            "ProcessType": "Background",
            "Umask": 0o077,
            "StandardOutPath": str(state / f"{name}-service.stdout.log"),
            "StandardErrorPath": str(state / f"{name}-service.stderr.log"),
        }
    return result


def private_directory(path: Path) -> None:
    if path.is_symlink():
        raise ServiceError("Diretório privado não pode ser um link simbólico")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_mode & 0o077:
        raise ServiceError("Diretório local precisa de permissões privadas (700)")


def prepare(root: Path = ROOT) -> dict[str, Path]:
    root = Path(root).resolve()
    runtime = root / ".whatsapp-local"
    private_directory(runtime)
    private_directory(runtime / "state")
    directory = runtime / "launchagents"
    private_directory(directory)
    files = {}
    for label, configuration in plans(root).items():
        fd, name = tempfile.mkstemp(prefix=".plist-", dir=directory)
        try:
            with os.fdopen(fd, "wb") as output:
                plistlib.dump(configuration, output)
            destination = directory / f"{label}.plist"
            if destination.is_symlink():
                raise ServiceError("Plist preparado não pode ser um link simbólico")
            os.replace(name, destination)
            files[label] = destination
        finally:
            Path(name).unlink(missing_ok=True)
    return files


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def paired(root: Path) -> bool:
    try:
        token = (root / ".whatsapp-local/state/bridge-token").read_text().strip()
        if len(token) < 32 or any(not 33 <= ord(value) <= 126 for value in token):
            return False
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        request = urllib.request.Request(
            "http://127.0.0.1:18281/api/status",
            headers={"Authorization": "Bearer " + token},
        )
        with opener.open(request, timeout=3) as response:
            if response.status != 200:
                return False
            value = json.load(response)
        return value.get("connected") is True and value.get("simulation") is False
    except Exception:
        return False


def port_free() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(1)
        return connection.connect_ex(("127.0.0.1", 18281)) != 0


def launchctl(arguments: list[str]):
    return subprocess.run(
        ["/bin/launchctl", *arguments], capture_output=True, text=True, timeout=15,
    )


def collisions(directory: Path, domain: str, runner) -> None:
    if directory.is_symlink() or directory.parent.is_symlink():
        raise ServiceError("LaunchAgents não pode ser um link simbólico")
    for label in LABELS:
        path = directory / f"{label}.plist"
        if path.exists() or path.is_symlink():
            raise ServiceError(f"LaunchAgent já existe: {label}; nenhuma substituição autorizada")
        result = runner(["print", f"{domain}/{label}"])
        if result.returncode == 0:
            raise ServiceError(f"Serviço já carregado: {label}; não será alterado")
        if result.returncode != 113:
            raise ServiceError("Não foi possível confirmar ausência dos serviços no launchd")


def handoff() -> None:
    input("Pare somente o bridge iniciado manualmente. Pressione Enter após ele encerrar: ")


def enabled(root: Path) -> bool:
    try:
        return json.loads((root / ".whatsapp-local/state/worker-config.json").read_text()).get("enabled") is True
    except Exception:
        return False


def install(root: Path = ROOT, home: Path | None = None, *, runner=launchctl,
            readiness=paired, wait_handoff=handoff, free_port=port_free) -> None:
    root = Path(root).resolve()
    home = Path.home() if home is None else Path(home).resolve()
    if not enabled(root):
        raise ServiceError("Instalação recusada: configuração local precisa de enabled:true")
    if not readiness(root):
        raise ServiceError("Instalação recusada: WhatsApp precisa estar pareado, conectado e fora de simulação")
    configurations = plans(root)
    for configuration in configurations.values():
        if not Path(configuration["ProgramArguments"][1]).is_file():
            raise ServiceError("Wrapper local ausente; não instalar serviços")
    directory = home / "Library/LaunchAgents"
    domain = f"gui/{os.getuid()}"
    collisions(directory, domain, runner)
    # Readiness é comprovado uma vez nesta invocação; o foreground sai depois.
    wait_handoff()
    if not free_port():
        raise ServiceError("Bridge foreground ainda está ativo; não instalar serviços")
    if not enabled(root):
        raise ServiceError("Instalação recusada: configuração local foi desativada durante o handoff")
    collisions(directory, domain, runner)
    prepared = prepare(root)
    created = []
    attempted = []
    identities = {}
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Criar todos antes do bootstrap; O_EXCL preserva qualquer colisão tardia.
        for label in LABELS:
            path = directory / f"{label}.plist"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            identity = os.fstat(fd)
            identities[path] = (identity.st_dev, identity.st_ino)
            with os.fdopen(fd, "wb") as output:
                output.write(prepared[label].read_bytes())
        for label, path in zip(LABELS, created):
            attempted.append(label)
            result = runner(["bootstrap", domain, str(path)])
            if result.returncode != 0:
                raise ServiceError(f"Bootstrap recusado: {label}")
    except Exception:
        incomplete = False
        # Um bootstrap que perdeu a resposta também precisa de rollback. Todos
        # estes labels estavam ausentes e foram tentados com plists criados aqui.
        for label in reversed(attempted):
            try:
                if runner(["bootout", f"{domain}/{label}"]).returncode not in (0, 113):
                    incomplete = True
            except Exception:
                incomplete = True
        for path in created:
            try:
                identity = path.lstat()
                if (identity.st_dev, identity.st_ino) == identities[path]:
                    path.unlink()
                else:
                    incomplete = True
            except FileNotFoundError:
                pass
        if incomplete:
            raise ServiceError("Instalação interrompida; rollback do próprio serviço exige revisão") from None
        raise ServiceError("Instalação interrompida; somente os próprios arquivos e serviços foram revertidos") from None


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--prepare", action="store_true")
    actions.add_argument("--install", action="store_true")
    arguments = parser.parse_args()
    try:
        if arguments.install:
            install()
            print("LaunchAgents instalados para este login; pareamento automático permanece bloqueado")
        else:
            prepare()
            print("Plists preparados somente no runtime; nenhum LaunchAgent instalado ou iniciado")
    except ServiceError as error:
        raise SystemExit(str(error)) from None
    except (EOFError, KeyboardInterrupt):
        raise SystemExit("Preparação/instalação recusada ou interrompida; nenhum segredo foi exibido")
