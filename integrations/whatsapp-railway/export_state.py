"""Exporta estado privado parado para migração; não inicia nem altera serviços."""

import argparse
from contextlib import closing
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import tempfile


_SPEC = importlib.util.spec_from_file_location("mel_cloud_export_validation", Path(__file__).with_name("cloud.py"))
cloud = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cloud)
REQUIRED = cloud.REQUIRED
MANIFEST = "IMPORT-MANIFEST.json"
MARKER = ".cloud-ready.json"


def _path(value: Path, *, must_exist: bool) -> Path:
    """Não segue aliases do filesystem nem aceita travessia por componentes."""
    value = Path(value)
    if ".." in value.parts:
        raise ValueError("invalid_path")
    absolute = value.absolute()
    for component in reversed((absolute, *absolute.parents)):
        if component.is_symlink():
            raise ValueError("symlink_not_allowed")
    if must_exist and not absolute.exists():
        raise ValueError("missing_path")
    return absolute


def _private_directory(path: Path) -> None:
    _path(path, must_exist=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("directory_not_private")


def _regular(path: Path) -> os.stat_result:
    _path(path, must_exist=True)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("file_not_private_regular")
    return info


def _fingerprint(info: os.stat_result) -> tuple:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _copy_readonly(source: Path, destination: Path) -> None:
    before = _regular(source)
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if _fingerprint(os.fstat(source_fd)) != _fingerprint(before):
            raise ValueError("source_changed")
        destination_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(destination_fd, "wb") as output:
            with os.fdopen(source_fd, "rb", closefd=False) as origin:
                shutil.copyfileobj(origin, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        if _fingerprint(os.fstat(source_fd)) != _fingerprint(before) or _fingerprint(source.lstat()) != _fingerprint(before):
            raise ValueError("source_changed")
    finally:
        os.close(source_fd)


def _write_private(path: Path, value: dict) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, sort_keys=True, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())


def _backup_database(snapshot: Path, destination: Path) -> None:
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(descriptor)
    # O snapshot privado pode conter WAL. Abrir a origem real em mode=ro ainda
    # poderia escrever SHM; somente esta cópia temporária é aberta pelo SQLite.
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(destination)) as target:
            source.backup(target)
            target.execute("PRAGMA journal_mode=DELETE")


def export_state(source: Path, output: Path) -> dict:
    """Exige bridge e worker parados; o flock confirma a exclusão do worker."""
    source = _path(source, must_exist=True)
    output = _path(output, must_exist=False)
    _private_directory(source)
    _private_directory(source / "store")
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("output_must_be_new")
    if output == source or source in output.parents or output in source.parents:
        raise ValueError("overlapping_paths")
    for name in REQUIRED:
        if Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError("invalid_allowlist")
        _regular(source / name)
    lock_path = source / "worker.lock"
    _regular(lock_path)
    lock_fd = os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW)
    created_output = False
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("worker_running") from error

        output.mkdir(mode=0o700)
        created_output = True
        (output / "store").mkdir(mode=0o700)
        with tempfile.TemporaryDirectory(prefix=".mel-state-snapshot-", dir=output.parent) as temporary:
            staging = Path(temporary)
            (staging / "store").mkdir(mode=0o700)
            observations = {}
            for name in REQUIRED:
                path = source / name
                observations[path] = _fingerprint(_regular(path))
                _copy_readonly(path, staging / name)
                if name.endswith(".db"):
                    for suffix in ("-wal", "-shm", "-journal"):
                        sidecar = Path(str(path) + suffix)
                        if sidecar.exists() or sidecar.is_symlink():
                            observations[sidecar] = _fingerprint(_regular(sidecar))
                            _copy_readonly(sidecar, Path(str(staging / name) + suffix))
            for path, observed in observations.items():
                if _fingerprint(_regular(path)) != observed:
                    raise ValueError("source_changed")
            # Detecta um WAL/journal que surgiu depois de copiar o respectivo DB.
            for name in REQUIRED:
                if name.endswith(".db"):
                    for suffix in ("-wal", "-shm", "-journal"):
                        sidecar = Path(str(source / name) + suffix)
                        if sidecar not in observations and (sidecar.exists() or sidecar.is_symlink()):
                            raise ValueError("source_changed")
            for name in REQUIRED:
                if name.endswith(".db"):
                    _backup_database(staging / name, output / name)
                else:
                    _copy_readonly(staging / name, output / name)
        _write_private(output / MARKER, {"version": 1})
        cloud.validate_state(output)
        paths = sorted((*REQUIRED, MARKER))
        manifest = {
            "version": 1,
            "files": [{
                "path": name, "size": (output / name).stat().st_size,
                "sha256": hashlib.sha256((output / name).read_bytes()).hexdigest(),
            } for name in paths],
        }
        _write_private(output / MANIFEST, manifest)
        return {"state": "exported", "fileCount": len(paths)}
    except Exception:
        if created_output:
            shutil.rmtree(output)
        raise
    finally:
        os.close(lock_fd)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        result = export_state(arguments.source, arguments.output)
    except Exception:
        print('{"state":"failed","code":"state_export_unavailable"}')
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
