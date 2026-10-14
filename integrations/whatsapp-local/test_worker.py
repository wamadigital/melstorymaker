import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import worker
from worker import Ledger, iteration, process


class FakeAPI:
    def __init__(self, accepted=True, fail_final=False, active=True):
        self.calls = []
        self.receipts = []
        self.trace = []
        self.accepted = accepted
        self.fail_final = fail_final
        self.active = active

    async def result(self, job, outcome, code=None):
        self.calls.append((outcome, code))
        self.receipts.append(dict(job))
        self.trace.append(("result", outcome))
        if outcome != "started" and self.fail_final:
            raise ConnectionError("API fictícia indisponível")
        return {"accepted": self.accepted}

    async def claim(self):
        self.trace.append(("claim", None))
        # Jobs iniciados não voltam no claim real, mesmo após perda de ACK.
        return {"active": self.active, "job": None}


class FakeMCP:
    def __init__(self, ready=True, sent=True, error=False):
        self.connected = ready
        self.sent = sent
        self.error = error
        self.calls = 0

    async def ready(self):
        return self.connected

    async def send(self, job):
        self.calls += 1
        if self.error:
            raise TimeoutError("Envio fictício de resultado desconhecido")
        return self.sent


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger_path = Path(self.tmp.name) / "worker-ledger.db"
        self.ledger = Ledger(self.ledger_path)
        self.job = {"id": "ficticio-1", "leaseToken": "teste", "recipient": "5511999999999", "message": "Mensagem fictícia", "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}

    def tearDown(self):
        self.ledger.close()
        self.tmp.cleanup()

    def run_process(self, api, mcp):
        return asyncio.run(process(api, mcp, self.ledger, self.job))

    def restart_ledger(self):
        self.ledger.close()
        self.ledger = Ledger(self.ledger_path)

    def test_cloud_approval_precedes_send(self):
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_process(api, mcp), "sent")
        self.assertEqual(api.calls, [("started", None), ("sent", None)])
        self.assertEqual(self.ledger.get(self.job), "sent")
        self.assertEqual(self.ledger.pending(), [])

    def test_rejected_start_never_sends(self):
        api, mcp = FakeAPI(accepted=False), FakeMCP()
        self.assertEqual(self.run_process(api, mcp), "rejected")
        self.assertEqual(mcp.calls, 0)
        self.assertIsNone(self.ledger.get(self.job))

    def test_disconnected_never_starts(self):
        api, mcp = FakeAPI(), FakeMCP(ready=False)
        self.assertEqual(self.run_process(api, mcp), "not_connected")
        self.assertEqual(api.calls, [("failed", "bridge_disconnected")])
        self.assertEqual(mcp.calls, 0)

    def test_expired_job_never_sends(self):
        self.job["expiresAt"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        mcp = FakeMCP()
        self.assertEqual(self.run_process(FakeAPI(), mcp), "expired")
        self.assertEqual(mcp.calls, 0)

    def test_confirmed_job_is_not_resent(self):
        self.ledger.set(self.job, "sent")
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_process(api, mcp), "reconciled")
        self.assertEqual(api.calls, [("sent", None)])
        self.assertEqual(mcp.calls, 0)

    def test_crash_before_confirmation_is_not_resent(self):
        self.ledger.set(self.job, "started")
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_process(api, mcp), "reconciled")
        self.assertEqual(api.calls, [("indeterminate", None)])
        self.assertEqual(mcp.calls, 0)

    def test_timeout_stays_indeterminate(self):
        api, mcp = FakeAPI(), FakeMCP(error=True)
        self.assertEqual(self.run_process(api, mcp), "indeterminate")
        self.assertEqual(self.ledger.get(self.job), "indeterminate")
        self.run_process(api, mcp)
        self.assertEqual(mcp.calls, 1)

    def test_lost_cloud_confirmation_keeps_local_receipt(self):
        api, mcp = FakeAPI(fail_final=True), FakeMCP()
        with self.assertRaises(ConnectionError):
            self.run_process(api, mcp)
        self.assertEqual(self.ledger.get(self.job), "sent")
        self.run_process(FakeAPI(), mcp)
        self.assertEqual(mcp.calls, 1)

    def test_changed_payload_is_never_sent_again(self):
        self.ledger.set(self.job, "sent")
        self.job["message"] = "Conteúdo divergente"
        api, mcp = FakeAPI(), FakeMCP()
        self.run_process(api, mcp)
        self.assertEqual(api.calls, [("indeterminate", None)])
        self.assertEqual(mcp.calls, 0)

    def test_restart_reconciles_without_job_returning_in_claim(self):
        mcp = FakeMCP()
        with self.assertRaises(ConnectionError):
            self.run_process(FakeAPI(fail_final=True), mcp)
        self.restart_ledger()
        unavailable = FakeAPI(fail_final=True)
        self.assertEqual(asyncio.run(iteration(unavailable, mcp, self.ledger)), "idle")
        self.assertEqual(unavailable.trace, [("result", "sent"), ("claim", None)])
        self.assertEqual(len(self.ledger.pending()), 1)
        self.restart_ledger()
        recovered = FakeAPI()
        self.assertEqual(asyncio.run(iteration(recovered, mcp, self.ledger)), "idle")
        self.assertEqual(recovered.trace, [("result", "sent"), ("claim", None)])
        self.assertEqual(self.ledger.pending(), [])
        self.assertEqual(mcp.calls, 1)

    def test_crash_before_mcp_persists_indeterminate_ack(self):
        class SimulatedCrash(BaseException):
            pass

        mcp = FakeMCP()
        with patch.object(worker, "unexpired", side_effect=[True, SimulatedCrash()]):
            with self.assertRaises(SimulatedCrash):
                self.run_process(FakeAPI(), mcp)
        self.assertEqual(self.ledger.get(self.job), "started")
        self.restart_ledger()
        api = FakeAPI()
        asyncio.run(iteration(api, mcp, self.ledger))
        self.assertEqual(api.trace, [("result", "indeterminate"), ("claim", None)])
        self.assertEqual(mcp.calls, 0)
        self.assertEqual(self.ledger.pending(), [])

    def test_rejected_ack_remains_pending(self):
        self.ledger.set(self.job, "sent")
        api, mcp = FakeAPI(accepted=False), FakeMCP()
        asyncio.run(iteration(api, mcp, self.ledger))
        self.assertEqual(len(self.ledger.pending()), 1)
        self.assertEqual(self.ledger.get(self.job), "sent")
        self.assertEqual(mcp.calls, 0)

    def test_reconciliation_runs_even_when_automation_is_off(self):
        self.ledger.set(self.job, "sent")
        api, mcp = FakeAPI(active=False), FakeMCP()
        self.assertEqual(asyncio.run(iteration(api, mcp, self.ledger)), "inactive")
        self.assertEqual(api.trace, [("result", "sent"), ("claim", None)])
        self.assertEqual(self.ledger.pending(), [])
        self.assertEqual(mcp.calls, 0)

    def test_offline_iteration_never_claims_or_sends(self):
        api, mcp = FakeAPI(), FakeMCP(ready=False)
        self.assertEqual(asyncio.run(iteration(api, mcp, self.ledger)), "not_connected")
        self.assertEqual(api.trace, [])
        self.assertEqual(mcp.calls, 0)

    def test_offline_iteration_still_flushes_acks_without_claiming(self):
        self.ledger.set(self.job, "sent")
        api, mcp = FakeAPI(), FakeMCP(ready=False)
        self.assertEqual(asyncio.run(iteration(api, mcp, self.ledger)), "not_connected")
        self.assertEqual(api.trace, [("result", "sent")])
        self.assertEqual(self.ledger.pending(), [])
        self.assertEqual(mcp.calls, 0)

    def test_failed_preflight_never_claims(self):
        api, mcp = FakeAPI(), FakeMCP()
        with patch.object(mcp, "ready", side_effect=ConnectionError("bridge fictício offline")):
            self.assertEqual(asyncio.run(iteration(api, mcp, self.ledger)), "not_connected")
        self.assertEqual(api.trace, [])
        self.assertEqual(mcp.calls, 0)

    def test_ack_stores_lease_without_phone_or_message(self):
        self.ledger.set(self.job, "started")
        pending = self.ledger.pending()
        self.assertEqual(pending, [{
            "id": self.job["id"], "leaseToken": self.job["leaseToken"],
            "outcome": "indeterminate",
        }])
        columns = [row[1] for row in self.ledger.db.execute("PRAGMA table_info(pending_acks)")]
        self.assertEqual(columns, ["id", "lease_token", "outcome"])
        data = self.ledger_path.read_bytes()
        self.assertNotIn(self.job["recipient"].encode(), data)
        self.assertNotIn(self.job["message"].encode(), data)
        api = FakeAPI()
        asyncio.run(iteration(api, FakeMCP(), self.ledger))
        self.assertEqual(set(api.receipts[0]), {"id", "leaseToken", "outcome"})

    def test_ledger_and_ack_transition_rollback_together(self):
        self.ledger.db.execute("CREATE TRIGGER reject_ack BEFORE INSERT ON pending_acks BEGIN SELECT RAISE(ABORT, 'falha ficticia'); END")
        self.ledger.db.commit()
        with self.assertRaises(worker.sqlite3.IntegrityError):
            self.ledger.set(self.job, "started")
        self.assertIsNone(self.ledger.get(self.job))
        self.assertEqual(self.ledger.pending(), [])

    def test_sent_replaces_started_ack_atomically(self):
        self.ledger.set(self.job, "started")
        self.ledger.set(self.job, "sent")
        self.restart_ledger()
        self.assertEqual(self.ledger.get(self.job), "sent")
        self.assertEqual(self.ledger.pending(), [{
            "id": self.job["id"], "leaseToken": self.job["leaseToken"], "outcome": "sent",
        }])

    def test_restart_flushes_receipt_even_when_mcp_cannot_start(self):
        self.ledger.set(self.job, "sent")
        state = Path(self.tmp.name)
        (state / "worker-config.json").write_text('{"enabled":true}')
        (state / "worker-token").write_text("token-ficticio-do-worker-para-teste-local")
        api = FakeAPI()
        api.session = SimpleNamespace(close=lambda: None)
        with patch.object(worker, "STATE", state), patch.object(worker, "API", return_value=api), patch.object(
            worker, "stdio_client", side_effect=RuntimeError("MCP fictício indisponível")
        ):
            with self.assertRaisesRegex(RuntimeError, "indisponível"):
                asyncio.run(worker.run(once=True))
        self.assertEqual(api.trace, [("result", "sent")])
        self.assertEqual(self.ledger.pending(), [])


if __name__ == "__main__":
    unittest.main()
