"""Cria um contexto privado somente com fontes permitidas, sem sessão ou .env.

O mesmo diretório isolado deve ser usado no Docker e no upload da Railway.
Não executa shell, não lê arquivos fora da lista e não inicia serviços.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile

ROOT = Path(__file__).resolve().parents[2]
IGNORE_PATH = "integrations/whatsapp-railway/Dockerfile.dockerignore"
MANIFEST_NAME = "SOURCE-MANIFEST.json"


def _regular_source(root: Path, relative: str) -> Path:
    source = root / relative
    for component in (source, *source.parents):
        if component == root:
            break
        if component.is_symlink():
            raise RuntimeError(f"Fonte permitida não pode ser symlink: {relative}")
    if not source.is_file() or not stat.S_ISREG(source.stat().st_mode):
        raise RuntimeError(f"Fonte permitida ausente ou não regular: {relative}")
    return source


def allowlisted_files(root: Path) -> tuple[list[str], str]:
    """Docker e empacotador compartilham a mesma lista explícita de arquivos."""
    text = _regular_source(root, IGNORE_PATH).read_text(encoding="utf-8")
    rules = [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]
    if not rules or rules[0] != "**":
        raise RuntimeError("Contexto exige exclusão padrão de todos os arquivos")
    files = []
    for rule in rules[1:]:
        if not rule.startswith("!integrations/"):
            raise RuntimeError("Regra fora das integrações permitidas")
        relative = rule[1:]
        parts = PurePosixPath(relative).parts
        if any(character in relative for character in "*?[]\\") or any(part in (".", "..") for part in parts):
            raise RuntimeError("Contexto exige caminhos explícitos sem padrões ou traversal")
        if relative.endswith("/"):
            continue
        _regular_source(root, relative)
        if relative in files:
            raise RuntimeError("Arquivo duplicado na lista do contexto")
        files.append(relative)
    if IGNORE_PATH not in files or not files:
        raise RuntimeError("Filtro do contexto precisa constar na própria lista")
    return sorted(files), text


def create_context(root: Path = ROOT, output: Path | None = None) -> Path:
    root = Path(root).resolve(strict=True)
    files, ignore = allowlisted_files(root)
    if output is None:
        target = Path(tempfile.mkdtemp(prefix="mel-whatsapp-context-"))
    else:
        target = Path(output).absolute()
        # Não reutilizar diretórios nem symlinks: impede incluir resíduos, sessão
        # ou arquivos de outro upload e impede sobrescrever trabalho existente.
        target.mkdir(mode=0o700)
    try:
        entries = []
        for relative in files:
            source = _regular_source(root, relative)
            data = source.read_bytes()
            destination = target / relative
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(stat.S_IMODE(source.stat().st_mode))
            entries.append({"path": relative, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        # O builder legado só considera .dockerignore na raiz. O filtro adicional
        # é idêntico ao do Dockerfile e também fica registrado no manifesto.
        ignore_bytes = ignore.encode("utf-8")
        (target / ".dockerignore").write_bytes(ignore_bytes)
        entries.append({"path": ".dockerignore", "size": len(ignore_bytes), "sha256": hashlib.sha256(ignore_bytes).hexdigest()})
        manifest = {"version": 1, "files": sorted(entries, key=lambda item: item["path"])}
        (target / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except BaseException:
        shutil.rmtree(target)
        raise
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Diretório novo; o padrão cria uma pasta temporária privada")
    arguments = parser.parse_args()
    print(create_context(ROOT, arguments.output))
