"""Verifica o supervisor somente com estado sintético, sem processos ou rede."""

import importlib.util
import io
import json
from contextlib import closing
from pathlib import Path
import signal
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, call, patch


SPEC = importlib.util.spec_from_file_location("mel_whatsapp_cloud", Path(__file__).with_name("cloud.py"))
cloud = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cloud)


SCHEMAS = {
    "worker-ledger.db": (
        "CREATE TABLE jobs(id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL);"
        "CREATE TABLE pending_acks(id TEXT PRIMARY KEY,lease_token TEXT NOT NULL,outcome TEXT NOT NULL);"
    ),
    "store/whatsapp.db": (
        "CREATE TABLE whatsmeow_device(jid TEXT PRIMARY KEY);"
        "INSERT INTO whatsmeow_device(jid) VALUES('fixture-session');"
    ),
    "store/activity.db": (
        "CREATE TABLE activity(contact_hash TEXT NOT NULL,event_hash TEXT NOT NULL,"
        "job_hash TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(contact_hash,event_hash));"
    ),
    "store/messages.db": "CREATE TABLE chats(jid TEXT PRIMARY KEY);CREATE TABLE messages(id TEXT PRIMARY KEY);",
}


def private_write(path, content):
    path.write_text(content)
    path.chmod(0o600)


def make_state(data):
    state = data / "state"
    state.mkdir(mode=0o700)
    (state / "store").mkdir(mode=0o700)
    private_write(state / ".cloud-ready.json", '{"version":1}')
    private_write(state / "bridge-token", "a" * 64)
    private_write(state / "worker-token", "b" * 64)
    private_write(state / "worker-config.json", '{"enabled":true}')
    for name, schema in SCHEMAS.items():
        path = state / name
        with closing(sqlite3.connect(path)) as db:
            db.executescript(schema)
        path.chmod(0o600)
    return state


class StateValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.data = Path(self.temporary.name)
        self.state = make_state(self.data)

    def test_complete_private_synthetic_import_is_accepted(self):
        self.assertIsNone(cloud.validate_state(self.state))

    def test_each_missing_required_file_blocks_startup(self):
        for name in cloud.REQUIRED:
            with self.subTest(name=name):
                path = self.state / name
                saved = path.read_bytes()
                path.unlink()
                with self.assertRaises(ValueError):
                    cloud.validate_state(self.state)
                path.write_bytes(saved)
                path.chmod(0o600)

    def test_import_marker_is_required_and_versioned(self):
        marker = self.state / ".cloud-ready.json"
        marker.unlink()
        with self.assertRaises(ValueError):
            cloud.validate_state(self.state)
        for value in ('{"version":2}', '{"version":1,"extra":true}', "[]", "not-json"):
            with self.subTest(value=value):
                private_write(marker, value)
                with self.assertRaises(ValueError):
                    cloud.validate_state(self.state)

    def test_symlinked_state_store_marker_and_required_files_are_rejected(self):
        link = self.data / "linked-state"
        link.symlink_to(self.state, target_is_directory=True)
        with self.assertRaises(ValueError):
            cloud.validate_state(link)
        names = ("store", ".cloud-ready.json", *cloud.REQUIRED)
        for index, name in enumerate(names):
            with self.subTest(name=name):
                path = self.state / name
                saved = self.data / f"moved-{index}"
                path.rename(saved)
                path.symlink_to(saved, target_is_directory=saved.is_dir())
                with self.assertRaises(ValueError):
                    cloud.validate_state(self.state)
                path.unlink()
                saved.rename(path)

    def test_group_or_world_access_to_state_import_is_rejected(self):
        for name in ("", "store", ".cloud-ready.json", *cloud.REQUIRED):
            path = self.state / name
            original = path.stat().st_mode & 0o777
            with self.subTest(name=name or "state"):
                path.chmod(original | 0o004)
                try:
                    with self.assertRaises(ValueError):
                        cloud.validate_state(self.state)
                finally:
                    path.chmod(original)

    def test_invalid_tokens_block_startup(self):
        for name in ("bridge-token", "worker-token"):
            for token in ("short", "a" * 32 + "\n" + "b" * 32, "a" * 32 + "\r" + "b" * 32,
                          "a" * 32 + " " + "b" * 32, "á" * 64):
                with self.subTest(name=name, token_kind=repr(token[:8])):
                    private_write(self.state / name, token)
                    with self.assertRaises(ValueError):
                        cloud.validate_state(self.state)
            private_write(self.state / name, "a" * 64)

    def test_worker_must_be_explicitly_enabled(self):
        for value in ('{"enabled":false}', '{}', '{"enabled":1}', '{"enabled":"true"}'):
            with self.subTest(value=value):
                private_write(self.state / "worker-config.json", value)
                with self.assertRaises(ValueError):
                    cloud.validate_state(self.state)

    def test_corrupt_database_blocks_startup(self):
        private_write(self.state / "store/activity.db", "not a SQLite database")
        with self.assertRaises((ValueError, sqlite3.DatabaseError)):
            cloud.validate_state(self.state)

    def test_valid_sqlite_with_missing_schema_is_incomplete(self):
        for name in SCHEMAS:
            with self.subTest(name=name):
                path = self.state / name
                saved = path.read_bytes()
                path.unlink()
                sqlite3.connect(path).close()
                path.chmod(0o600)
                with self.assertRaises(ValueError):
                    cloud.validate_state(self.state)
                path.write_bytes(saved)
                path.chmod(0o600)

    def test_unpaired_empty_device_store_cannot_start_cloud(self):
        with closing(sqlite3.connect(self.state / "store/whatsapp.db")) as db, db:
            db.execute("DELETE FROM whatsmeow_device")
        with self.assertRaises(ValueError):
            cloud.validate_state(self.state)

    def test_existing_table_with_missing_required_column_is_incomplete(self):
        with closing(sqlite3.connect(self.state / "worker-ledger.db")) as db:
            db.execute("ALTER TABLE pending_acks RENAME COLUMN lease_token TO wrong_column")
        with self.assertRaises(ValueError):
            cloud.validate_state(self.state)


class HealthAndBridgeTests(unittest.TestCase):
    @staticmethod
    def request(status, path="/healthz"):
        handler = object.__new__(cloud.health_handler(status))
        handler.path = path
        handler.wfile = io.BytesIO()
        handler.send_response = Mock()
        handler.send_error = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.do_GET()
        return handler

    def test_public_health_is_liveness_and_only_exposes_sanitized_fields(self):
        handler = self.request({
            "phase": "connecting", "bridgeConnected": False, "workerRunning": False,
            "token": "synthetic-sensitive-value", "recipient": "synthetic-contact",
        })
        handler.send_response.assert_called_once_with(200)
        self.assertEqual(json.loads(handler.wfile.getvalue()), {
            "phase": "connecting", "bridgeConnected": False, "workerRunning": False,
        })
        self.assertIn(call("Cache-Control", "no-store"), handler.send_header.call_args_list)

    def test_health_rejects_other_paths_without_status_payload(self):
        handler = self.request({"phase": "running"}, "/api/send")
        handler.send_error.assert_called_once_with(404)
        handler.send_response.assert_not_called()
        self.assertEqual(handler.wfile.getvalue(), b"")

    def test_health_logging_is_silent(self):
        handler = object.__new__(cloud.health_handler({}))
        with patch("sys.stderr", new_callable=io.StringIO) as output:
            handler.log_message("private %s", "synthetic")
        self.assertEqual(output.getvalue(), "")

    def test_bridge_requires_authenticated_non_simulated_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            private_write(state / "bridge-token", "a" * 64)
            for value, expected in (
                ({"connected": True, "simulation": False}, True),
                ({"connected": True, "simulation": True}, False),
                ({"connected": False, "simulation": False}, False),
                ({"connected": 1, "simulation": False}, False), ({}, False),
            ):
                with self.subTest(value=value), patch.object(cloud, "build_opener") as build:
                    response = build.return_value.open.return_value.__enter__.return_value
                    response.read.return_value = json.dumps(value).encode()
                    self.assertIs(cloud.bridge_connected(state), expected)
                    request = build.return_value.open.call_args.args[0]
                    self.assertEqual(request.full_url, "http://127.0.0.1:18281/api/status")
                    self.assertEqual(build.return_value.open.call_args.kwargs, {"timeout": 2})
                    response.read.assert_called_once_with(4096)
                    self.assertEqual(build.call_args.args[0].proxies, {})
                    self.assertIsInstance(build.call_args.args[1], cloud.NoRedirect)

    def test_bridge_read_failure_is_disconnected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(cloud, "build_opener") as build:
            state = Path(directory)
            private_write(state / "bridge-token", "a" * 64)
            build.return_value.open.side_effect = OSError("synthetic network failure")
            self.assertFalse(cloud.bridge_connected(state))

    def test_redirect_is_never_followed(self):
        self.assertIsNone(cloud.NoRedirect().redirect_request(None, None, 302, None, None, "https://example.invalid"))


class ProcessShutdownTests(unittest.TestCase):
    def test_process_group_is_terminated_before_wait(self):
        process = Mock(pid=123456)
        recorder = Mock()
        recorder.attach_mock(process.wait, "wait")
        with patch.object(cloud.os, "killpg") as kill:
            recorder.attach_mock(kill, "kill")
            cloud.stop_process(process)
        self.assertEqual(recorder.mock_calls, [call.kill(123456, signal.SIGTERM), call.wait(timeout=10)])

    def test_hung_group_escalates_once_then_waits(self):
        process = Mock(pid=123456)
        process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 10), None]
        with patch.object(cloud.os, "killpg") as kill:
            cloud.stop_process(process)
        self.assertEqual(kill.call_args_list, [call(123456, signal.SIGTERM), call(123456, signal.SIGKILL)])
        self.assertEqual(process.wait.call_args_list, [call(timeout=10), call(timeout=5)])

    def test_missing_process_and_no_process_are_safe(self):
        with patch.object(cloud.os, "killpg", side_effect=ProcessLookupError) as kill:
            cloud.stop_process(None)
            kill.assert_not_called()
            cloud.stop_process(Mock(pid=123456))
            kill.assert_called_once_with(123456, signal.SIGTERM)

    def test_process_exiting_between_graceful_timeout_and_force_kill_is_safe(self):
        process = Mock(pid=123456)
        process.wait.side_effect = subprocess.TimeoutExpired("synthetic", 10)
        with patch.object(cloud.os, "killpg", side_effect=[None, ProcessLookupError]):
            cloud.stop_process(process)


class FakeEvent:
    def __init__(self, on_wait=None):
        self.stopped = False
        self.waits = []
        self.on_wait = on_wait

    def set(self):
        self.stopped = True

    def is_set(self):
        return self.stopped

    def wait(self, seconds):
        self.waits.append(seconds)
        if self.on_wait:
            self.on_wait(self)
        else:
            self.set()
        return self.stopped


class SupervisorGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.data = Path(self.temporary.name)
        self.root = self.data / "code"
        self.root.mkdir()
        self.event = FakeEvent()
        self.status = None
        self.server = MagicMock()
        self.bridge = Mock(pid=123456)
        self.bridge.poll.return_value = None
        self.worker = Mock(pid=123457)
        self.worker.poll.return_value = None
        self.popen = self.enter(patch.object(cloud.subprocess, "Popen", side_effect=[self.bridge, self.worker]))
        self.stop = self.enter(patch.object(cloud, "stop_process"))
        self.connected = self.enter(patch.object(cloud, "bridge_connected", return_value=False))
        self.enter(patch.object(cloud.os, "umask"))
        self.enter(patch.object(cloud.signal, "signal"))
        self.enter(patch.object(cloud.fcntl, "flock"))
        self.enter(patch.object(cloud.threading, "Event", return_value=self.event))
        self.enter(patch.object(cloud.threading, "Thread"))
        self.enter(patch.object(cloud, "ThreadingHTTPServer", return_value=self.server))
        original_handler = cloud.health_handler

        def capture(status):
            self.status = status
            return original_handler(status)

        self.enter(patch.object(cloud, "health_handler", side_effect=capture))

    def enter(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def run_supervisor(self):
        cloud.run(self.data, self.root)

    def activate(self):
        make_state(self.data)
        private_write(self.data / "enable-cloud", "")

    def test_no_import_does_not_spawn_or_contact_bridge(self):
        self.run_supervisor()
        self.popen.assert_not_called()
        self.connected.assert_not_called()
        self.assertEqual(self.event.waits, [2])
        self.server.shutdown.assert_called_once()
        self.server.server_close.assert_called_once()

    def test_import_without_enable_flag_never_spawns(self):
        make_state(self.data)
        self.run_supervisor()
        self.popen.assert_not_called()
        self.connected.assert_not_called()
        self.assertEqual(self.event.waits, [2])

    def test_enable_flag_without_complete_import_is_insufficient(self):
        self.activate()
        (self.data / "state/worker-ledger.db").unlink()
        with self.assertRaises(ValueError):
            self.run_supervisor()
        self.popen.assert_not_called()
        self.connected.assert_not_called()

    def test_disconnected_bridge_never_starts_worker(self):
        self.activate()
        self.run_supervisor()
        self.assertEqual(self.popen.call_count, 1)
        self.assertIn("run-bridge.sh", self.popen.call_args.args[0][1])
        self.assertEqual(self.stop.call_args_list, [call(None), call(self.bridge)])

    def test_connected_bridge_starts_worker_and_shutdown_orders_worker_first(self):
        self.activate()
        self.connected.return_value = True
        self.run_supervisor()
        self.assertEqual(self.popen.call_count, 2)
        self.assertIn("run-bridge.sh", self.popen.call_args_list[0].args[0][1])
        self.assertIn("run-worker.sh", self.popen.call_args_list[1].args[0][1])
        self.assertEqual(self.stop.call_args_list, [call(self.worker), call(self.bridge)])
        for creation in self.popen.call_args_list:
            self.assertIs(creation.kwargs["start_new_session"], True)
            self.assertEqual(creation.kwargs["stdout"], subprocess.DEVNULL)
            self.assertEqual(creation.kwargs["stderr"], subprocess.DEVNULL)
        self.assertEqual(self.status, {"phase": "stopped", "bridgeConnected": False, "workerRunning": False})

    def test_worker_waits_until_second_positive_connection_check(self):
        self.activate()
        self.connected.side_effect = [False, True]

        def wait(event):
            if len(event.waits) == 1:
                self.assertEqual(self.popen.call_count, 1)
            else:
                event.set()

        self.event.on_wait = wait
        self.run_supervisor()
        self.assertEqual(self.connected.call_count, 2)
        self.assertEqual(self.popen.call_count, 2)

    def test_removing_enable_flag_stops_without_restarting_or_claiming(self):
        self.activate()
        self.connected.return_value = True

        def wait(_event):
            (self.data / "enable-cloud").unlink()

        self.event.on_wait = wait
        self.run_supervisor()
        self.assertEqual(self.popen.call_count, 2)
        self.assertEqual(self.connected.call_count, 1)
        self.assertEqual(self.stop.call_args_list, [call(self.worker), call(self.bridge)])

    def test_pairing_and_simulation_flags_are_not_inherited(self):
        self.activate()
        self.connected.return_value = True
        with patch.dict(cloud.os.environ, {"MEL_WHATSAPP_PAIRING": "1", "MEL_WHATSAPP_SIMULATION": "1"}):
            self.run_supervisor()
        for creation in self.popen.call_args_list:
            self.assertNotIn("MEL_WHATSAPP_PAIRING", creation.kwargs["env"])
            self.assertNotIn("MEL_WHATSAPP_SIMULATION", creation.kwargs["env"])

    def test_worker_crash_stops_both_children_without_restart(self):
        self.activate()
        self.connected.return_value = True
        self.worker.poll.return_value = 1
        with self.assertRaisesRegex(RuntimeError, "worker_stopped"):
            self.run_supervisor()
        self.assertEqual(self.popen.call_count, 2)
        self.assertEqual(self.stop.call_args_list, [call(self.worker), call(self.bridge)])

    def test_second_supervisor_lock_blocks_every_child_and_http_server(self):
        self.activate()
        with patch.object(cloud.fcntl, "flock", side_effect=BlockingIOError):
            with self.assertRaisesRegex(RuntimeError, "cloud_already_running"):
                self.run_supervisor()
        self.popen.assert_not_called()
        self.connected.assert_not_called()


if __name__ == "__main__":
    unittest.main()
