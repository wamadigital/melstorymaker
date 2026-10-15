"""Exportação exercitada exclusivamente em bancos e tokens sintéticos."""

from contextlib import closing, redirect_stdout
import fcntl
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


_SPEC = importlib.util.spec_from_file_location("mel_export_state_test", Path(__file__).with_name("export_state.py"))
exporter = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(exporter)


SCHEMAS = {
    "worker-ledger.db": (
        "CREATE TABLE jobs(id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL);"
        "CREATE TABLE pending_acks(id TEXT PRIMARY KEY,lease_token TEXT NOT NULL,outcome TEXT NOT NULL);"
        "INSERT INTO jobs VALUES('fixture-job','fixture-digest','sent');"
        "INSERT INTO pending_acks VALUES('fixture-ack','fixture-lease','indeterminate');"
    ),
    "store/whatsapp.db": (
        "CREATE TABLE whatsmeow_device(jid TEXT PRIMARY KEY);"
        "INSERT INTO whatsmeow_device VALUES('fixture-session');"
    ),
    "store/activity.db": (
        "CREATE TABLE activity(contact_hash TEXT,event_hash TEXT,job_hash TEXT,at INTEGER);"
        "INSERT INTO activity VALUES('fixture-contact-hash','fixture-event-hash','fixture-job-hash',123);"
    ),
    "store/messages.db": "CREATE TABLE chats(jid TEXT);CREATE TABLE messages(id TEXT);",
}


def write_private(path, content):
    path.write_text(content)
    path.chmod(0o600)


def files_digest(directory):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*") if path.is_file()}


class StateExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        # No macOS o diretório temporário padrão começa em /var, um alias do
        # sistema; fixtures usam a forma canônica para testar links explícitos.
        self.base = Path(self.temporary.name).resolve()
        self.source = self.base / "source"
        self.source.mkdir(mode=0o700)
        (self.source / "store").mkdir(mode=0o700)
        self.output = self.base / "exported"
        write_private(self.source / "bridge-token", "fixture-bridge-" + "a" * 64 + "\n")
        write_private(self.source / "worker-token", "fixture-worker-" + "b" * 64 + "\n")
        write_private(self.source / "worker-config.json", '{"enabled":true}\n')
        write_private(self.source / "worker.lock", "")
        for name, schema in SCHEMAS.items():
            with closing(sqlite3.connect(self.source / name)) as db:
                db.executescript(schema)
            (self.source / name).chmod(0o600)

    def test_exports_only_allowlist_and_marker_with_verifiable_private_manifest(self):
        write_private(self.source / "pairing.png", "fixture-qr-do-not-export")
        write_private(self.source / "bridge.log", "fixture-log-do-not-export")
        before = files_digest(self.source)
        result = exporter.export_state(self.source, self.output)
        self.assertEqual(result, {"state": "exported", "fileCount": 8})
        expected = {*exporter.REQUIRED, exporter.MARKER, exporter.MANIFEST}
        self.assertEqual(set(files_digest(self.output)), expected)
        self.assertEqual(files_digest(self.source), before)
        self.assertEqual((self.output / "bridge-token").read_bytes(), (self.source / "bridge-token").read_bytes())
        self.assertEqual((self.output / "worker-token").read_bytes(), (self.source / "worker-token").read_bytes())
        self.assertEqual((self.output / "worker-config.json").read_bytes(), (self.source / "worker-config.json").read_bytes())
        for path in [self.output, *self.output.rglob("*")]:
            self.assertEqual(path.stat().st_mode & 0o077, 0)
        manifest = json.loads((self.output / exporter.MANIFEST).read_text())
        self.assertEqual(manifest["version"], 1)
        self.assertEqual({row["path"] for row in manifest["files"]}, expected - {exporter.MANIFEST})
        for row in manifest["files"]:
            payload = (self.output / row["path"]).read_bytes()
            self.assertEqual(row["size"], len(payload))
            self.assertEqual(row["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertNotIn("fixture-bridge-", json.dumps(manifest))
        self.assertNotIn("fixture-contact-hash", json.dumps(manifest))
        exporter.cloud.validate_state(self.output)

    def test_ledger_outcomes_and_pending_receipts_are_preserved(self):
        exporter.export_state(self.source, self.output)
        with closing(sqlite3.connect(self.output / "worker-ledger.db")) as db:
            self.assertEqual(db.execute("SELECT * FROM jobs").fetchall(), [("fixture-job", "fixture-digest", "sent")])
            self.assertEqual(db.execute("SELECT * FROM pending_acks").fetchall(), [("fixture-ack", "fixture-lease", "indeterminate")])

    def test_committed_wal_is_backed_up_without_exporting_or_changing_source_sidecars(self):
        with closing(sqlite3.connect(self.source / "store/activity.db")) as writer:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO activity VALUES('fixture-wal','fixture-wal-event','',456)")
            writer.commit()
            for path in (self.source / "store").glob("activity.db*"):
                path.chmod(0o600)
            before = files_digest(self.source)
            exporter.export_state(self.source, self.output)
            self.assertEqual(files_digest(self.source), before)
            with closing(sqlite3.connect(self.output / "store/activity.db")) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM activity").fetchone(), (2,))
            self.assertFalse(any(path.name.endswith(("-wal", "-shm", "-journal")) for path in self.output.rglob("*")))

    def test_worker_lock_held_elsewhere_blocks_export_without_creating_output(self):
        with (self.source / "worker.lock").open("r") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, "worker_running"):
                exporter.export_state(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_output_is_never_replaced_or_deleted(self):
        self.output.mkdir(mode=0o700)
        write_private(self.output / "keep", "fixture-sentinel")
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        self.assertEqual((self.output / "keep").read_text(), "fixture-sentinel")

    def test_overlap_and_traversal_are_rejected(self):
        for output in (self.source / "nested-export", self.source, self.base / "absent" / ".." / "exported"):
            with self.subTest(output=output):
                with self.assertRaises(ValueError):
                    exporter.export_state(self.source, output)
        self.assertFalse((self.source / "nested-export").exists())

    def test_symlinked_source_or_output_parent_is_rejected(self):
        link = self.base / "source-link"
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            exporter.export_state(link, self.output)
        parent = self.base / "parent-link"
        parent.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, parent / "exported")

    def test_required_symlink_and_non_regular_file_are_rejected(self):
        token = self.source / "bridge-token"
        token.rename(self.source / "real-token")
        token.symlink_to(self.source / "real-token")
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        token.unlink()
        token.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)

    def test_sidecar_symlink_cannot_escape_allowlist(self):
        sidecar = self.source / "store/activity.db-wal"
        sidecar.symlink_to(self.source / "bridge-token")
        before = (self.source / "bridge-token").read_bytes()
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        self.assertEqual((self.source / "bridge-token").read_bytes(), before)
        self.assertFalse(self.output.exists())

    def test_source_missing_worker_lock_is_not_mutated(self):
        (self.source / "worker.lock").unlink()
        before = files_digest(self.source)
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        self.assertEqual(files_digest(self.source), before)
        self.assertFalse(self.output.exists())

    def test_corruption_cleans_new_output_but_keeps_original_unchanged(self):
        write_private(self.source / "store/activity.db", "fixture-invalid-database")
        before = files_digest(self.source)
        with self.assertRaises((ValueError, sqlite3.DatabaseError)):
            exporter.export_state(self.source, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(files_digest(self.source), before)
        self.assertFalse(list(self.base.glob(".mel-state-snapshot-*")))

    def test_incomplete_schema_and_disabled_worker_cannot_export_as_ready(self):
        with closing(sqlite3.connect(self.source / "worker-ledger.db")) as db:
            db.execute("DROP TABLE pending_acks")
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        self.assertFalse(self.output.exists())
        with closing(sqlite3.connect(self.source / "worker-ledger.db")) as db:
            db.execute("CREATE TABLE pending_acks(id TEXT,lease_token TEXT,outcome TEXT)")
        write_private(self.source / "worker-config.json", '{"enabled":false}')
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_source_changes_during_snapshot_are_rejected(self):
        real_copy = exporter._copy_readonly

        def changing_copy(source, destination):
            real_copy(source, destination)
            if source == self.source / "worker-token":
                write_private(self.source / "bridge-token", "changed-fixture-" + "z" * 64)

        with patch.object(exporter, "_copy_readonly", side_effect=changing_copy):
            with self.assertRaisesRegex(ValueError, "source_changed"):
                exporter.export_state(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_permissive_source_is_rejected_and_not_chmodded(self):
        path = self.source / "bridge-token"
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            exporter.export_state(self.source, self.output)
        self.assertEqual(path.stat().st_mode & 0o777, 0o644)

    def test_cli_only_prints_summary_on_success_and_generic_failure_on_error(self):
        success = io.StringIO()
        with redirect_stdout(success):
            result = exporter.main(["--source", str(self.source), "--output", str(self.output)])
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(success.getvalue()), {"state": "exported", "fileCount": 8})
        failure = io.StringIO()
        with redirect_stdout(failure):
            result = exporter.main(["--source", str(self.source), "--output", str(self.output)])
        self.assertEqual(result, 1)
        self.assertEqual(json.loads(failure.getvalue()), {"state": "failed", "code": "state_export_unavailable"})
        self.assertNotIn(str(self.source), failure.getvalue())
        self.assertNotIn("fixture-bridge-", success.getvalue() + failure.getvalue())


if __name__ == "__main__":
    unittest.main()
