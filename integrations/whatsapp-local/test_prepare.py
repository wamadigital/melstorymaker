"""Regressões de preparo atômico; somente arquivos fictícios em temporários."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from typing import Optional


SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("mel_prepare", SCRIPT_DIR / "prepare.py")
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mel-whatsapp-prepare-test-")
        self.addCleanup(self.temporary.cleanup)
        self.runtime = Path(self.temporary.name) / "runtime"
        self.source = self.runtime / "upstream"
        self.app = self.runtime / "app"
        self.source.mkdir(parents=True)
        for name in prepare.APP_FILES:
            file = self.source / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(f"Arquivo fictício: {name}\n")
        archive = self.runtime / "downloads/upstream.tar.gz"
        archive.parent.mkdir()
        archive.write_bytes(b"arquivo-ficticio-sem-upstream-real")
        self.constants = patch.multiple(
            prepare, RUNTIME=self.runtime, SOURCE=self.source, APP=self.app,
            ARCHIVE_SHA256=hashlib.sha256(archive.read_bytes()).hexdigest(),
        )
        self.constants.start()
        self.addCleanup(self.constants.stop)
        self.state = self.runtime / "state"
        self.state.mkdir(mode=0o700)
        self.token = self.state / "bridge-token"
        self.token.write_text("token-ficticio-para-regressao-sem-conta")
        self.token.chmod(0o600)
        self.token_stat = self.token.stat()

    def assertPrivateStateUntouched(self):
        self.assertEqual(self.token.read_text(), "token-ficticio-para-regressao-sem-conta")
        current = self.token.stat()
        self.assertEqual(current.st_mtime_ns, self.token_stat.st_mtime_ns)
        self.assertEqual(current.st_mode, self.token_stat.st_mode)

    def assertNoStaging(self):
        self.assertEqual(list(self.runtime.glob(".app-preparing-*")), [])

    def copyApp(self):
        shutil.copytree(self.source, self.app)

    def test_failed_patch_never_publishes_partial_app(self):
        def interrupted(app):
            (app / "whatsapp-bridge/main.go").write_text("patch fictício parcial")
            raise RuntimeError("patch fictício interrompido")

        with patch.object(prepare, "_patch_app", side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, "interrompido"):
                prepare.prepare()
        self.assertFalse(self.app.exists())
        self.assertNoStaging()
        self.assertPrivateStateUntouched()

    def test_keyboard_interrupt_cleans_staging(self):
        with patch.object(prepare, "_patch_app", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                prepare.prepare()
        self.assertFalse(self.app.exists())
        self.assertNoStaging()
        self.assertPrivateStateUntouched()

    def test_failed_manifest_does_not_publish_app(self):
        with patch.object(prepare, "_patch_app"), patch.object(
            prepare, "create_manifest", side_effect=OSError("falha fictícia de escrita")
        ):
            with self.assertRaises(OSError):
                prepare.prepare()
        self.assertFalse(self.app.exists())
        self.assertNoStaging()
        self.assertPrivateStateUntouched()

    def test_success_publishes_only_complete_verified_app(self):
        def patched(app):
            self.assertFalse(self.app.exists())
            (app / "whatsapp-bridge/main.go").write_text("código fictício corrigido")

        with patch.object(prepare, "_patch_app", side_effect=patched):
            prepare.prepare()
        manifest = prepare.verify_manifest(self.app)
        self.assertEqual((self.app / "whatsapp-bridge/main.go").read_text(), "código fictício corrigido")
        self.assertIn("Arquivo fictício", (self.source / "whatsapp-bridge/main.go").read_text())
        self.assertNotIn(self.token.read_text(), json.dumps(manifest))
        self.assertNoStaging()
        self.assertPrivateStateUntouched()

    def test_existing_app_is_never_replaced_or_certified_implicitly(self):
        self.copyApp()
        with patch.object(prepare, "_patch_app") as apply_patch:
            with self.assertRaisesRegex(RuntimeError, "já existe"):
                prepare.prepare()
            apply_patch.assert_not_called()
        self.assertFalse((self.app / prepare.MANIFEST_NAME).exists())
        self.assertPrivateStateUntouched()

    def test_missing_manifest_rejects_complete_looking_copy(self):
        self.copyApp()
        with self.assertRaises(RuntimeError):
            prepare.verify_manifest(self.app)

    def test_modified_source_is_rejected(self):
        self.copyApp()
        prepare.create_manifest(self.app)
        (self.app / "whatsapp-bridge/main.go").write_text("conteúdo fictício alterado")
        with self.assertRaisesRegex(RuntimeError, "divergente"):
            prepare.verify_manifest(self.app)

    def test_missing_dependency_is_rejected(self):
        self.copyApp()
        prepare.create_manifest(self.app)
        (self.app / "whatsapp-mcp-server/uv.lock").unlink()
        with self.assertRaises(RuntimeError):
            prepare.verify_manifest(self.app)

    def test_changed_patch_version_is_rejected(self):
        self.copyApp()
        prepare.create_manifest(self.app)
        with patch.object(prepare, "_input_hashes", return_value={"prepare.py": "outro-hash-ficticio"}):
            with self.assertRaisesRegex(RuntimeError, "divergente"):
                prepare.verify_manifest(self.app)

    def test_history_download_is_disabled_before_connect_and_certified(self):
        self.copyApp()
        go = '''package main

func main() {
\tclient := whatsmeow.NewClient(deviceStore, logger)
\tif client == nil {
\t\tlogger.Errorf("Failed to create WhatsApp client")
\t\treturn
\t}
\terr := client.Connect()
}
'''
        patched = prepare.patch_history_download(go)
        assignment = "client.ManualHistorySyncDownload = true"
        self.assertEqual(patched.count(assignment), 1)
        self.assertLess(patched.index("if client == nil"), patched.index(assignment))
        self.assertLess(patched.index(assignment), patched.index("client.Connect()"))
        go_file = self.app / "whatsapp-bridge/main.go"
        go_file.write_text(patched)
        manifest = prepare.create_manifest(self.app)
        self.assertEqual(
            manifest["files"]["whatsapp-bridge/main.go"],
            hashlib.sha256(patched.encode()).hexdigest(),
        )
        prepare.verify_manifest(self.app)
        go_file.write_text(patched.replace(assignment, "client.ManualHistorySyncDownload = false"))
        with self.assertRaisesRegex(RuntimeError, "divergente"):
            prepare.verify_manifest(self.app)
        self.assertPrivateStateUntouched()

    def test_history_download_patch_refuses_missing_or_ambiguous_constructor(self):
        with self.assertRaisesRegex(RuntimeError, "Upstream divergente"):
            prepare.patch_history_download("func main() {}")
        constructor = '''\tclient := whatsmeow.NewClient(deviceStore, logger)
\tif client == nil {
\t\tlogger.Errorf("Failed to create WhatsApp client")
\t\treturn
\t}
'''
        with self.assertRaisesRegex(RuntimeError, "Upstream divergente"):
            prepare.patch_history_download(constructor + constructor)

    def test_generated_mcp_forwards_test_reference_without_changing_normal_sends(self):
        main = '''def send_message(
    recipient: str,
    message: str
):
    return whatsapp_send_message(recipient, message)
'''
        whatsapp = '''def send_message(recipient: str, message: str):
        payload = {
            "recipient": recipient,
            "message": message,
        }

        response = _local_post(url, payload)
        return response
'''.replace("\n\n        response", "\n        \n        response")
        main, whatsapp = prepare.patch_mcp_send_arguments(main, whatsapp)
        captured = []
        wrapper_scope = {
            "Optional": Optional, "url": "http://127.0.0.1/fixture",
            "_local_post": lambda url, payload: captured.append(payload) or payload,
        }
        exec(compile(whatsapp, "fixture-whatsapp.py", "exec"), wrapper_scope)
        main_scope = {"Optional": Optional, "whatsapp_send_message": wrapper_scope["send_message"]}
        exec(compile(main, "fixture-main.py", "exec"), main_scope)
        send = main_scope["send_message"]
        self.assertEqual(send("fixture", "text"), {"recipient": "fixture", "message": "text"})
        self.assertEqual(send("fixture", "text", "job"), {
            "recipient": "fixture", "message": "text", "automation_job_id": "job",
        })
        self.assertEqual(send("fixture", "text", "job", "lead"), {
            "recipient": "fixture", "message": "text", "automation_job_id": "job", "automation_test_lead_id": "lead",
        })
        self.assertEqual(send("fixture", "text", "job", None, "signed-legacy-fixture"), {
            "recipient": "fixture", "message": "text", "automation_job_id": "job",
            "automation_legacy_authorization": "signed-legacy-fixture",
        })
        self.assertEqual(len(captured), 4)

    def test_generated_mcp_refuses_divergent_upstream_signatures(self):
        with self.assertRaisesRegex(RuntimeError, "Upstream divergente"):
            prepare.patch_mcp_send_arguments("def send_message(): pass", "")

    def test_unexpected_go_source_is_rejected(self):
        self.copyApp()
        prepare.create_manifest(self.app)
        (self.app / "whatsapp-bridge/extra.go").write_text("package main")
        with self.assertRaisesRegex(RuntimeError, "Conjunto"):
            prepare.verify_manifest(self.app)

    def test_symlinked_artifact_is_rejected(self):
        self.copyApp()
        original = self.app / "whatsapp-mcp-server/main.py"
        original.unlink()
        original.symlink_to(self.source / "whatsapp-mcp-server/main.py")
        with self.assertRaises(RuntimeError):
            prepare.create_manifest(self.app)

    def test_invalid_manifest_is_rejected(self):
        self.copyApp()
        (self.app / prepare.MANIFEST_NAME).write_text("{")
        with self.assertRaisesRegex(RuntimeError, "inválido"):
            prepare.verify_manifest(self.app)

    def test_installer_refuses_partial_app_before_compiling(self):
        project = Path(self.temporary.name) / "checkout-ficticio"
        scripts = project / "integrations/whatsapp-local"
        scripts.mkdir(parents=True)
        for name in ("install.sh", "prepare.py", "compat.py"):
            shutil.copyfile(SCRIPT_DIR / name, scripts / name)
        runtime = project / ".whatsapp-local"
        (runtime / "downloads").mkdir(parents=True)
        (runtime / "upstream").mkdir()
        for name in ("upstream.tar.gz", "go.tar.gz"):
            (runtime / "downloads" / name).write_bytes(b"download ficticio")
        (runtime / "app/whatsapp-bridge").mkdir(parents=True)
        (runtime / "app/whatsapp-bridge/main.go").write_text("código fictício incompleto")
        fake_bin = project / "comandos-ficticios"
        fake_bin.mkdir()
        checksum = fake_bin / "shasum"
        checksum.write_text("#!/bin/bash\nexit 0\n")
        checksum.chmod(0o700)
        (fake_bin / "python3").symlink_to(sys.executable)
        compiler = runtime / "toolchain/go/bin/go"
        compiler.parent.mkdir(parents=True)
        compiler.write_text('#!/bin/bash\ntouch "$MEL_TEST_COMPILE_MARKER"\n')
        compiler.chmod(0o700)
        environment = os.environ.copy()
        environment["PATH"] = str(fake_bin) + ":/usr/bin:/bin"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        environment["MEL_TEST_COMPILE_MARKER"] = str(runtime / "compilador-foi-executado")
        result = subprocess.run(
            ["/bin/bash", str(scripts / "install.sh")], env=environment,
            capture_output=True, text=True, timeout=10,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Arquivo obrigatório", result.stderr)
        self.assertFalse((runtime / "compilador-foi-executado").exists())


if __name__ == "__main__":
    unittest.main()
