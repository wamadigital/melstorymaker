"""Checks offline do contexto de imagem; nunca leem sessão ou chamam WhatsApp."""

import hashlib
import importlib.util
import io
from pathlib import Path
import re
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("railway_prepare_build", Path(__file__).with_name("prepare_build.py"))
prepare_build = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(prepare_build)
ROOT = Path(__file__).resolve().parents[2]


class PrepareBuildTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "build"
        (self.root / "integrations/whatsapp-local").mkdir(parents=True)

    def archive(self, name="main.py", *, symlink=False):
        target = Path(self.temporary.name) / "upstream.tar.gz"
        with tarfile.open(target, "w:gz") as archive:
            member = tarfile.TarInfo(f"whatsapp-mcp-{prepare_build.UPSTREAM_COMMIT}/{name}")
            if symlink:
                member.type = tarfile.SYMTYPE
                member.linkname = "/private/session.db"
                archive.addfile(member)
            else:
                content = b"print('fixture')\n"
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        preparation = f'''from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_SHA256 = {digest!r}
def prepare():
    runtime = ROOT / ".whatsapp-local"
    (runtime / "app").mkdir()
    (runtime / "state").mkdir()
    (runtime / "state/bridge-token").write_text("ephemeral-build-token")
def verify_manifest(app):
    assert app.is_dir()
'''
        (self.root / "integrations/whatsapp-local/prepare.py").write_text(preparation)
        return target

    def test_existing_runtime_is_untouched_and_no_network_is_called(self):
        state = self.root / ".whatsapp-local/state"
        state.mkdir(parents=True)
        session = state / "session.db"
        session.write_bytes(b"private-session-fixture")
        with patch.object(prepare_build.urllib.request, "urlopen") as request:
            with self.assertRaisesRegex(RuntimeError, "diretório limpo"):
                prepare_build.prepare_build(self.root)
        request.assert_not_called()
        self.assertEqual(session.read_bytes(), b"private-session-fixture")

    def test_valid_archive_is_prepared_and_ephemeral_token_is_removed(self):
        archive = self.archive()
        prepare_build.prepare_build(self.root, archive)
        runtime = self.root / ".whatsapp-local"
        self.assertTrue((runtime / "app").is_dir())
        self.assertEqual((runtime / "upstream/main.py").read_text(), "print('fixture')\n")
        self.assertFalse((runtime / "state").exists())

    def test_bad_checksum_is_rejected_before_extraction(self):
        archive = self.archive()
        archive.write_bytes(b"changed")
        with self.assertRaisesRegex(RuntimeError, "Checksum"):
            prepare_build.prepare_build(self.root, archive)
        self.assertFalse((self.root / ".whatsapp-local/upstream").exists())

    def test_links_in_archive_are_rejected(self):
        archive = self.archive(symlink=True)
        with self.assertRaisesRegex(RuntimeError, "não regular"):
            prepare_build.prepare_build(self.root, archive)
        self.assertFalse((self.root / ".whatsapp-local/state").exists())

    def test_path_escape_in_archive_is_rejected(self):
        archive = self.archive("../../escaped.py")
        with self.assertRaises(tarfile.FilterError):
            prepare_build.prepare_build(self.root, archive)
        self.assertFalse((self.root / "escaped.py").exists())


class BuildContextTest(unittest.TestCase):
    def test_pin_matches_existing_install_and_checksum_is_not_redefined(self):
        install = (ROOT / "integrations/whatsapp-local/install.sh").read_text()
        self.assertIn(prepare_build.UPSTREAM_URL, install)
        self.assertIn("preparation.ARCHIVE_SHA256", Path(prepare_build.__file__).read_text())

    def test_context_is_allowlisted_without_state_or_unrelated_application(self):
        lines = [line.strip() for line in Path(__file__).with_name("Dockerfile.dockerignore").read_text().splitlines()
                 if line.strip() and not line.startswith("#")]
        self.assertEqual(lines[0], "**")
        for line in lines[1:]:
            self.assertTrue(line.startswith("!integrations/"), line)
            self.assertNotIn("*", line)
            self.assertNotIn("state", line)
            self.assertNotIn(".env", line)
        self.assertIn("!integrations/whatsapp-local/dependencies/uv.lock", lines)
        self.assertIn("!integrations/whatsapp-railway/cloud.py", lines)

    def test_runtime_contains_no_builder_or_broad_copy(self):
        dockerfile = Path(__file__).with_name("Dockerfile").read_text()
        runtime = dockerfile.split(" AS runtime\n", 1)[1]
        self.assertIn("uv sync --frozen --no-dev", dockerfile)
        self.assertIn("CGO_ENABLED=1", dockerfile)
        self.assertIn("GOTOOLCHAIN=local", dockerfile)
        self.assertIn("go test ./...", dockerfile)
        self.assertIn("ln -s /data/state /app/.whatsapp-local/state", runtime)
        self.assertNotRegex(runtime, r"(?m)^COPY\s+\.\s")
        self.assertNotIn("/usr/local/bin/uv", runtime)
        self.assertNotIn("gcc", runtime)
        self.assertNotIn("chromium", runtime.lower())
        self.assertNotIn("node", runtime.lower())
        self.assertNotRegex(runtime, r"(?m)^COPY.*(?:bridge-token|worker-token|\.db)")
        self.assertEqual(re.findall(r"(?m)^CMD (.*)$", runtime),
                         ['["python", "/app/integrations/whatsapp-railway/cloud.py"]'])

    def test_supervisor_entrypoints_are_copied_and_allowed_in_context(self):
        dockerfile = Path(__file__).with_name("Dockerfile").read_text()
        runtime = dockerfile.split(" AS runtime\n", 1)[1]
        ignore = Path(__file__).with_name("Dockerfile.dockerignore").read_text().splitlines()
        for script in ("run-bridge.sh", "run-worker.sh", "run-mcp.sh"):
            source = f"integrations/whatsapp-local/{script}"
            self.assertTrue((ROOT / source).is_file())
            self.assertRegex(runtime, rf"(?m)^COPY .*{re.escape(source)}(?: |$)")
            self.assertIn("!" + source, ignore)
        self.assertIn("GOMEMLIMIT=64MiB", runtime)


if __name__ == "__main__":
    unittest.main()
