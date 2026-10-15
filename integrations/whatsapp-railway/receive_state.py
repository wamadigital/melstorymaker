"""Importa estado privado por stdin; nunca ativa serviços nem envia mensagens."""

import ctypes
import errno
import fcntl
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile

PAYLOAD_FILES = frozenset({
    "bridge-token", "worker-token", "worker-config.json", "worker-ledger.db",
    "store/whatsapp.db", "store/activity.db", "store/messages.db", ".cloud-ready.json",
})
MANIFEST_NAME = "IMPORT-MANIFEST.json"
ALLOWED_FILES = PAYLOAD_FILES | {MANIFEST_NAME}
MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024


class ImportRejected(ValueError):
    """Erro sanitizado, sem caminhos ou conteúdo do estado importado."""


class _LimitedReader:
    def __init__(self, stream):
        self.stream = stream
        self.total = 0

    def read(self, size=-1):
        remaining = MAX_DECOMPRESSED_BYTES - self.total
        amount = min(64 * 1024, remaining + 1, size if size >= 0 else remaining + 1)
        data = self.stream.read(amount)
        self.total += len(data)
        if self.total > MAX_DECOMPRESSED_BYTES:
            raise ImportRejected("import_rejected")
        return data


class _RegularTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive):
        # Rejeitar também os cabeçalhos PAX/GNU antes de tarfile ocultá-los
        # como metadados de outro membro. O pacote é só USTAR de arquivos.
        if self.type not in (tarfile.REGTYPE, tarfile.AREGTYPE) or self.linkname:
            raise ImportRejected("import_rejected")
        return super()._proc_member(archive)


def _exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _rename_without_replacement(source: Path, destination: Path) -> None:
    """Commit atômico que nunca substitui nem um diretório vazio concorrente."""
    library = ctypes.CDLL(None, use_errno=True)
    if sys.platform.startswith("linux"):
        rename = library.renameat2
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        arguments = (-100, os.fsencode(source), -100, os.fsencode(destination), 1)
    elif sys.platform == "darwin":
        rename = library.renamex_np
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        arguments = (os.fsencode(source), os.fsencode(destination), 4)
    else:
        raise ImportRejected("import_rejected")
    rename.restype = ctypes.c_int
    if rename(*arguments) != 0:
        raise OSError(ctypes.get_errno() or errno.EIO, "atomic_import_failed")


def _verify_manifest(staging: Path, actual: dict) -> None:
    raw = (staging / MANIFEST_NAME).read_bytes()
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ImportRejected("import_rejected")
    manifest = json.loads(raw)
    if (type(manifest) is not dict or set(manifest) != {"version", "files"}
            or type(manifest["version"]) is not int or manifest["version"] != 1
            or type(manifest["files"]) is not list or len(manifest["files"]) != len(PAYLOAD_FILES)):
        raise ImportRejected("import_rejected")
    declared = {}
    for entry in manifest["files"]:
        if (type(entry) is not dict or set(entry) != {"path", "size", "sha256"}
                or type(entry["path"]) is not str or entry["path"] not in PAYLOAD_FILES
                or entry["path"] in declared or type(entry["size"]) is not int
                or not 0 <= entry["size"] <= MAX_DECOMPRESSED_BYTES
                or type(entry["sha256"]) is not str or len(entry["sha256"]) != 64
                or any(character not in "0123456789abcdef" for character in entry["sha256"])):
            raise ImportRejected("import_rejected")
        declared[entry["path"]] = {"size": entry["size"], "sha256": entry["sha256"]}
    if set(declared) != PAYLOAD_FILES or declared != actual:
        raise ImportRejected("import_rejected")


def receive(stream, data: Path, validator) -> dict:
    """Recebe tar.gz, valida e publica /state; validator não deve iniciar clientes."""
    data = Path(data)
    staging = None
    lock = None
    try:
        if data.is_symlink() or not data.is_dir() or (data == Path("/data") and not data.is_mount()):
            raise ImportRejected("import_rejected")
        destination = data / "state"
        activation = data / "enable-cloud"
        if _exists(destination) or _exists(activation):
            raise ImportRejected("import_rejected")
        descriptor = os.open(data / ".receive-state.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        lock = os.fdopen(descriptor, "r+b")
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if _exists(destination) or _exists(activation):
            raise ImportRejected("import_rejected")
        staging = Path(tempfile.mkdtemp(prefix=".state-import-", dir=data))
        staging.chmod(0o700)
        seen = set()
        actual = {}
        with gzip.GzipFile(fileobj=stream, mode="rb") as compressed:
            limited = _LimitedReader(compressed)
            with tarfile.open(fileobj=limited, mode="r|", bufsize=512, tarinfo=_RegularTarInfo) as archive:
                for member in archive:
                    name = member.name
                    if (name not in ALLOWED_FILES or name in seen or member.size < 0
                            or member.size > MAX_DECOMPRESSED_BYTES or member.pax_headers
                            or (name == MANIFEST_NAME and member.size > MAX_MANIFEST_BYTES)):
                        raise ImportRejected("import_rejected")
                    seen.add(name)
                    path = staging / name
                    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    path.parent.chmod(0o700)
                    digest = hashlib.sha256()
                    copied = 0
                    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(descriptor, "wb") as output, archive.extractfile(member) as contents:
                        while chunk := contents.read(64 * 1024):
                            copied += len(chunk)
                            digest.update(chunk)
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if copied != member.size:
                        raise ImportRejected("import_rejected")
                    if name != MANIFEST_NAME:
                        actual[name] = {"size": copied, "sha256": digest.hexdigest()}
                # Ler até EOF verifica CRC/truncamento gzip e limita todo o
                # descomprimido; após EOF TAR só há padding zero, não outro tar.
                while trailing := archive.fileobj.read(64 * 1024):
                    if trailing.strip(b"\x00"):
                        raise ImportRejected("import_rejected")
        if seen != ALLOWED_FILES:
            raise ImportRejected("import_rejected")
        _verify_manifest(staging, actual)
        validator(staging)
        if _exists(destination) or _exists(activation):
            raise ImportRejected("import_rejected")
        _rename_without_replacement(staging, destination)
        staging = None
        return {"state": "imported", "files": len(PAYLOAD_FILES)}
    except Exception:
        raise ImportRejected("import_rejected") from None
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        if lock is not None:
            lock.close()


def main() -> None:
    try:
        spec = importlib.util.spec_from_file_location("mel_cloud_import_validation", "/app/integrations/whatsapp-railway/cloud.py")
        if spec is None or spec.loader is None:
            raise ImportRejected("import_rejected")
        cloud = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cloud)
        if PAYLOAD_FILES != set(cloud.REQUIRED) | {".cloud-ready.json"}:
            raise ImportRejected("import_rejected")
        result = receive(sys.stdin.buffer, Path("/data"), cloud.validate_state)
        print(json.dumps(result, sort_keys=True), flush=True)
    except Exception:
        print('{"state":"rejected","code":"import_rejected"}', file=sys.stderr, flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
