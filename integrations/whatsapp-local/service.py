"""Prepara ou instala LaunchAgents locais; instalar exige sessão já pareada."""

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

import prepare as preparation

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
    except BaseException:
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


def canonical_root(home: Path) -> Path:
    return Path(home).resolve() / "Library/Application Support/MelStorymaker/WhatsApp"


def verify_source(root: Path) -> None:
    preparation.verify_manifest(root / ".whatsapp-local/app")


def stopped(domain: str, runner) -> None:
    for label in LABELS:
        result = runner(["print", f"{domain}/{label}"])
        if result.returncode == 0:
            raise ServiceError("Pare somente os dois serviços desta instalação antes de realocar")
        if result.returncode != 113:
            raise ServiceError("Não foi possível confirmar a parada dos serviços")


def owned_plists(root: Path, directory: Path) -> dict[Path, bytes]:
    if directory.is_symlink() or directory.parent.is_symlink():
        raise ServiceError("Diretório de LaunchAgents não regular")
    originals = {}
    for label, expected in plans(root).items():
        file = directory / f"{label}.plist"
        if file.is_symlink() or not file.is_file():
            raise ServiceError("Realocação exige os dois plists originais desta instalação")
        data = file.read_bytes()
        try:
            value = plistlib.loads(data)
        except Exception:
            raise ServiceError("Plist existente inválido; não substituir") from None
        if value != expected:
            raise ServiceError("Plist pertence a outra configuração; não substituir")
        originals[file] = data
    return originals


@contextmanager
def source_quiet(root: Path):
    file = root / ".whatsapp-local/state/worker.lock"
    lock = None
    try:
        fd = os.open(file, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        lock = os.fdopen(fd, "r+")
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ServiceError("Worker foreground ainda ativo; não copiar sessão") from None
        yield
    finally:
        if lock is not None:
            lock.close()


def copy_regular(source: Path, target: Path, mode: int | None = None) -> None:
    if source.is_symlink() or not source.is_file():
        raise ServiceError("Arquivo obrigatório ausente ou não regular na origem")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copy2(source, target)
    if mode is not None:
        target.chmod(mode)


def copy_tree(source: Path, target: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise ServiceError("Diretório obrigatório ausente ou não regular na origem")
    # Materializa apenas links internos; nenhum link aponta de volta ao projeto.
    for file in source.rglob("*"):
        if file.is_symlink() and not file.resolve().is_relative_to(source.resolve()):
            raise ServiceError("Dependência contém link externo; realocação recusada")
    shutil.copytree(source, target, symlinks=False, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def bundle(root: Path, staged: Path, final: Path) -> None:
    """Cópia mínima independente: nenhuma execução, rede ou alteração da origem."""
    runtime = root / ".whatsapp-local"
    output = staged / ".whatsapp-local"
    source_scripts = root / "integrations/whatsapp-local"
    scripts = staged / "integrations/whatsapp-local"
    names = [
        "run-bridge.sh", "run-mcp.sh", "run-worker.sh", "worker.py", "service.py",
        "prepare.py", "compat.py", "local_server.go", "local_server_test.go",
        "local_activity.go", "local_activity_test.go",
    ]
    for name in names:
        copy_regular(source_scripts / name, scripts / name)
    copy_tree(source_scripts / "dependencies", scripts / "dependencies")
    for name in (*preparation.APP_FILES, preparation.MANIFEST_NAME):
        copy_regular(runtime / "app" / name, output / "app" / name)
    copy_regular(runtime / "bin/whatsapp-bridge", output / "bin/whatsapp-bridge", 0o700)
    old_venv = runtime / "app/whatsapp-mcp-server/.venv"
    interpreter = (old_venv / "bin/python").resolve(strict=True)
    python_home = interpreter.parent.parent
    if not python_home.is_relative_to(runtime / "toolchain/python"):
        raise ServiceError("Python da origem não pertence à instalação privada")
    if not interpreter.name.startswith("python3."):
        raise ServiceError("Interpretador privado inesperado")
    copy_tree(python_home, output / "toolchain/python")
    venv = output / "app/whatsapp-mcp-server/.venv"
    copy_tree(old_venv / "lib", venv / "lib")
    for file in (venv / "lib").rglob("*.pth"):
        if str(root) in file.read_text():
            raise ServiceError("Pacote Python mantém referência executável ao projeto original")
    (venv / "bin").mkdir(mode=0o700)
    (venv / "bin/python").symlink_to("../../../../toolchain/python/bin/" + interpreter.name)
    for name in ("python3", interpreter.name):
        (venv / "bin" / name).symlink_to("python")
    final_python = final / ".whatsapp-local/toolchain/python/bin"
    (venv / "pyvenv.cfg").write_text(
        f"home = {final_python}\ninclude-system-site-packages = false\n"
    )
    state = output / "state"
    state.mkdir(mode=0o700)
    for name in ("bridge-token", "worker-token", "worker-config.json"):
        copy_regular(runtime / "state" / name, state / name, 0o600)
    session = runtime / "state/store/whatsapp.db"
    if not session.is_file() or session.stat().st_size == 0:
        raise ServiceError("Sessão pareada ausente; não realocar")
    # Inclui WAL/SHM, sem histórico de mensagens, QR, logs ou locks antigos.
    for base in ("store/whatsapp.db", "worker-ledger.db"):
        for suffix in ("", "-wal", "-shm", "-journal"):
            source = runtime / "state" / (base + suffix)
            if source.exists():
                copy_regular(source, state / (base + suffix), 0o600)
    marker = {
        "version": 1,
        "source_installation": hashlib.sha256(str(root).encode()).hexdigest(),
        "source_manifest": hashlib.sha256((runtime / "app" / preparation.MANIFEST_NAME).read_bytes()).hexdigest(),
        "labels": list(LABELS),
    }
    (staged / ".mel-relocated.json").write_text(json.dumps(marker, sort_keys=True) + "\n")
    for file in staged.rglob("*"):
        if file.is_symlink():
            # O pyvenv.cfg usa o destino final, mas os aliases são relativos.
            if file.readlink().is_absolute() or not file.resolve().is_relative_to(staged):
                raise ServiceError("Runtime mantém link para fora do pacote")


def python_probe(target: Path) -> None:
    executable = target / ".whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python"
    script = (
        "import pathlib,sys,sysconfig; "
        "r=pathlib.Path(sys.argv[1]).resolve(); "
        "assert pathlib.Path(sys.executable).resolve().is_relative_to(r); "
        "assert pathlib.Path(sys.base_prefix).resolve()==r/'.whatsapp-local/toolchain/python'; "
        "assert all(pathlib.Path(p).resolve().is_relative_to(r) for p in sysconfig.get_paths().values()); "
        "import mcp,requests,pydantic,cryptography,ssl,sqlite3"
    )
    result = subprocess.run(
        [str(executable), "-I", "-c", script, str(target)], cwd=target,
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise ServiceError("Python realocado falhou no teste offline; serviços não serão iniciados")


def wait_paired(target: Path, timeout: int = 30) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if paired(target):
            return True
        time.sleep(1)
    return False


def replace_owned(file: Path, expected: bytes, data: bytes) -> None:
    if file.is_symlink() or not file.is_file() or file.read_bytes() != expected:
        raise ServiceError("Plist mudou durante a realocação; não substituir")
    fd, temporary = tempfile.mkstemp(prefix=".mel-relocate-", dir=file.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
        os.replace(temporary, file)
    finally:
        Path(temporary).unlink(missing_ok=True)


def relocate(root: Path = ROOT, home: Path | None = None, *, runner=launchctl,
             source_verifier=verify_source, probe=python_probe,
             free_port=port_free, readiness=wait_paired) -> Path:
    root = Path(root).resolve()
    home = Path.home() if home is None else Path(home).resolve()
    target = canonical_root(home)
    directory = home / "Library/LaunchAgents"
    domain = f"gui/{os.getuid()}"
    if target.exists() or target.is_symlink():
        raise ServiceError("Destino já existe; não substituir sessão realocada")
    if not enabled(root):
        raise ServiceError("Configuração local precisa de enabled:true")
    source_verifier(root)
    originals = owned_plists(root, directory)
    stopped(domain, runner)
    if not free_port():
        raise ServiceError("Bridge foreground ainda ativo; não copiar sessão")
    parent = target.parent
    ancestor = parent
    while ancestor != home:
        if ancestor.is_symlink():
            raise ServiceError("Diretório de destino não regular")
        ancestor = ancestor.parent
    private_directory(parent)
    temporary = Path(tempfile.mkdtemp(prefix=".whatsapp-relocating-", dir=parent))
    staged = temporary / "WhatsApp"
    staged.mkdir(mode=0o700)
    published = False
    changed = []
    attempted = []
    try:
        with source_quiet(root):
            bundle(root, staged, target)
            source_verifier(root)
            stopped(domain, runner)
            if not free_port() or owned_plists(root, directory) != originals:
                raise ServiceError("Instalação de origem mudou durante a cópia; interrompido")
            staged.rename(target)
            published = True
            probe(target)
            for label, (file, original) in zip(LABELS, originals.items()):
                data = plistlib.dumps(plans(target)[label])
                # Registrar antes da mutação: Ctrl+C pode vir após os.replace.
                changed.append((file, original, data))
                replace_owned(file, original, data)
            attempted.append(LABELS[0])
            if runner(["bootstrap", domain, str(directory / f"{LABELS[0]}.plist")]).returncode != 0:
                raise ServiceError("Não foi possível iniciar o bridge realocado")
            if not readiness(target):
                raise ServiceError("Bridge realocado não confirmou sessão autenticada")
            attempted.append(LABELS[1])
            if runner(["bootstrap", domain, str(directory / f"{LABELS[1]}.plist")]).returncode != 0:
                raise ServiceError("Não foi possível iniciar o worker realocado")
    except BaseException:
        incomplete = False
        for label in reversed(attempted):
            try:
                if runner(["bootout", f"{domain}/{label}"]).returncode not in (0, 113):
                    incomplete = True
            except Exception:
                incomplete = True
        for file, original, replacement in reversed(changed):
            try:
                if not file.is_symlink() and file.is_file() and file.read_bytes() == original:
                    continue
                replace_owned(file, replacement, original)
            except Exception:
                incomplete = True
        if published and not incomplete and not attempted:
            shutil.rmtree(target)
        # Após iniciar qualquer serviço, preservar sua cópia da sessão/ledger:
        # ela já pode ter sido atualizada; nunca fazer um rollback silencioso dela.
        if incomplete:
            raise ServiceError("Realocação interrompida; revisar rollback dos próprios serviços") from None
        raise ServiceError("Realocação interrompida; origem preservada e plists próprios restaurados") from None
    finally:
        shutil.rmtree(temporary)
    return target


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--prepare", action="store_true")
    actions.add_argument("--install", action="store_true")
    actions.add_argument("--relocate", action="store_true")
    arguments = parser.parse_args()
    try:
        if arguments.relocate:
            relocate()
            print("Runtime e serviços realocados para Application Support; esta cópia agora é canônica")
        elif arguments.install:
            install()
            print("LaunchAgents instalados para este login; pareamento automático permanece bloqueado")
        else:
            prepare()
            print("Plists preparados somente no runtime; nenhum LaunchAgent instalado ou iniciado")
    except ServiceError as error:
        raise SystemExit(str(error)) from None
    except (EOFError, KeyboardInterrupt):
        raise SystemExit("Preparação/instalação recusada ou interrompida; nenhum segredo foi exibido")
