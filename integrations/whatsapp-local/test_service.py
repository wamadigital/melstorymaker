"""LaunchAgents em diretórios fictícios, sem launchctl ou HTTP reais."""

import io
import json
import os
from pathlib import Path
import plistlib
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import service


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mel-launchagents-test-")
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name).resolve()
        self.root = base / "Projeto Fictício"
        self.home = base / "usuario-ficticio"
        self.root.mkdir(mode=0o700)
        self.home.mkdir(mode=0o700)
        self.state = self.root / ".whatsapp-local/state"
        self.state.mkdir(mode=0o700, parents=True)
        self.state.parent.chmod(0o700)
        (self.state / "worker-config.json").write_text('{"enabled":true}')
        for name in ("bridge", "worker"):
            wrapper = self.root / f"integrations/whatsapp-local/run-{name}.sh"
            wrapper.parent.mkdir(parents=True, exist_ok=True)
            wrapper.write_text("#!/bin/bash\n# fixture sem serviço\n")
        self.directory = self.home / "Library/LaunchAgents"
        self.commands = []

    def runner(self, arguments):
        self.commands.append(arguments)
        return SimpleNamespace(returncode=113 if arguments[0] == "print" else 0)

    def install(self, **kwargs):
        options = {"runner": self.runner, "readiness": lambda root: True,
                   "wait_handoff": lambda: None, "free_port": lambda: True}
        options.update(kwargs)
        return service.install(self.root, self.home, **options)

    def test_prepare_writes_only_private_runtime_plists(self):
        files = service.prepare(self.root)
        self.assertFalse(self.directory.exists())
        self.assertEqual(set(files), set(service.LABELS))
        for label, file in files.items():
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            value = plistlib.loads(file.read_bytes())
            self.assertEqual(value["Label"], label)
            self.assertEqual(value["ProgramArguments"][0], "/bin/bash")
            self.assertTrue(Path(value["ProgramArguments"][1]).is_absolute())
            self.assertNotIn("--pair", value["ProgramArguments"])
            self.assertEqual(value["WorkingDirectory"], str(self.root))
            self.assertEqual(value["Umask"], 0o077)
            for key in ("StandardOutPath", "StandardErrorPath"):
                self.assertEqual(Path(value[key]).parent, self.state)
                self.assertFalse(Path(value[key]).exists())
        self.assertEqual(files[service.LABELS[0]].parent.stat().st_mode & 0o777, 0o700)

    def test_disabled_configuration_refuses_before_readiness_or_mutation(self):
        (self.state / "worker-config.json").write_text('{"enabled":false}')
        ready, runner = Mock(), Mock()
        with self.assertRaisesRegex(service.ServiceError, "enabled:true"):
            self.install(readiness=ready, runner=runner)
        ready.assert_not_called()
        runner.assert_not_called()
        self.assertFalse(self.directory.exists())
        self.assertFalse((self.state.parent / "launchagents").exists())

    def test_unpaired_session_refuses_before_launchd_or_writes(self):
        runner = Mock()
        with self.assertRaisesRegex(service.ServiceError, "pareado"):
            self.install(readiness=lambda root: False, runner=runner)
        runner.assert_not_called()
        self.assertFalse(self.directory.exists())
        self.assertFalse((self.state.parent / "launchagents").exists())

    def test_existing_plist_is_preserved_without_partial_install(self):
        self.directory.mkdir(parents=True)
        collision = self.directory / f"{service.LABELS[1]}.plist"
        collision.write_text("serviço existente fictício")
        with self.assertRaisesRegex(service.ServiceError, "já existe"):
            self.install()
        self.assertEqual(collision.read_text(), "serviço existente fictício")
        self.assertFalse((self.directory / f"{service.LABELS[0]}.plist").exists())
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))

    def test_loaded_label_is_never_touched(self):
        runner = Mock(return_value=SimpleNamespace(returncode=0))
        with self.assertRaisesRegex(service.ServiceError, "já carregado"):
            self.install(runner=runner)
        self.assertEqual([call.args[0][0] for call in runner.call_args_list], ["print"])
        self.assertFalse(self.directory.exists())

    def test_missing_wrapper_refuses_before_writes(self):
        (self.root / "integrations/whatsapp-local/run-worker.sh").unlink()
        with self.assertRaisesRegex(service.ServiceError, "Wrapper"):
            self.install()
        self.assertEqual(self.commands, [])
        self.assertFalse(self.directory.exists())

    def test_readiness_and_handoff_are_same_invocation(self):
        ready = Mock(return_value=True)
        order = []

        def handoff():
            order.append("handoff")
            self.assertFalse(self.directory.exists())
            self.assertFalse((self.state.parent / "launchagents").exists())

        def runner(arguments):
            order.append(arguments[0])
            return self.runner(arguments)

        self.install(readiness=ready, wait_handoff=handoff, runner=runner)
        ready.assert_called_once_with(self.root)
        self.assertLess(order.index("handoff"), order.index("bootstrap"))
        self.assertEqual(sum(command[0] == "bootstrap" for command in self.commands), 2)
        for label in service.LABELS:
            file = self.directory / f"{label}.plist"
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(plistlib.loads(file.read_bytes()), service.plans(self.root)[label])

    def test_foreground_still_running_refuses_before_writes(self):
        with self.assertRaisesRegex(service.ServiceError, "foreground"):
            self.install(free_port=lambda: False)
        self.assertFalse(self.directory.exists())
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))

    def test_disabled_during_handoff_refuses_before_writes(self):
        def handoff():
            (self.state / "worker-config.json").write_text('{"enabled":false}')

        with self.assertRaisesRegex(service.ServiceError, "desativada"):
            self.install(wait_handoff=handoff)
        self.assertFalse(self.directory.exists())
        self.assertFalse((self.state.parent / "launchagents").exists())
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))

    def test_collision_during_handoff_is_preserved(self):
        def handoff():
            self.directory.mkdir(parents=True)
            (self.directory / f"{service.LABELS[0]}.plist").write_text("outra instalação fictícia")

        with self.assertRaisesRegex(service.ServiceError, "já existe"):
            self.install(wait_handoff=handoff)
        self.assertEqual((self.directory / f"{service.LABELS[0]}.plist").read_text(), "outra instalação fictícia")
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))

    def test_failed_bootstrap_rolls_back_only_its_own_files_and_labels(self):
        self.directory.mkdir(parents=True)
        other = self.directory / "com.outro.servico.plist"
        other.write_text("preservar fixture externa")

        def runner(arguments):
            result = self.runner(arguments)
            if arguments[0] == "bootstrap" and service.LABELS[1] in arguments[2]:
                result.returncode = 1
            return result

        with self.assertRaisesRegex(service.ServiceError, "revertidos"):
            self.install(runner=runner)
        self.assertEqual(other.read_text(), "preservar fixture externa")
        self.assertEqual([file.name for file in self.directory.iterdir()], [other.name])
        reverted = [command[1].split("/")[-1] for command in self.commands if command[0] == "bootout"]
        self.assertEqual(reverted, list(reversed(service.LABELS)))

    def test_status_uses_authenticated_direct_http_without_redirects(self):
        token = "token-ficticio-do-bridge-para-testes-locais"
        (self.state / "bridge-token").write_text(token)
        response = io.StringIO(json.dumps({"connected": True, "simulation": False}))
        response.status = 200
        opener = Mock()
        opener.open.return_value = response
        with patch.object(service.urllib.request, "build_opener", return_value=opener) as factory:
            self.assertTrue(service.paired(self.root))
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:18281/api/status")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + token)
        self.assertEqual(factory.call_args.args[0].proxies, {})
        self.assertIsInstance(factory.call_args.args[1], service.NoRedirect)
        self.assertIsNone(service.NoRedirect().redirect_request(None, None, 302, None, None, "https://example.invalid"))

    def test_simulation_status_never_confirms_pairing(self):
        (self.state / "bridge-token").write_text("token-ficticio-do-bridge-para-testes-locais")
        response = io.StringIO('{"connected":true,"simulation":true}')
        response.status = 200
        opener = Mock()
        opener.open.return_value = response
        with patch.object(service.urllib.request, "build_opener", return_value=opener):
            self.assertFalse(service.paired(self.root))

    def relocation_fixture(self):
        scripts = self.root / "integrations/whatsapp-local"
        for name in ("run-mcp.sh", "worker.py", "service.py", "prepare.py", "compat.py", "local_server.go", "local_server_test.go", "local_activity.go", "local_activity_test.go"):
            (scripts / name).write_text("código fictício para cópia")
        (scripts / "dependencies").mkdir()
        (scripts / "dependencies/uv.lock").write_text("lock fictício")
        runtime = self.root / ".whatsapp-local"
        for name in (*service.preparation.APP_FILES, service.preparation.MANIFEST_NAME):
            file = runtime / "app" / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("arquivo fictício do app")
        (runtime / "bin").mkdir()
        (runtime / "bin/whatsapp-bridge").write_bytes(b"binario-ficticio")
        python = runtime / "toolchain/python/cpython-ficticio"
        (python / "bin").mkdir(parents=True)
        (python / "bin/python3.12").write_bytes(b"python-ficticio-nao-executar")
        (python / "lib").mkdir()
        (python / "lib/stdlib-fixture.py").write_text("# stdlib fictícia")
        venv = runtime / "app/whatsapp-mcp-server/.venv"
        (venv / "bin").mkdir(parents=True)
        (venv / "bin/python").symlink_to(python / "bin/python3.12")
        (venv / "bin/mcp").write_text("#!" + str(venv / "bin/python") + "\n")
        packages = venv / "lib/python3.12/site-packages"
        packages.mkdir(parents=True)
        (packages / "_virtualenv.pth").write_text("import _virtualenv\n")
        (packages / "fixture.py").write_text("# pacote fictício")
        (packages / "__pycache__").mkdir()
        (packages / "__pycache__/fixture.pyc").write_bytes(b"cache-ficticio")
        (self.state / "bridge-token").write_text("token-ficticio-do-bridge-para-copia-sem-conta")
        (self.state / "worker-token").write_text("token-ficticio-do-worker-para-copia-sem-conta")
        (self.state / "store").mkdir()
        for name, data in {
            "store/whatsapp.db": b"sessao-ficticia-nao-e-um-banco-real",
            "store/whatsapp.db-wal": b"wal-ficticio",
            "store/whatsapp.db-shm": b"shm-ficticio",
            "worker-ledger.db": b"ledger-ficticio",
            "worker-ledger.db-wal": b"wal-ledger-ficticio",
            "pairing.png": b"nao-copiar-qr",
            "bridge-service.stdout.log": b"nao-copiar-logs",
            "store/messages.db": b"nao-copiar-historico",
        }.items():
            (self.state / name).write_bytes(data)
        self.directory.mkdir(parents=True)
        for label, value in service.plans(self.root).items():
            (self.directory / f"{label}.plist").write_bytes(plistlib.dumps(value))

    def relocate(self, **kwargs):
        options = {"runner": self.runner, "source_verifier": Mock(), "probe": Mock(),
                   "free_port": lambda: True, "readiness": lambda target: True}
        options.update(kwargs)
        return service.relocate(self.root, self.home, **options)

    def test_relocation_is_self_contained_and_preserves_original_session(self):
        self.relocation_fixture()
        original = (self.state / "store/whatsapp.db").read_bytes()
        checked = Mock()
        target = self.relocate(source_verifier=checked)
        checked.assert_called_with(self.root)
        self.assertEqual(checked.call_count, 2)
        self.assertEqual(target, self.home / "Library/Application Support/MelStorymaker/WhatsApp")
        self.assertEqual(target.stat().st_mode & 0o777, 0o700)
        new_state = target / ".whatsapp-local/state"
        for name in ("store/whatsapp.db", "store/whatsapp.db-wal", "store/whatsapp.db-shm", "worker-ledger.db", "worker-ledger.db-wal", "bridge-token", "worker-token"):
            self.assertEqual((new_state / name).read_bytes(), (self.state / name).read_bytes())
            self.assertEqual((new_state / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.state / "store/whatsapp.db").read_bytes(), original)
        self.assertFalse((new_state / "store/messages.db").exists())
        self.assertFalse((new_state / "pairing.png").exists())
        self.assertFalse((new_state / "bridge-service.stdout.log").exists())
        venv = target / ".whatsapp-local/app/whatsapp-mcp-server/.venv"
        self.assertFalse((venv / "bin/mcp").exists())
        self.assertFalse((venv / "lib/python3.12/site-packages/__pycache__").exists())
        self.assertNotIn(str(self.root), (venv / "pyvenv.cfg").read_text())
        self.assertTrue((venv / "bin/python").resolve().is_relative_to(target))
        for file in target.rglob("*"):
            if file.is_symlink():
                self.assertFalse(file.readlink().is_absolute())
                self.assertTrue(file.resolve().is_relative_to(target))
        for label in service.LABELS:
            value = plistlib.loads((self.directory / f"{label}.plist").read_bytes())
            self.assertEqual(value, service.plans(target)[label])
            self.assertNotIn(str(self.root), json.dumps(value))

    def test_relocation_does_not_bootstrap_worker_before_paired_status(self):
        self.relocation_fixture()

        def ready(target):
            boots = [command for command in self.commands if command[0] == "bootstrap"]
            self.assertEqual(len(boots), 1)
            self.assertIn(service.LABELS[0], boots[0][2])
            return True

        self.relocate(readiness=ready)
        self.assertEqual(sum(command[0] == "bootstrap" for command in self.commands), 2)

    def test_relocation_refuses_existing_destination(self):
        self.relocation_fixture()
        target = service.canonical_root(self.home)
        target.mkdir(parents=True)
        (target / "preservar").write_text("outra sessão fictícia")
        with self.assertRaisesRegex(service.ServiceError, "Destino"):
            self.relocate()
        self.assertEqual((target / "preservar").read_text(), "outra sessão fictícia")
        self.assertEqual(self.commands, [])

    def test_relocation_refuses_unowned_plist_and_loaded_service(self):
        self.relocation_fixture()
        first = self.directory / f"{service.LABELS[0]}.plist"
        original = first.read_bytes()
        first.write_bytes(plistlib.dumps({"Label": service.LABELS[0], "ProgramArguments": ["/bin/false"]}))
        with self.assertRaisesRegex(service.ServiceError, "outra configuração"):
            self.relocate()
        self.assertFalse(service.canonical_root(self.home).exists())
        first.write_bytes(original)
        with self.assertRaisesRegex(service.ServiceError, "Pare somente"):
            self.relocate(runner=lambda arguments: SimpleNamespace(returncode=0))
        self.assertFalse(service.canonical_root(self.home).exists())

    def test_relocation_refuses_bad_source_manifest_before_writes(self):
        self.relocation_fixture()
        with self.assertRaisesRegex(RuntimeError, "manifesto fictício"):
            self.relocate(source_verifier=Mock(side_effect=RuntimeError("manifesto fictício inválido")))
        self.assertFalse(service.canonical_root(self.home).parent.exists())
        self.assertEqual(self.commands, [])

    def test_relocation_refuses_active_foreground_worker(self):
        self.relocation_fixture()
        with service.source_quiet(self.root):
            with self.assertRaisesRegex(service.ServiceError, "origem preservada"):
                self.relocate()
        self.assertFalse(service.canonical_root(self.home).exists())
        self.assertEqual((self.state / "worker.lock").stat().st_mode & 0o777, 0o600)
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))

    def test_relocation_probe_failure_restores_plists_without_starting_services(self):
        self.relocation_fixture()
        originals = {label: (self.directory / f"{label}.plist").read_bytes() for label in service.LABELS}
        with self.assertRaisesRegex(service.ServiceError, "origem preservada"):
            self.relocate(probe=Mock(side_effect=service.ServiceError("Python fictício inválido")))
        self.assertFalse(service.canonical_root(self.home).exists())
        for label, data in originals.items():
            self.assertEqual((self.directory / f"{label}.plist").read_bytes(), data)
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))

    def test_relocation_failed_pairing_stops_only_new_bridge_preserves_session_copy(self):
        self.relocation_fixture()
        originals = {label: (self.directory / f"{label}.plist").read_bytes() for label in service.LABELS}
        with self.assertRaisesRegex(service.ServiceError, "origem preservada"):
            self.relocate(readiness=lambda target: False)
        target = service.canonical_root(self.home)
        self.assertTrue((target / ".whatsapp-local/state/store/whatsapp.db").exists())
        self.assertTrue((self.state / "store/whatsapp.db").exists())
        boots = [command for command in self.commands if command[0] == "bootstrap"]
        stops = [command for command in self.commands if command[0] == "bootout"]
        self.assertEqual(len(boots), 1)
        self.assertEqual(len(stops), 1)
        self.assertIn(service.LABELS[0], stops[0][1])
        for label, data in originals.items():
            self.assertEqual((self.directory / f"{label}.plist").read_bytes(), data)

    def test_relocation_interrupt_after_first_plist_restores_originals(self):
        self.relocation_fixture()
        originals = {label: (self.directory / f"{label}.plist").read_bytes() for label in service.LABELS}
        replace = service.replace_owned
        calls = []

        def interrupted(file, expected, data):
            calls.append(file)
            if len(calls) == 2:
                raise KeyboardInterrupt()
            return replace(file, expected, data)

        with patch.object(service, "replace_owned", side_effect=interrupted):
            with self.assertRaisesRegex(service.ServiceError, "origem preservada"):
                self.relocate()
        self.assertFalse(service.canonical_root(self.home).exists())
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))
        for label, data in originals.items():
            self.assertEqual((self.directory / f"{label}.plist").read_bytes(), data)

    def test_relocation_interrupt_after_bridge_bootstrap_stops_it(self):
        self.relocation_fixture()
        originals = {label: (self.directory / f"{label}.plist").read_bytes() for label in service.LABELS}
        with self.assertRaisesRegex(service.ServiceError, "origem preservada"):
            self.relocate(readiness=Mock(side_effect=KeyboardInterrupt))
        stops = [command for command in self.commands if command[0] == "bootout"]
        self.assertEqual(len(stops), 1)
        self.assertIn(service.LABELS[0], stops[0][1])
        self.assertTrue((service.canonical_root(self.home) / ".whatsapp-local/state/store/whatsapp.db").exists())
        for label, data in originals.items():
            self.assertEqual((self.directory / f"{label}.plist").read_bytes(), data)

    def test_relocation_interrupt_inside_successful_replace_restores_originals(self):
        self.relocation_fixture()
        originals = {label: (self.directory / f"{label}.plist").read_bytes() for label in service.LABELS}
        replace = service.replace_owned
        calls = []

        def interrupted(file, expected, data):
            calls.append(file)
            replace(file, expected, data)
            if len(calls) == 1:
                raise KeyboardInterrupt()

        with patch.object(service, "replace_owned", side_effect=interrupted):
            with self.assertRaisesRegex(service.ServiceError, "origem preservada"):
                self.relocate()
        self.assertFalse(service.canonical_root(self.home).exists())
        self.assertFalse(any(command[0] == "bootstrap" for command in self.commands))
        for label, data in originals.items():
            self.assertEqual((self.directory / f"{label}.plist").read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
