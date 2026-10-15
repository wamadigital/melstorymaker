"""Empacotamento offline: somente fontes permitidas, sem comandos ou segredos."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("railway_source_context", Path(__file__).with_name("source_context.py"))
source_context = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(source_context)
ROOT = Path(__file__).resolve().parents[2]


class SourceContextTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mel-context-test-")
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.root = self.parent / "source"
        self.integration = self.root / "integrations/whatsapp-railway"
        self.integration.mkdir(parents=True)
        self.filter = self.integration / "Dockerfile.dockerignore"
        self.filter.write_text("**\n!integrations/\n!integrations/whatsapp-railway/\n"
                               "!integrations/whatsapp-railway/Dockerfile\n"
                               "!integrations/whatsapp-railway/Dockerfile.dockerignore\n")
        (self.integration / "Dockerfile").write_text("FROM python:3.12-slim\n")
        (self.root / ".env").write_text("PRIVATE_SECRET=DO_NOT_COPY_SENTINEL\n")
        state = self.root / ".whatsapp-local/state"
        state.mkdir(parents=True)
        (state / "session.db").write_bytes(b"PRIVATE_SESSION_DO_NOT_COPY")

    def test_only_exact_allowlist_is_copied_with_verifiable_manifest(self):
        output = source_context.create_context(self.root, self.parent / "context")
        files = sorted(path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file())
        self.assertEqual(files, [".dockerignore", "SOURCE-MANIFEST.json",
                                 "integrations/whatsapp-railway/Dockerfile",
                                 "integrations/whatsapp-railway/Dockerfile.dockerignore"])
        self.assertEqual((output / ".dockerignore").read_text(), self.filter.read_text())
        manifest = json.loads((output / "SOURCE-MANIFEST.json").read_text())
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(len(manifest["files"]), 3)
        for entry in manifest["files"]:
            data = (output / entry["path"]).read_bytes()
            self.assertEqual(entry["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(entry["size"], len(data))
            self.assertNotIn(b"DO_NOT_COPY", data)
        self.assertNotIn(str(self.root), (output / "SOURCE-MANIFEST.json").read_text())

    def test_output_with_spaces_and_semicolon_is_a_literal_directory(self):
        target = self.parent / "context with spaces; touch NEVER_EXECUTE"
        self.assertEqual(source_context.create_context(self.root, target), target)
        self.assertTrue((target / "SOURCE-MANIFEST.json").is_file())
        self.assertFalse((self.parent / "NEVER_EXECUTE").exists())

    def test_existing_output_is_preserved_and_refused(self):
        target = self.parent / "context"
        target.mkdir()
        sentinel = target / "keep.txt"
        sentinel.write_text("original")
        with self.assertRaises(FileExistsError):
            source_context.create_context(self.root, target)
        self.assertEqual(sentinel.read_text(), "original")
        self.assertEqual(list(target.iterdir()), [sentinel])

    def test_symlink_source_is_refused_before_context_is_created(self):
        dockerfile = self.integration / "Dockerfile"
        dockerfile.unlink()
        dockerfile.symlink_to(self.root / ".env")
        target = self.parent / "context"
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            source_context.create_context(self.root, target)
        self.assertFalse(target.exists())

    def test_symlink_parent_is_refused(self):
        moved = self.parent / "moved"
        self.integration.rename(moved)
        self.integration.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            source_context.create_context(self.root, self.parent / "context")

    def test_wildcard_allow_is_refused(self):
        self.filter.write_text(self.filter.read_text() + "!integrations/whatsapp-railway/**\n")
        with self.assertRaisesRegex(RuntimeError, "sem padrões"):
            source_context.create_context(self.root, self.parent / "context")

    def test_traversal_allow_is_refused(self):
        self.filter.write_text(self.filter.read_text() + "!integrations/../../.env\n")
        with self.assertRaisesRegex(RuntimeError, "traversal"):
            source_context.create_context(self.root, self.parent / "context")

    def test_real_allowlist_includes_every_local_docker_copy_source(self):
        files, _ = source_context.allowlisted_files(ROOT)
        dockerfile = (ROOT / "integrations/whatsapp-railway/Dockerfile").read_text()
        for line in dockerfile.splitlines():
            if not line.startswith("COPY ") or line.startswith("COPY --from="):
                continue
            for source in line.split()[1:-1]:
                if source.endswith("/"):
                    self.assertTrue(any(path.startswith(source) for path in files), source)
                else:
                    self.assertIn(source, files)
        self.assertNotIn("--mount=", dockerfile)


if __name__ == "__main__":
    unittest.main()
