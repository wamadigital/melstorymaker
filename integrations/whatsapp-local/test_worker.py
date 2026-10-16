import asyncio
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, AsyncMock

import worker
from worker import Ledger, iteration, process


class FakeAPI:
    def __init__(self, accepted=True, fail_final=False, active=True, starts=None):
        self.calls = []
        self.receipts = []
        self.trace = []
        self.accepted = accepted
        self.fail_final = fail_final
        self.active = active
        self.starts = list(starts) if starts is not None else []
        self.activities = []

    async def result(self, job, outcome, code=None, activity=None):
        self.calls.append((outcome, code))
        self.receipts.append(dict(job))
        self.trace.append(("result", outcome))
        if activity is not None:
            self.activities.append(deepcopy(activity))
        if outcome != "started" and self.fail_final:
            raise ConnectionError("API fictícia indisponível")
        if outcome == "started" and self.starts:
            accepted = self.starts.pop(0)
            if isinstance(accepted, BaseException):
                raise accepted
            return {"accepted": accepted}
        return {"accepted": self.accepted}

    async def claim(self):
        self.trace.append(("claim", None))
        # Jobs iniciados não voltam no claim real, mesmo após perda de ACK.
        return {"active": self.active, "job": None}


class FakeMCP:
    def __init__(self, ready=True, sent=True, error=False, outcomes=None):
        self.connected = ready
        self.sent = sent
        self.error = error
        self.calls = 0
        self.jobs = []
        self.outcomes = list(outcomes) if outcomes is not None else []

    async def ready(self):
        return self.connected

    async def send(self, job):
        self.calls += 1
        self.jobs.append(dict(job))
        if self.outcomes:
            result = self.outcomes.pop(0)
            if isinstance(result, BaseException):
                raise result
            return result
        if self.error:
            raise TimeoutError("Envio fictício de resultado desconhecido")
        return self.sent


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger_path = Path(self.tmp.name) / "worker-ledger.db"
        self.ledger = Ledger(self.ledger_path)
        self.job = {"id": "c350bc94-24f1-4359-9e92-eac5f1a76e44", "leaseToken": "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369", "recipient": "5511999999999", "message": "Mensagem fictícia", "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}

    def tearDown(self):
        self.ledger.close()
        self.tmp.cleanup()

    def run_process(self, api, mcp):
        return asyncio.run(process(api, mcp, self.ledger, self.job))

    def restart_ledger(self):
        self.ledger.close()
        self.ledger = Ledger(self.ledger_path)

    def sequence(self):
        self.now = datetime(2026, 10, 15, 15, tzinfo=timezone.utc)
        self.sleeps = []
        self.texts = ["Primeira mensagem fictícia 💛", "Segunda mensagem fictícia", "Terceira mensagem fictícia",
                      "https://crm.invalid/continuar/" + self.job["id"]]
        self.job["message"] = "\n\n".join(self.texts)
        self.job["expiresAt"] = (self.now + timedelta(hours=1)).isoformat()
        self.job["messagesSequence"] = [
            {"message": message, "delayBeforeSeconds": delay}
            for message, delay in zip(self.texts, (0, 2, 3, 2))
        ]

    async def fake_sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += timedelta(seconds=seconds)

    def run_sequence(self, api, mcp, **options):
        return asyncio.run(process(api, mcp, self.ledger, self.job,
                                   sleep=options.get("sleep", self.fake_sleep), clock=lambda: self.now))

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

    def test_api_negotiates_header_with_unchanged_legacy_json(self):
        api = worker.API("token-ficticio-com-mais-de-trinta-e-dois-caracteres")
        self.addCleanup(api.session.close)
        requests = []

        def send(request, **kwargs):
            self.assertTrue(request.url.startswith("https://worker-ficticio.invalid/"))
            self.assertEqual(request.headers["X-Mel-Worker-Protocol"], "5")
            self.assertEqual(kwargs["allow_redirects"], False)
            requests.append(json.loads(request.body))
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"accepted": True, "protocolVersion": 5})

        with patch.object(worker, "ORIGIN", "https://worker-ficticio.invalid"), patch.object(api.session, "send", side_effect=send):
            asyncio.run(api.claim())
            asyncio.run(api.result(self.job, "started"))
            asyncio.run(api.result(self.job, "sent"))
        self.assertEqual(requests, [{}, {"leaseToken": self.job["leaseToken"], "outcome": "started"},
                                   {"leaseToken": self.job["leaseToken"], "outcome": "sent"}])

    def test_legacy_digest_stays_byte_compatible_and_never_sleeps(self):
        self.assertEqual(Ledger.digest(self.job), "78564e27013fa92703b2616603c1bcc942b5c7d52327b81f7315015cc2b0d48c")
        api, mcp = FakeAPI(), FakeMCP()
        async def unexpected_sleep(_seconds):
            self.fail("Confirmação legada não usa pausas ou chamadas adicionais")
        self.assertEqual(asyncio.run(process(api, mcp, self.ledger, self.job, sleep=unexpected_sleep)), "sent")
        self.assertEqual(api.calls, [("started", None), ("sent", None)])
        self.assertEqual(mcp.jobs, [self.job])

    def test_sequence_digest_protects_text_order_delays_and_fallback(self):
        self.sequence()
        digest = Ledger.digest(self.job)
        mutations = []
        for field in ("message", "delayBeforeSeconds"):
            changed = deepcopy(self.job)
            changed["messagesSequence"][1][field] = "Texto alterado" if field == "message" else 3
            mutations.append(changed)
        changed = deepcopy(self.job)
        changed["messagesSequence"].reverse()
        mutations.append(changed)
        changed = deepcopy(self.job)
        changed["message"] += " Outro fallback"
        mutations.append(changed)
        legacy = {key: self.job[key] for key in worker.LEGACY_JOB_FIELDS}
        self.assertNotEqual(digest, Ledger.digest(legacy))
        for changed in mutations:
            self.assertNotEqual(digest, Ledger.digest(changed))

    def test_sequence_waits_for_each_ack_then_delay_and_reauthorization(self):
        self.sequence()
        trace = []
        test = self

        class TraceAPI(FakeAPI):
            async def result(self, job, outcome, code=None):
                result = await super().result(job, outcome, code)
                trace.append(("api", outcome))
                return result

        async def scenario():
            first_started, release_first = asyncio.Event(), asyncio.Event()

            class TraceMCP(FakeMCP):
                async def ready(self):
                    trace.append(("ready", None))
                    return True

                async def send(self, job):
                    trace.append(("send", job["message"]))
                    test.assertEqual(set(job), set(worker.LEGACY_JOB_FIELDS))
                    if not self.calls:
                        first_started.set()
                        await release_first.wait()
                    result = await super().send(job)
                    trace.append(("ack", job["message"]))
                    return result

            async def sleep(seconds):
                trace.append(("sleep", seconds))
                await test.fake_sleep(seconds)

            api, mcp = TraceAPI(), TraceMCP()
            task = asyncio.create_task(process(api, mcp, test.ledger, test.job, sleep=sleep, clock=lambda: test.now))
            await first_started.wait()
            test.assertFalse(any(event == "sleep" for event, _ in trace), "Pausa não começa com envio ainda pendente")
            test.assertEqual(test.ledger.pending()[0]["outcome"], "indeterminate")
            release_first.set()
            test.assertEqual(await task, "sent")
            return api, mcp

        api, mcp = asyncio.run(scenario())
        expected = [("ready", None), ("api", "started")]
        for index, message in enumerate(self.texts):
            if index:
                expected.extend([("sleep", (0, 2, 3, 2)[index]), ("ready", None), ("api", "started")])
            expected.extend([("send", message), ("ack", message)])
        expected.append(("api", "sent"))
        self.assertEqual(trace, expected)
        self.assertEqual([job["message"] for job in mcp.jobs], self.texts)
        self.assertEqual(self.sleeps, [2, 3, 2])
        self.assertEqual(api.calls, [("started", None)] * 4 + [("sent", None)])
        self.assertEqual(self.ledger.get(self.job), "sent")
        self.assertEqual(self.ledger.pending(), [])
        for message in self.texts:
            self.assertNotIn(message.encode(), self.ledger_path.read_bytes())

    def test_second_message_failure_stops_remaining_and_restart_only_reconciles(self):
        self.sequence()
        api, mcp = FakeAPI(), FakeMCP(outcomes=[True, False])
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual([job["message"] for job in mcp.jobs], self.texts[:2])
        self.assertEqual(self.sleeps, [2])
        self.restart_ledger()
        self.assertEqual(asyncio.run(iteration(FakeAPI(), mcp, self.ledger)), "idle")
        self.assertEqual(mcp.calls, 2)

    def test_second_message_timeout_stays_indeterminate_without_retry(self):
        self.sequence()
        api, mcp = FakeAPI(), FakeMCP(outcomes=[True, TimeoutError("erro fictício")])
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 2)
        self.assertEqual(self.ledger.get(self.job), "indeterminate")
        self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
        self.assertEqual(mcp.calls, 2)

    def test_flag_off_before_next_part_stops_after_previous_ack(self):
        self.sequence()
        api, mcp = FakeAPI(starts=[True, False]), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual([job["message"] for job in mcp.jobs], self.texts[:1])
        self.assertEqual(self.sleeps, [2])
        self.assertEqual(api.calls, [("started", None), ("started", None), ("indeterminate", None)])

    def test_reauthorization_timeout_stops_remaining(self):
        self.sequence()
        api, mcp = FakeAPI(starts=[True, ConnectionError("rede fictícia")]), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(self.ledger.get(self.job), "indeterminate")

    def test_clock_expiry_during_delay_never_sends_next_part(self):
        self.sequence()
        self.job["expiresAt"] = (self.now + timedelta(seconds=1)).isoformat()
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])

    def test_offline_after_delay_stops_without_authorizing_next_part(self):
        self.sequence()
        api, mcp = FakeAPI(), FakeMCP()
        with patch.object(mcp, "ready", side_effect=[True, False]):
            self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])

    def test_cancelled_delay_persists_indeterminate_and_propagates_shutdown(self):
        self.sequence()
        api, mcp = FakeAPI(), FakeMCP()
        async def cancel(_seconds):
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            self.run_sequence(api, mcp, sleep=cancel)
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(self.ledger.get(self.job), "indeterminate")
        self.assertEqual(self.ledger.pending()[0]["outcome"], "indeterminate")
        self.restart_ledger()
        recovered = FakeAPI()
        asyncio.run(iteration(recovered, mcp, self.ledger))
        self.assertEqual(recovered.calls, [("indeterminate", None)])
        self.assertEqual(mcp.calls, 1)

    def test_crash_between_parts_never_resumes_sequence(self):
        self.sequence()
        class SimulatedCrash(BaseException):
            pass
        async def crash(_seconds):
            raise SimulatedCrash()
        mcp = FakeMCP()
        with self.assertRaises(SimulatedCrash):
            self.run_sequence(FakeAPI(), mcp, sleep=crash)
        self.restart_ledger()
        api = FakeAPI()
        asyncio.run(iteration(api, mcp, self.ledger))
        self.assertEqual(api.calls, [("indeterminate", None)])
        self.assertEqual(mcp.calls, 1)

    def test_lost_final_sequence_ack_reconciles_without_repeating_four_messages(self):
        self.sequence()
        mcp = FakeMCP()
        with self.assertRaises(ConnectionError):
            self.run_sequence(FakeAPI(fail_final=True), mcp)
        self.assertEqual(mcp.calls, 4)
        self.assertEqual(self.ledger.pending()[0]["outcome"], "sent")
        self.restart_ledger()
        recovered = FakeAPI()
        asyncio.run(iteration(recovered, mcp, self.ledger))
        self.assertEqual(recovered.calls, [("sent", None)])
        self.assertEqual(mcp.calls, 4)

    def test_malformed_sequence_or_unknown_format_never_starts_or_sends(self):
        self.sequence()
        malformed = []
        for value in (None, [], self.job["messagesSequence"][:3], "mensagens", [None] * 4):
            job = deepcopy(self.job)
            job["messagesSequence"] = value
            malformed.append(job)
        for field, value in (("message", " "), ("message", "\ud800"), ("delayBeforeSeconds", True),
                             ("delayBeforeSeconds", -2), ("delayBeforeSeconds", 2.0)):
            job = deepcopy(self.job)
            job["messagesSequence"][1][field] = value
            malformed.append(job)
        job = deepcopy(self.job)
        job["messagesSequence"][0]["unknown"] = "nao aceito"
        malformed.append(job)
        job = deepcopy(self.job)
        job["unknownFormat"] = 3
        malformed.append(job)
        for job in malformed:
            api, mcp = FakeAPI(), FakeMCP()
            self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job, sleep=self.fake_sleep)), "invalid_job")
            self.assertEqual(api.calls, [])
            self.assertEqual(mcp.calls, 0)
            self.assertIsNone(self.ledger.get(job))

    def proposal(self, kind="lembrete_proposta_7d"):
        self.now = datetime.now(timezone.utc)
        self.sleeps = []
        self.job["tipo"] = kind
        self.job["expiresAt"] = (self.now + timedelta(hours=1)).isoformat()
        self.texts = [text if text is not None else "https://proposal.invalid/proposta.pdf"
                      for text in worker.PROPOSAL_TEXTS[kind]]
        self.job["message"] = "\n\n".join(self.texts)
        self.job["messagesSequence"] = [
            {"message": text, "delayBeforeSeconds": delay}
            for text, delay in zip(self.texts, worker.PROPOSAL_DELAYS[kind])]

    def activity_proof(self):
        return {"checkedAt": self.now.isoformat(),
                "coverageStartedAt": (self.now - timedelta(days=16)).isoformat(),
                "lastInteractionAt": None, "complete": True}

    def proposal_mcp(self, decisions=None):
        mcp = FakeMCP()
        mcp.activity_calls = []
        pending = list(decisions or [])
        async def check(job):
            mcp.activity_calls.append(job["id"])
            if pending:
                value = pending.pop(0)
                if isinstance(value, BaseException):
                    raise value
                return value
            return {"allowed": True, "activity": self.activity_proof(), "code": "inactivity_clear"}
        mcp.activity = check
        return mcp

    def test_proposal_sequences_keep_exact_copy_delays_and_check_every_part(self):
        for kind, delays in worker.PROPOSAL_DELAYS.items():
            with self.subTest(kind=kind):
                self.proposal(kind)
                # Fresh ID per scenario: reuse would correctly reconcile instead.
                self.job["id"] = "c350bc94-24f1-4359-9e92-eac5f1a76e4" + ("4" if kind.endswith("7d") else "5")
                api, mcp = FakeAPI(), self.proposal_mcp()
                self.assertEqual(self.run_sequence(api, mcp), "sent")
                self.assertEqual([job["message"] for job in mcp.jobs], self.texts)
                self.assertEqual(self.sleeps, list(delays[1:]))
                self.assertEqual(len(mcp.activity_calls), len(delays))
                self.assertEqual(len(api.activities), len(delays))
                self.assertTrue(all(proof["complete"] for proof in api.activities))

    def test_recent_or_unverified_activity_blocks_before_first_part_without_ledger(self):
        for code in worker.ACTIVITY_BLOCK_CODES:
            self.proposal()
            api, mcp = FakeAPI(), self.proposal_mcp([{"allowed": False, "code": code}])
            self.assertEqual(self.run_sequence(api, mcp), code)
            self.assertEqual(api.calls, [("failed", code)])
            self.assertEqual(mcp.calls, 0)
            self.assertIsNone(self.ledger.get(self.job))

    def test_only_closed_denial_codes_are_forwarded_and_never_authorize_messages(self):
        self.proposal()
        invalid = [
            {"allowed": False, "code": "private diagnostic with contact"},
            {"allowed": False, "code": ["historico_incompleto"]},
            {"allowed": False, "code": None},
            {"allowed": 0, "code": "inactivity_recent"},
            {"allowed": 1, "code": "historico_em_sincronizacao"},
            {"allowed": True, "code": "historico_incompleto", "activity": self.activity_proof()},
            {"allowed": True, "code": "inactivity_recent", "activity": self.activity_proof()},
        ]
        for value in invalid:
            with self.subTest(value=value):
                api, mcp = FakeAPI(), self.proposal_mcp([value])
                self.assertEqual(self.run_sequence(api, mcp), "inactivity_unverified")
                self.assertEqual(api.calls, [("failed", "inactivity_unverified")])
                self.assertEqual(api.activities, [])
                self.assertEqual(mcp.calls, 0)
                self.assertIsNone(self.ledger.get(self.job))

    def test_incomplete_proof_is_forwarded_only_as_a_failure_for_both_windows(self):
        for kind in worker.PROPOSAL_TYPES:
            with self.subTest(kind=kind):
                self.proposal(kind)
                proof = {**self.activity_proof(), "complete": False,
                         "coverageStartedAt": (self.now - timedelta(days=1)).isoformat()}
                api, mcp = FakeAPI(), self.proposal_mcp([
                    {"allowed": False, "code": "historico_incompleto", "activity": proof}])
                self.assertEqual(self.run_sequence(api, mcp), "historico_incompleto")
                self.assertEqual(api.calls, [("failed", "historico_incompleto")])
                self.assertEqual(api.activities, [proof])
                self.assertEqual(mcp.calls, 0)
                self.assertIsNone(self.ledger.get(self.job))

    def test_incomplete_evidence_rejects_stale_forged_or_incoherent_metadata(self):
        self.proposal()
        proof = {**self.activity_proof(), "complete": False,
                 "coverageStartedAt": (self.now - timedelta(days=1)).isoformat()}
        malformed = [
            None, {}, {**proof, "private": "discard"},
            {**proof, "complete": True}, {**proof, "complete": 0},
            {**proof, "checkedAt": (self.now - timedelta(seconds=31)).isoformat()},
            {**proof, "checkedAt": (self.now + timedelta(seconds=6)).isoformat()},
            {**proof, "checkedAt": self.now.replace(tzinfo=None).isoformat()},
            {**proof, "coverageStartedAt": "1970-01-01T00:00:00Z"},
            {**proof, "coverageStartedAt": "0001-01-01T00:00:00Z"},
            {**proof, "coverageStartedAt": (self.now + timedelta(seconds=1)).isoformat()},
            {**proof, "coverageStartedAt": (self.now - timedelta(days=5)).isoformat()},
            {**proof, "coverageStartedAt": None},
            {**proof, "lastInteractionAt": (self.now + timedelta(seconds=1)).isoformat()},
            {**proof, "lastInteractionAt": "invalid"},
            {**proof, "lastInteractionAt": "1970-01-01T00:00:00Z"},
        ]
        for evidence in malformed:
            with self.subTest(evidence=evidence):
                api, mcp = FakeAPI(), self.proposal_mcp([
                    {"allowed": False, "code": "historico_incompleto", "activity": evidence}])
                self.assertEqual(self.run_sequence(api, mcp), "historico_incompleto")
                self.assertEqual(api.calls, [("failed", "historico_incompleto")])
                self.assertEqual(api.activities, [], "invalid metadata must not leave the worker")
                self.assertEqual(mcp.calls, 0)
                self.assertIsNone(self.ledger.get(self.job))

    def test_incomplete_metadata_is_not_forwarded_with_other_denial_causes(self):
        self.proposal()
        proof = {**self.activity_proof(), "complete": False,
                 "coverageStartedAt": (self.now - timedelta(days=1)).isoformat()}
        for code in worker.ACTIVITY_BLOCK_CODES - {"historico_incompleto"}:
            api, mcp = FakeAPI(), self.proposal_mcp([{"allowed": False, "code": code, "activity": proof}])
            self.assertEqual(self.run_sequence(api, mcp), code)
            self.assertEqual(api.activities, [])
            self.assertEqual(mcp.calls, 0)

    def test_new_interaction_during_pause_stops_partial_job_without_resume(self):
        self.proposal()
        api = FakeAPI()
        mcp = self.proposal_mcp([
            {"allowed": True, "activity": self.activity_proof()},
            {"allowed": False, "code": "inactivity_recent"}])
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])
        self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
        self.assertEqual(mcp.calls, 1)

    def test_history_failures_after_first_ack_remain_indeterminate_without_resend(self):
        for index, code in enumerate(sorted(worker.ACTIVITY_BLOCK_CODES - {"inactivity_recent", "inactivity_unverified"})):
            with self.subTest(code=code):
                self.proposal("lembrete_proposta_30d")
                self.job["id"] = f"c350bc94-24f1-4359-9e92-eac5f1a76e4{index}"
                api, mcp = FakeAPI(), self.proposal_mcp([
                    {"allowed": True, "activity": self.activity_proof(), "code": "inactivity_clear"},
                    {"allowed": False, "code": code}])
                self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
                self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])
                self.assertEqual(mcp.calls, 1)
                self.assertEqual(self.ledger.get(self.job), "indeterminate")
                self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
                self.assertEqual(mcp.calls, 1)

    def test_activity_transport_failure_fails_closed(self):
        self.proposal()
        mcp = self.proposal_mcp([ConnectionError("fixture offline")])
        api = FakeAPI()
        self.assertEqual(self.run_sequence(api, mcp), "inactivity_unverified")
        self.assertEqual(api.calls, [("failed", "inactivity_unverified")])
        self.assertEqual(mcp.calls, 0)

    def test_activity_evidence_must_be_complete_fresh_and_cover_required_window(self):
        self.proposal("lembrete_proposta_30d")
        invalid = []
        for field, value in (
            ("complete", False),
            ("complete", 1),
            ("checkedAt", (self.now-timedelta(seconds=31)).isoformat()),
            ("checkedAt", (self.now+timedelta(seconds=6)).isoformat()),
            ("coverageStartedAt", (self.now-timedelta(days=14)).isoformat()),
            ("coverageStartedAt", "1970-01-01T00:00:00Z"),
            ("coverageStartedAt", "0001-01-01T00:00:00Z"),
            ("coverageStartedAt", (self.now+timedelta(seconds=1)).isoformat()),
            ("lastInteractionAt", (self.now-timedelta(days=15)+timedelta(seconds=1)).isoformat()),
            ("lastInteractionAt", self.now.isoformat()),
            ("lastInteractionAt", "not-a-timestamp"),
        ):
            proof = self.activity_proof(); proof[field] = value
            invalid.append(proof)
        invalid += [None, {}, {**self.activity_proof(), "unknown": "no"}]
        for proof in invalid:
            api, mcp = FakeAPI(), self.proposal_mcp([{"allowed": True, "activity": proof}])
            self.assertEqual(self.run_sequence(api, mcp), "inactivity_unverified")
            self.assertEqual(mcp.calls, 0)

    def test_proposal_payload_rejects_missing_link_copy_and_delay_changes(self):
        self.proposal()
        valid = deepcopy(self.job)
        for field, value in (("message", "texto não aprovado"), ("delayBeforeSeconds", 3)):
            self.job = deepcopy(valid)
            self.job["messagesSequence"][0][field] = value
            mcp = self.proposal_mcp()
            self.assertEqual(self.run_sequence(FakeAPI(), mcp), "invalid_job")
            self.assertEqual(mcp.calls, 0)
        for url in ("", "[link da proposta]", "http://proposal.invalid/file.pdf", "https://user:secret@proposal.invalid/file.pdf", "https://proposal.invalid/a\nb"):
            self.job = deepcopy(valid)
            self.job["messagesSequence"][2]["message"] = url
            mcp = self.proposal_mcp()
            self.assertEqual(self.run_sequence(FakeAPI(), mcp), "invalid_job")
            self.assertEqual(mcp.calls, 0)

    def test_mcp_receives_exact_current_job_marker_only_for_proposals(self):
        self.proposal()
        session = SimpleNamespace(call_tool=AsyncMock(return_value=SimpleNamespace(
            isError=False, content=[SimpleNamespace(text='{"success":true}')])) )
        local = worker.LocalMCP(session)
        self.assertTrue(asyncio.run(local.send(self.job)))
        session.call_tool.assert_awaited_once_with("send_message", {
            "recipient": self.job["recipient"], "message": self.job["message"], "automation_job_id": self.job["id"]})

    def owner_test(self, lead="01b985e2-6bff-4e9c-bb5e-2f1cc280edf7"):
        self.proposal(worker.OWNER_TEST_LEADS[lead])
        self.now = datetime(2026, 10, 15, 15, tzinfo=timezone.utc)
        self.job["expiresAt"] = (self.now + timedelta(hours=1)).isoformat()
        self.job["recipient"] = worker.OWNER_TEST_RECIPIENT
        self.job["testLeadId"] = lead

    def owner_test_proof(self):
        return {"allowed": True, "code": "owner_test_authorized", "testLeadId": self.job["testLeadId"],
                "jobId": self.job["id"], "recipient": self.job["recipient"], "checkedAt": self.now.isoformat()}

    def owner_test_mcp(self):
        mcp = FakeMCP()
        mcp.activity_calls = []
        async def check(job):
            mcp.activity_calls.append(deepcopy(job))
            return self.owner_test_proof()
        mcp.activity = check
        return mcp

    def test_five_owner_cards_require_explicit_proof_and_keep_exact_sequences_and_deduplication(self):
        for index, lead in enumerate(worker.OWNER_TEST_LEADS):
            with self.subTest(lead=lead):
                self.owner_test(lead)
                self.job["id"] = "c350bc94-24f1-4359-9e92-eac5f1a76e4" + str(index)
                api, mcp = FakeAPI(), self.owner_test_mcp()
                self.assertEqual(self.run_sequence(api, mcp), "sent")
                self.assertEqual([job["message"] for job in mcp.jobs], self.texts)
                self.assertTrue(all(job["testLeadId"] == lead for job in mcp.jobs))
                self.assertEqual(len(mcp.activity_calls), len(self.texts))
                self.assertEqual(api.activities, [], "Teste não deve inventar prova de inatividade")
                self.assertEqual(self.sleeps, list(worker.PROPOSAL_DELAYS[self.job["tipo"]][1:]))
                self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
                self.assertEqual(mcp.calls, len(self.texts))

    def test_owner_test_rejects_other_leads_phones_types_and_null_marker_before_any_call(self):
        self.owner_test()
        valid = deepcopy(self.job)
        for field, value in (("testLeadId", "c350bc94-24f1-4359-9e92-eac5f1a76e44"),
                             ("testLeadId", None), ("testLeadId", []),
                             ("recipient", "5511999999999"),
                             ("tipo", "lembrete_proposta_30d"), ("tipo", "lembrete_formulario_24h")):
            with self.subTest(field=field, value=value):
                self.job = {**deepcopy(valid), field: value}
                api, mcp = FakeAPI(), self.owner_test_mcp()
                self.assertEqual(self.run_sequence(api, mcp), "invalid_job")
                self.assertEqual(api.calls, [])
                self.assertEqual(mcp.activity_calls, [])
                self.assertEqual(mcp.calls, 0)

    def test_owner_proof_requires_job_lead_phone_freshness_and_never_accepts_normal_activity(self):
        self.owner_test()
        proof = self.owner_test_proof()
        bad = [
            {**proof, "allowed": False}, {**proof, "allowed": 1},
            {**proof, "jobId": "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369"},
            {**proof, "recipient": "5511999999999"},
            {**proof, "testLeadId": "d459193f-9e7c-4b2c-995d-7f829a0936bd"},
            {**proof, "code": "inactivity_clear"},
            {**proof, "checkedAt": (self.now-timedelta(seconds=31)).isoformat()},
            {**proof, "checkedAt": (self.now+timedelta(seconds=6)).isoformat()},
            {**proof, "checkedAt": "2026-10-15T15:00:00"},
            {**proof, "checkedAt": None},
            {**proof, "activity": self.activity_proof()},
            {"allowed": True, "activity": self.activity_proof()},
        ]
        for value in bad:
            api, mcp = FakeAPI(), self.proposal_mcp([value])
            self.assertEqual(self.run_sequence(api, mcp), "inactivity_unverified")
            self.assertEqual(api.calls, [("failed", "inactivity_unverified")])
            self.assertEqual(mcp.calls, 0)
            self.assertIsNone(self.ledger.get(self.job))

    def test_owner_test_proof_cannot_replace_real_customer_history(self):
        self.owner_test()
        test_proof = self.owner_test_proof()
        del self.job["testLeadId"]
        api, mcp = FakeAPI(), self.proposal_mcp([test_proof])
        self.assertEqual(self.run_sequence(api, mcp), "inactivity_unverified")
        self.assertEqual(mcp.calls, 0)

    def test_owner_test_expiry_blocks_first_and_each_subsequent_part(self):
        self.owner_test()
        self.now = worker.OWNER_TEST_DEADLINE
        self.job["expiresAt"] = (self.now+timedelta(hours=1)).isoformat()
        api, mcp = FakeAPI(), self.owner_test_mcp()
        self.assertEqual(self.run_sequence(api, mcp), "expired")
        self.assertEqual(api.calls, [])
        self.assertEqual(mcp.calls, 0)
        self.now -= timedelta(seconds=1)
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])
        self.assertEqual(len(mcp.activity_calls), 1)

    def test_owner_expiry_during_cloud_authorization_never_reaches_mcp(self):
        self.owner_test()
        self.now = worker.OWNER_TEST_DEADLINE - timedelta(seconds=1)
        self.job["expiresAt"] = (self.now+timedelta(hours=1)).isoformat()
        test = self
        class SlowAPI(FakeAPI):
            async def result(self, job, outcome, code=None, activity=None):
                result = await super().result(job, outcome, code, activity)
                if outcome == "started":
                    test.now = worker.OWNER_TEST_DEADLINE
                return result
        api, mcp = SlowAPI(), self.owner_test_mcp()
        self.assertEqual(self.run_sequence(api, mcp), "expired_after_start")
        self.assertEqual(mcp.calls, 0)
        self.assertEqual(self.ledger.get(self.job), "indeterminate")

    def test_owner_test_disconnected_bridge_or_revoked_proof_stops_without_retry(self):
        self.owner_test()
        api, mcp = FakeAPI(), self.owner_test_mcp()
        mcp.connected = False
        self.assertEqual(self.run_sequence(api, mcp), "not_connected")
        self.assertEqual(mcp.activity_calls, [])
        self.assertEqual(mcp.calls, 0)
        api, mcp = FakeAPI(), self.proposal_mcp([
            self.owner_test_proof(), {"allowed": False, "code": "inactivity_unverified"}])
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
        self.assertEqual(mcp.calls, 1)

    def test_owner_test_marker_changes_ledger_digest_without_altering_legacy_digest(self):
        self.owner_test()
        digest = Ledger.digest(self.job)
        ordinary = deepcopy(self.job)
        del ordinary["testLeadId"]
        self.assertNotEqual(digest, Ledger.digest(ordinary))
        self.ledger.set(self.job, "sent")
        self.assertEqual(self.ledger.get(ordinary), "indeterminate")

    def test_owner_test_marker_reaches_mcp_and_activity_http_without_public_network(self):
        self.owner_test()
        session = SimpleNamespace(call_tool=AsyncMock(return_value=SimpleNamespace(
            isError=False, content=[SimpleNamespace(text='{"success":true}')])) )
        local = worker.LocalMCP(session)
        self.assertTrue(asyncio.run(local.send(self.job)))
        session.call_tool.assert_awaited_once_with("send_message", {
            "recipient": self.job["recipient"], "message": self.job["message"],
            "automation_job_id": self.job["id"], "automation_test_lead_id": self.job["testLeadId"]})
        state = Path(self.tmp.name)
        (state / "bridge-token").write_text("token-ficticio-da-ponte-para-teste")
        calls = []
        proof = self.owner_test_proof()
        class Session:
            def post(self, url, **options):
                calls.append((url, options))
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: proof)
            def close(self):
                pass
        with patch.object(worker, "STATE", state), patch.object(worker.requests, "Session", return_value=Session()):
            self.assertEqual(asyncio.run(local.activity(self.job)), proof)
        self.assertEqual(calls[0][0], "http://127.0.0.1:18281/api/activity-check")
        self.assertEqual(calls[0][1]["json"], {"recipient": self.job["recipient"], "jobId": self.job["id"],
            "days": 5, "testLeadId": self.job["testLeadId"]})
        self.assertFalse(calls[0][1]["allow_redirects"])

    def test_network_claim_rejects_old_protocol_or_unknown_job_kind(self):
        api = worker.API("token-ficticio-com-mais-de-trinta-e-dois-caracteres")
        self.addCleanup(api.session.close)
        for response in ({"protocolVersion": 2, "job": None},
                         {"protocolVersion": 3, "job": self.job},
                         {"protocolVersion": 4, "job": {**self.job, "tipo": worker.FORM_REMINDER_TYPE}},
                         {"protocolVersion": 5, "job": {**self.job, "tipo": "confirmacao_recebimento"}}):
            with patch.object(api, "post", new=AsyncMock(return_value=response)):
                with self.assertRaises(ValueError):
                    asyncio.run(api.claim())


class FormReminderQuietHoursTests(unittest.TestCase):
    setUp = WorkerTests.setUp
    tearDown = WorkerTests.tearDown
    fake_sleep = WorkerTests.fake_sleep
    run_sequence = WorkerTests.run_sequence
    activity_proof = WorkerTests.activity_proof

    def form_job(self, local="2026-10-16T14:30:00-03:00"):
        self.now = datetime.fromisoformat(local).astimezone(timezone.utc)
        self.sleeps = []
        self.texts = [
            "Olá! Aqui é a Mel Storymaker 👋",
            "Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊",
            "Suas respostas estão salvas, acesse o link:",
            "https://crm.invalid/continuar/" + self.job["id"],
        ]
        self.job.update({
            "tipo": worker.FORM_REMINDER_TYPE,
            "expiresAt": (self.now + timedelta(hours=1)).isoformat(),
            "message": "\n\n".join(self.texts),
            "messagesSequence": [
                {"message": text, "delayBeforeSeconds": delay}
                for text, delay in zip(self.texts, (0, 2, 3, 2))
            ],
        })

    def test_quiet_hours_boundaries_use_brasilia_even_with_utc_clock(self):
        self.form_job()
        for local, blocked in (
            ("2026-10-16T20:59:59-03:00", False),
            ("2026-10-16T21:00:00-03:00", True),
            ("2026-10-16T23:59:59-03:00", True),
            ("2026-10-17T00:00:00-03:00", True),
            ("2026-10-17T07:59:59-03:00", True),
            ("2026-10-17T08:00:00-03:00", False),
        ):
            with self.subTest(local=local):
                utc = datetime.fromisoformat(local).astimezone(timezone.utc)
                self.assertEqual(worker.formulario_quiet_hours(self.job, utc), blocked)
        with self.assertRaisesRegex(ValueError, "invalid_worker_clock"):
            worker.formulario_quiet_hours(self.job, datetime(2026, 10, 16, 14))

    def test_quiet_jobs_defer_without_starting_ledger_or_calling_whatsapp(self):
        for local in ("2026-10-16T21:00:00-03:00", "2026-10-17T07:59:59-03:00"):
            with self.subTest(local=local):
                self.form_job(local)
                api, mcp = FakeAPI(), FakeMCP()
                mcp.ready = AsyncMock(side_effect=AssertionError("não reserva início em horário bloqueado"))
                self.assertEqual(self.run_sequence(api, mcp), "quiet_hours")
                self.assertEqual(api.calls, [("failed", "formulario_nao_perturbe")])
                self.assertEqual(mcp.calls, 0)
                self.assertIsNone(self.ledger.get(self.job))
                self.assertEqual(self.ledger.pending(), [])
                mcp.ready.assert_not_called()

    def test_normal_hours_keep_approved_four_parts_delays_and_server_rechecks(self):
        self.form_job("2026-10-16T08:00:00-03:00")
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "sent")
        self.assertEqual([job["message"] for job in mcp.jobs], self.texts)
        self.assertEqual(self.sleeps, [2, 3, 2])
        self.assertEqual(api.calls, [("started", None)] * 4 + [("sent", None)])
        self.assertEqual(self.ledger.get(self.job), "sent")

    def test_20h59_all_parts_complete_before_quiet_boundary(self):
        self.form_job("2026-10-16T20:59:50-03:00")
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "sent")
        self.assertEqual(mcp.calls, 4)
        self.assertEqual(self.now.astimezone(worker.FORM_REMINDER_TIMEZONE).isoformat(),
                         "2026-10-16T20:59:57-03:00")

    def test_bridge_preflight_crossing_21h_defers_before_cloud_start(self):
        self.form_job("2026-10-16T20:59:59-03:00")
        async def slow_preflight():
            self.now += timedelta(seconds=1)
            return True
        api, mcp = FakeAPI(), FakeMCP()
        mcp.ready = slow_preflight
        self.assertEqual(self.run_sequence(api, mcp), "quiet_hours")
        self.assertEqual(api.calls, [("failed", "formulario_nao_perturbe")])
        self.assertEqual(mcp.calls, 0)
        self.assertIsNone(self.ledger.get(self.job))

    def test_first_cloud_authorization_crossing_21h_never_reaches_mcp(self):
        self.form_job("2026-10-16T20:59:59-03:00")
        test = self
        class SlowAPI(FakeAPI):
            async def result(self, job, outcome, code=None, activity=None):
                result = await super().result(job, outcome, code, activity)
                if outcome == "started":
                    test.now += timedelta(seconds=1)
                return result
        api, mcp = SlowAPI(), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])
        self.assertEqual(mcp.calls, 0)
        self.assertEqual(self.ledger.get(self.job), "indeterminate")

    def test_pause_crossing_21h_stops_partial_sequence_and_never_resumes(self):
        self.form_job("2026-10-16T20:59:59-03:00")
        api, mcp = FakeAPI(), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(self.sleeps, [2])
        self.assertEqual(api.calls, [("started", None), ("indeterminate", None)])
        self.assertEqual(self.ledger.get(self.job), "indeterminate")
        self.now += timedelta(hours=12)
        self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
        self.assertEqual(mcp.calls, 1)

    def test_subsequent_cloud_authorization_rechecks_clock_immediately_before_mcp(self):
        self.form_job("2026-10-16T20:59:56-03:00")
        test = self
        class SlowSecondAPI(FakeAPI):
            async def result(self, job, outcome, code=None, activity=None):
                result = await super().result(job, outcome, code, activity)
                if outcome == "started" and sum(call[0] == "started" for call in self.calls) == 2:
                    test.now += timedelta(seconds=2)
                return result
        api, mcp = SlowSecondAPI(), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(api.calls, [("started", None)] * 2 + [("indeterminate", None)])

    def test_form_server_rejection_after_new_activity_never_sends_later_parts(self):
        self.form_job()
        api, mcp = FakeAPI(starts=[True, False]), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(api.calls, [("started", None)] * 2 + [("indeterminate", None)])
        self.assertEqual(self.run_sequence(FakeAPI(), mcp), "reconciled")
        self.assertEqual(mcp.calls, 1)

    def test_form_due_time_flag_column_or_phone_rejection_never_starts_local_send(self):
        self.form_job()
        api, mcp = FakeAPI(accepted=False), FakeMCP()
        self.assertEqual(self.run_sequence(api, mcp), "rejected")
        self.assertEqual(api.calls, [("started", None)])
        self.assertEqual(mcp.calls, 0)
        self.assertIsNone(self.ledger.get(self.job))

    def test_existing_acks_reconcile_during_quiet_without_whatsapp(self):
        for index, state in enumerate(("sent", "started")):
            with self.subTest(state=state):
                self.form_job("2026-10-16T23:00:00-03:00")
                self.job["id"] = "c350bc94-24f1-4359-9e92-eac5f1a76e4" + str(index)
                self.ledger.set(self.job, state)
                api, mcp = FakeAPI(), FakeMCP()
                self.assertEqual(self.run_sequence(api, mcp), "reconciled")
                self.assertEqual(api.calls, [("sent" if state == "sent" else "indeterminate", None)])
                self.assertEqual(mcp.calls, 0)
                self.assertEqual(self.ledger.pending(), [])

    def test_quiet_guard_does_not_apply_to_manual_7_or_30_day_reminders(self):
        for index, kind in enumerate(worker.PROPOSAL_TYPES):
            with self.subTest(kind=kind):
                WorkerTests.proposal(self, kind)
                self.now = datetime(2026, 10, 17, 2, tzinfo=timezone.utc)  # 23h de Brasília.
                self.job["expiresAt"] = (self.now + timedelta(hours=1)).isoformat()
                self.job["id"] = "c350bc94-24f1-4359-9e92-eac5f1a76e4" + str(index)
                api, mcp = FakeAPI(), WorkerTests.proposal_mcp(self)
                self.assertEqual(self.run_sequence(api, mcp), "sent")
                self.assertEqual(mcp.calls, len(worker.PROPOSAL_DELAYS[kind]))
                self.assertEqual(len(mcp.activity_calls), len(worker.PROPOSAL_DELAYS[kind]))


class InitialProposalTests(unittest.TestCase):
    setUp = WorkerTests.setUp
    tearDown = WorkerTests.tearDown

    def initial_job(self):
        parts = [
            {"message": "Oi, Maria Eduarda tudo bem? Aqui é a Mel Storymaker ✨", "delayBeforeSeconds": 0},
            {"message": "Você solicitou um orçamento através do meu site.", "delayBeforeSeconds": 3},
            {"message": "Segue a sua proposta:\n🤍 https://melstorymaker.com.br/p/a3f9", "delayBeforeSeconds": 2},
            {"message": "Qualquer dúvida, é só me chamar. Ok?\nFico à disposição para te ajudar no que precisar!", "delayBeforeSeconds": 4},
        ]
        return {**self.job, "tipo": "proposta_inicial_15m", "messagesSequence": parts,
                "message": "\n\n".join(part["message"] for part in parts)}

    def test_initial_sequence_exact_pauses_ack_and_no_inactivity_gate(self):
        job = self.initial_job()
        api, mcp = FakeAPI(), FakeMCP()
        mcp.activity = AsyncMock(side_effect=AssertionError("primeiro envio não exige 5/15 dias"))
        pauses = []
        async def sleep(seconds):
            pauses.append(seconds)
        self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job, sleep=sleep)), "sent")
        self.assertEqual(pauses, [3, 2, 4])
        self.assertEqual([j["message"] for j in mcp.jobs], [p["message"] for p in job["messagesSequence"]])
        self.assertEqual(api.calls, [("started", None)] * 4 + [("sent", None)])
        mcp.activity.assert_not_called()
        self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job)), "reconciled")
        self.assertEqual(mcp.calls, 4, "ACK repetido não envia novamente")

    def test_initial_partial_stops_and_never_resends(self):
        job = self.initial_job()
        api, mcp = FakeAPI(starts=[True, False]), FakeMCP()
        async def sleep(_seconds):
            pass
        self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job, sleep=sleep)), "indeterminate")
        self.assertEqual(mcp.calls, 1)
        self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job)), "reconciled")
        self.assertEqual(mcp.calls, 1)

    def test_initial_proposal_is_not_restricted_by_form_reminder_quiet_hours(self):
        job = self.initial_job()
        now = datetime(2026, 10, 17, 2, tzinfo=timezone.utc)  # 23h de Brasília.
        job["expiresAt"] = (now + timedelta(hours=1)).isoformat()
        api, mcp = FakeAPI(), FakeMCP()
        async def sleep(_seconds):
            pass
        self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job, sleep=sleep, clock=lambda: now)), "sent")
        self.assertEqual(mcp.calls, 4)

    def test_initial_copy_tampering_blocks_before_whatsapp(self):
        for index in range(4):
            job = self.initial_job()
            job["messagesSequence"][index]["delayBeforeSeconds"] += 1
            api, mcp = FakeAPI(), FakeMCP()
            self.assertEqual(asyncio.run(process(api, mcp, self.ledger, job)), "invalid_job")
            self.assertEqual(mcp.calls, 0)


if __name__ == "__main__":
    unittest.main()
