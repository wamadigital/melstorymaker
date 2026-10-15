"""Importação por memória/stdin; nunca abre cliente ou envia WhatsApp."""

import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("mel_receive_state_test", Path(__file__).with_name("receive_state.py"))
receiver = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(receiver)


class ReceiveStateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mel-import-test-")
        self.addCleanup(self.temporary.cleanup)
        self.data = Path(self.temporary.name) / "volume with spaces; literal"
        self.data.mkdir(mode=0o700)
        self.payloads = {name: (name + "-fixture").encode() for name in receiver.PAYLOAD_FILES}
        self.payloads[".cloud-ready.json"] = b'{"version":1}'
        self.validator = Mock()

    def manifest(self):
        return {"version": 1, "files": [
            {"path": name, "size": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            for name, body in sorted(self.payloads.items())
        ]}

    def archive(self, *, entries=None, manifest=None, trailing=b"", format=tarfile.USTAR_FORMAT):
        if entries is None:
            values = {**self.payloads, receiver.MANIFEST_NAME: json.dumps(manifest or self.manifest()).encode()}
            entries = [(name, body, tarfile.REGTYPE, "") for name, body in values.items()]
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=format) as archive:
            for name, body, kind, link in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = link
                member.size = len(body)
                archive.addfile(member, io.BytesIO(body))
        return io.BytesIO(gzip.compress(raw.getvalue() + trailing))

    def assert_rejected(self, archive, validator=None):
        with self.assertRaisesRegex(receiver.ImportRejected, "^import_rejected$"):
            receiver.receive(archive, self.data, validator or self.validator)
        self.assertFalse((self.data / "state").exists())
        self.assertFalse((self.data / "enable-cloud").exists())
        self.assertEqual(list(self.data.glob(".state-import-*")), [])

    def test_valid_import_is_atomic_private_and_never_activates(self):
        def validate(staging):
            self.assertNotEqual(staging.name, "state")
            self.assertFalse((self.data / "state").exists())
            self.assertEqual(staging.stat().st_mode & 0o777, 0o700)
            for name, content in self.payloads.items():
                self.assertEqual((staging / name).read_bytes(), content)
                self.assertEqual((staging / name).stat().st_mode & 0o777, 0o600)
            self.assertEqual((staging / "store").stat().st_mode & 0o777, 0o700)
        result = receiver.receive(self.archive(), self.data, validate)
        self.assertEqual(result, {"state": "imported", "files": 8})
        self.assertTrue((self.data / "state").is_dir())
        self.assertFalse((self.data / "enable-cloud").exists())
        self.assertEqual(list(self.data.glob(".state-import-*")), [])

    def test_existing_state_is_not_replaced_or_read(self):
        state = self.data / "state"
        state.mkdir()
        (state / "sentinel").write_bytes(b"keep")
        with self.assertRaises(receiver.ImportRejected):
            receiver.receive(self.archive(), self.data, self.validator)
        self.assertEqual((state / "sentinel").read_bytes(), b"keep")
        self.validator.assert_not_called()

    def test_existing_activation_is_refused_before_read(self):
        activation = self.data / "enable-cloud"
        activation.write_bytes(b"keep")
        stream = Mock()
        with self.assertRaises(receiver.ImportRejected):
            receiver.receive(stream, self.data, self.validator)
        stream.read.assert_not_called()
        self.assertEqual(activation.read_bytes(), b"keep")

    def test_dangling_state_symlink_is_not_replaced(self):
        state = self.data / "state"
        state.symlink_to(self.data / "missing")
        with self.assertRaises(receiver.ImportRejected):
            receiver.receive(self.archive(), self.data, self.validator)
        self.assertTrue(state.is_symlink())

    def test_missing_payload_is_refused(self):
        del self.payloads["worker-token"]
        self.assert_rejected(self.archive())
        self.validator.assert_not_called()

    def test_extra_file_is_refused(self):
        self.payloads[".env"] = b"not-permitted"
        self.assert_rejected(self.archive())
        self.validator.assert_not_called()

    def test_duplicate_member_is_refused(self):
        self.assert_rejected(self.archive(entries=[
            ("bridge-token", b"first", tarfile.REGTYPE, ""),
            ("bridge-token", b"second", tarfile.REGTYPE, ""),
        ]))

    def test_traversal_absolute_and_prefixed_names_are_refused(self):
        for name in ("../bridge-token", "/bridge-token", "./bridge-token", "store/../worker-token"):
            with self.subTest(name=name):
                self.assert_rejected(self.archive(entries=[(name, b"x", tarfile.REGTYPE, "")]))

    def test_symlinks_hardlinks_directories_and_special_headers_are_refused(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE, tarfile.FIFOTYPE,
                     tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME):
            with self.subTest(kind=kind):
                self.assert_rejected(self.archive(entries=[("bridge-token", b"", kind, "")]))

    def test_hash_or_size_mismatch_is_refused(self):
        for field, value in (("sha256", "0" * 64), ("size", 999)):
            with self.subTest(field=field):
                manifest = self.manifest()
                manifest["files"][0][field] = value
                self.assert_rejected(self.archive(manifest=manifest))
        self.validator.assert_not_called()

    def test_manifest_requires_exact_schema_and_eight_unique_payloads(self):
        variants = []
        boolean_version = self.manifest()
        boolean_version["version"] = True
        variants.append(boolean_version)
        extra_key = self.manifest()
        extra_key["enable"] = True
        variants.append(extra_key)
        duplicate = self.manifest()
        duplicate["files"][-1] = duplicate["files"][0]
        variants.append(duplicate)
        for manifest in variants:
            with self.subTest(manifest=manifest):
                self.assert_rejected(self.archive(manifest=manifest))

    def test_gzip_truncation_and_nonzero_trailing_data_are_refused(self):
        self.assert_rejected(io.BytesIO(self.archive().getvalue()[:-3]))
        self.assert_rejected(self.archive(trailing=b"another-hidden-archive"))

    def test_decompressed_limit_includes_padding(self):
        with patch.object(receiver, "MAX_DECOMPRESSED_BYTES", 16 * 1024):
            self.assert_rejected(self.archive(trailing=b"\x00" * (32 * 1024)))

    def test_validator_error_is_sanitized_and_staging_is_removed(self):
        def reject(_):
            raise ValueError("PRIVATE_TOKEN_MUST_NOT_APPEAR")
        self.assert_rejected(self.archive(), reject)

    def test_state_created_during_validation_is_preserved(self):
        def race(_):
            (self.data / "state").mkdir()
        with self.assertRaises(receiver.ImportRejected):
            receiver.receive(self.archive(), self.data, race)
        self.assertEqual(list((self.data / "state").iterdir()), [])
        self.assertEqual(list(self.data.glob(".state-import-*")), [])

    def test_atomic_rename_never_overwrites_existing_empty_directory(self):
        source = self.data / "staging"
        destination = self.data / "state"
        source.mkdir()
        destination.mkdir()
        with self.assertRaises(OSError):
            receiver._rename_without_replacement(source, destination)
        self.assertTrue(source.is_dir())
        self.assertTrue(destination.is_dir())

    def test_real_cloud_validator_accepts_consistent_fixture_databases(self):
        spec = importlib.util.spec_from_file_location("mel_cloud_fixture_validation", Path(__file__).with_name("cloud.py"))
        cloud = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(cloud)
        self.assertEqual(receiver.PAYLOAD_FILES, set(cloud.REQUIRED) | {".cloud-ready.json"})
        self.payloads["bridge-token"] = b"b" * 48
        self.payloads["worker-token"] = b"w" * 48
        self.payloads["worker-config.json"] = b'{"enabled":true}'
        for index, (name, tables) in enumerate(cloud.SCHEMAS.items()):
            path = Path(self.temporary.name) / f"fixture-{index}.db"
            with sqlite3.connect(path) as db:
                for table, columns in tables.items():
                    declarations = ",".join(f'"{column}" TEXT' for column in columns)
                    db.execute(f'CREATE TABLE "{table}" ({declarations})')
                if name == "store/whatsapp.db":
                    db.execute("INSERT INTO whatsmeow_device (jid) VALUES (?)", ("fixture@s.whatsapp.net",))
            self.payloads[name] = path.read_bytes()
        result = receiver.receive(self.archive(), self.data, cloud.validate_state)
        self.assertEqual(result["state"], "imported")

    def test_source_can_be_executed_without_file_global(self):
        namespace = {"__name__": "test_remote_import_source"}
        exec(Path(receiver.__file__).read_text(), namespace)
        self.assertIn("receive", namespace)
        self.assertNotIn("__file__", namespace)


if __name__ == "__main__":
    unittest.main()
