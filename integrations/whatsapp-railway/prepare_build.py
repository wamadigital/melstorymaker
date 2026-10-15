"""Prepara o upstream fixado dentro de um contexto de build sem sessão existente."""

import argparse
import hashlib
import importlib.util
from pathlib import Path
import shutil
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM_COMMIT = "7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88"
UPSTREAM_URL = f"https://codeload.github.com/lharries/whatsapp-mcp/tar.gz/{UPSTREAM_COMMIT}"
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024


def prepare_build(root: Path, archive: Path | None = None) -> None:
    """Falha antes de escrever se houver runtime; não reutiliza estado pessoal."""
    root = Path(root)
    runtime = root / ".whatsapp-local"
    if runtime.exists() or runtime.is_symlink():
        raise RuntimeError("Build exige diretório limpo; runtime existente não será alterado")
    integration = root / "integrations/whatsapp-local"
    sys.path.insert(0, str(integration))
    try:
        spec = importlib.util.spec_from_file_location("mel_image_prepare", integration / "prepare.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Preparador local ausente")
        preparation = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(preparation)
    finally:
        sys.path.pop(0)

    runtime.mkdir(mode=0o700)
    downloads = runtime / "downloads"
    downloads.mkdir(mode=0o700)
    destination = downloads / "upstream.tar.gz"
    if archive is not None:
        if archive.is_symlink() or not archive.is_file():
            raise RuntimeError("Arquivo upstream inválido")
        if archive.stat().st_size > MAX_ARCHIVE_BYTES:
            raise RuntimeError("Arquivo upstream excede limite")
        shutil.copyfile(archive, destination)
    else:
        request = urllib.request.Request(UPSTREAM_URL, headers={"User-Agent": "MelStorymaker-build/1"})
        with urllib.request.urlopen(request, timeout=90) as response, destination.open("xb") as output:
            remaining = MAX_ARCHIVE_BYTES
            while chunk := response.read(min(1024 * 1024, remaining + 1)):
                remaining -= len(chunk)
                if remaining < 0:
                    raise RuntimeError("Arquivo upstream excede limite")
                output.write(chunk)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != preparation.ARCHIVE_SHA256:
        raise RuntimeError("Checksum upstream divergente; nada foi extraído")

    source = runtime / "upstream"
    source.mkdir(mode=0o700)
    prefix = f"whatsapp-mcp-{UPSTREAM_COMMIT}/"
    with tarfile.open(destination, "r:gz") as upstream:
        for member in upstream.getmembers():
            name = member.name
            if name.rstrip("/") == prefix.rstrip("/") and member.isdir():
                continue
            if not name.startswith(prefix):
                raise RuntimeError("Estrutura upstream divergente")
            member.name = name[len(prefix):]
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise RuntimeError("Upstream contém entrada não regular")
            upstream.extract(member, source, filter="data")
    preparation.prepare()
    preparation.verify_manifest(runtime / "app")
    # prepare.py cria um token privado para a instalação local. O build nunca
    # preserva esse estado: produção recebe tokens somente pelo volume/segredos.
    shutil.rmtree(runtime / "state")
    print("Upstream e patches conferidos; imagem preparada sem sessão ou tokens")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Arquivo local já baixado; checksum continua obrigatório")
    arguments = parser.parse_args()
    prepare_build(ROOT, arguments.archive)
