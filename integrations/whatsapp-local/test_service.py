"""LaunchAgents em diretórios fictícios, sem launchctl ou HTTP reais."""

import io
import json
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


if __name__ == "__main__":
    unittest.main()
