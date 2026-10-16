"""Consome a fila da Mel por HTTPS e envia pelo MCP local, sem porta pública."""

import argparse
import asyncio
import base64
import hashlib
import fcntl
import json
import logging
import os
import re
import unicodedata
from pathlib import Path
import sqlite3
from datetime import datetime, timezone, timedelta
from uuid import UUID
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".whatsapp-local/state"
ORIGIN = "https://melstorymaker.com.br"
LOG = logging.getLogger("mel-whatsapp-worker")


def unexpired(job: dict, now: datetime | None = None) -> bool:
    expires = datetime.fromisoformat(job["expiresAt"].replace("Z", "+00:00"))
    current = now or datetime.now(timezone.utc)
    return (expires.tzinfo is not None and expires > current
            and ("testLeadId" not in job or current < OWNER_TEST_DEADLINE)
            and ("legacyAuthorization" not in job or legacy_authorization(job, current) is not None))


LEGACY_JOB_FIELDS = ("id", "leaseToken", "recipient", "message", "expiresAt")
SEQUENCE_DELAYS = (0, 2, 3, 2)
PROPOSAL_TYPES = {"lembrete_proposta_7d": 5, "lembrete_proposta_30d": 15}
ACTIVITY_BLOCK_CODES = {
    "historico_em_sincronizacao", "historico_incompleto", "historico_indisponivel",
    "identidade_nao_confirmada", "inactivity_recent", "inactivity_unverified",
}
INITIAL_PROPOSAL_TYPE = "proposta_inicial_15m"
FORM_REMINDER_TYPE = "lembrete_formulario_24h"
FORM_REMINDER_TIMEZONE = ZoneInfo("America/Sao_Paulo")
JOB_TYPES = {FORM_REMINDER_TYPE, INITIAL_PROPOSAL_TYPE, *PROPOSAL_TYPES}
PROPOSAL_TEXTS = {
    "lembrete_proposta_7d": (
        "Olá, como vai?!",
        "Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei.",
        None,
        "Se ficou alguma dúvida, me chama que eu te explico. ✨",
    ),
    "lembrete_proposta_30d": (
        "Oi! Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei. 🤍",
        None,
        "Se ainda fizer sentido, é só me chamar que a gente conversa.",
        "Se não for o momento, me avise por gentileza, para que eu possa me organizar por aqui 🙏",
        "Desde já, agradeço ✨",
    ),
}
PROPOSAL_DELAYS = {"lembrete_proposta_7d": (0, 2, 3, 2), "lembrete_proposta_30d": (0, 4, 4, 3, 5)}
INITIAL_PROPOSAL_DELAYS = (0, 3, 2, 4)
OWNER_TEST_RECIPIENT = "5519988763916"
OWNER_TEST_DEADLINE = datetime(2026, 10, 17, 18, tzinfo=timezone.utc)
OWNER_TEST_LEADS = {
    "01b985e2-6bff-4e9c-bb5e-2f1cc280edf7": "lembrete_proposta_7d",
    "d459193f-9e7c-4b2c-995d-7f829a0936bd": "lembrete_proposta_7d",
    "13e49741-9d35-404c-ae54-42fe93e55c66": "lembrete_proposta_7d",
    "abf88ff2-ea34-4e32-994d-f7dc75df599b": "lembrete_proposta_30d",
    "9263d823-d059-4e0a-b759-9184035dec89": "lembrete_proposta_30d",
}


def legacy_authorization(job: dict, now: datetime | None = None) -> dict | None:
    """Validate scope locally; only the bridge can verify the ticket's MAC."""
    if (job.get("tipo") != "lembrete_proposta_7d" or "testLeadId" in job
            or not isinstance(job.get("legacyBatchId"), str)
            or not isinstance(job.get("legacyAuthorization"), str)):
        return None
    ticket = job["legacyAuthorization"]
    if not 1 <= len(ticket) <= 8192 or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", ticket):
        return None
    def unique_keys(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate_ticket_key")
            value[key] = item
        return value
    def decode(segment):
        decoded = base64.b64decode(segment + "=" * (-len(segment) % 4), altchars=b"-_", validate=True)
        if base64.urlsafe_b64encode(decoded).decode().rstrip("=") != segment:
            raise ValueError("noncanonical_ticket_encoding")
        return decoded
    try:
        payload_part, mac_part = ticket.split(".")
        if len(decode(mac_part)) != 32:
            return None
        payload = json.loads(decode(payload_part), object_pairs_hook=unique_keys)
        if (not isinstance(payload, dict)
                or set(payload) != {"batchId", "jobId", "leadId", "recipient", "tipo", "expiresAt", "messages"}):
            return None
        for key in ("batchId", "jobId", "leadId"):
            if not isinstance(payload[key], str) or str(UUID(payload[key])) != payload[key].lower():
                return None
        if (payload["batchId"] != job["legacyBatchId"] or payload["jobId"] != job["id"]
                or payload["recipient"] != job["recipient"] or payload["tipo"] != job["tipo"]
                or not isinstance(payload["messages"], list)
                or payload["messages"] != [part["message"] for part in job["messagesSequence"]]
                or not isinstance(payload["expiresAt"], str)):
            return None
        expires = datetime.fromisoformat(payload["expiresAt"].replace("Z", "+00:00"))
        if expires.tzinfo is None or expires.utcoffset() is None:
            return None
        if now is not None and (expires <= now or expires > now + timedelta(minutes=5)):
            return None
        return payload
    except (AttributeError, ValueError, TypeError, KeyError, UnicodeError, OverflowError):
        return None


def formulario_quiet_hours(job: dict, now: datetime | None = None) -> bool:
    """O não perturbe do formulário usa Brasília, independente do fuso do host."""
    if job.get("tipo") != FORM_REMINDER_TYPE:
        return False
    current = now if now is not None else datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("invalid_worker_clock")
    local = current.astimezone(FORM_REMINDER_TIMEZONE)
    return local.hour >= 21 or local.hour < 8


def valid_owner_test(job: dict) -> bool:
    lead = job.get("testLeadId")
    return (isinstance(lead, str) and lead in OWNER_TEST_LEADS
            and job.get("tipo") == OWNER_TEST_LEADS[lead]
            and job.get("recipient") == OWNER_TEST_RECIPIENT)


def message_parts(job: dict) -> list[dict]:
    """Valida o contrato inteiro antes de autorizar qualquer chamada de envio."""
    if not isinstance(job, dict) or not set(LEGACY_JOB_FIELDS).issubset(job) or set(job) - {
        *LEGACY_JOB_FIELDS, "messagesSequence", "tipo", "testLeadId", "legacyBatchId", "legacyAuthorization"
    }:
        raise ValueError("invalid_job")
    for field in ("id", "leaseToken"):
        if not isinstance(job[field], str):
            raise ValueError("invalid_job")
        UUID(job[field])
    recipient = job["recipient"]
    if not isinstance(recipient, str) or not recipient.isascii() or not recipient.isdigit() or not (
        recipient.startswith("55") and len(recipient) in (12, 13)
    ):
        raise ValueError("invalid_job")
    if not isinstance(job["expiresAt"], str):
        raise ValueError("invalid_job")
    expires = datetime.fromisoformat(job["expiresAt"].replace("Z", "+00:00"))
    if expires.tzinfo is None:
        raise ValueError("invalid_job")

    def valid_text(value) -> bool:
        if not isinstance(value, str) or not value.strip() or len(value) > 4000:
            return False
        try:
            value.encode("utf-8")
            return True
        except UnicodeError:
            return False

    if not valid_text(job["message"]):
        raise ValueError("invalid_job")
    kind = job.get("tipo")
    if kind is not None and kind not in JOB_TYPES:
        raise ValueError("invalid_job")
    if ("legacyBatchId" in job or "legacyAuthorization" in job) and (
            "legacyBatchId" not in job or "legacyAuthorization" not in job
            or kind != "lembrete_proposta_7d" or "testLeadId" in job):
        raise ValueError("invalid_legacy_authorization")
    if "testLeadId" in job and not valid_owner_test(job):
        raise ValueError("invalid_job")
    if "messagesSequence" not in job:
        if kind is not None:
            raise ValueError("invalid_sequence")
        return [{"message": job["message"], "delayBeforeSeconds": 0}]
    sequence = job["messagesSequence"]
    delays = INITIAL_PROPOSAL_DELAYS if kind == INITIAL_PROPOSAL_TYPE else PROPOSAL_DELAYS.get(kind, SEQUENCE_DELAYS)
    if not isinstance(sequence, list) or len(sequence) != len(delays):
        raise ValueError("invalid_sequence")
    for index, (part, delay) in enumerate(zip(sequence, delays)):
        if not isinstance(part, dict) or set(part) != {"message", "delayBeforeSeconds"} or not valid_text(part["message"]):
            raise ValueError("invalid_sequence")
        if type(part["delayBeforeSeconds"]) is not int or part["delayBeforeSeconds"] != delay:
            raise ValueError("invalid_sequence")
        if kind in PROPOSAL_TEXTS:
            expected = PROPOSAL_TEXTS[kind][index]
            if expected is not None:
                if part["message"] != expected:
                    raise ValueError("invalid_sequence")
            else:
                url = urlsplit(part["message"])
                if (url.scheme != "https" or not url.hostname or url.username or url.password
                        or part["message"].strip() != part["message"] or any(c.isspace() for c in part["message"])):
                    raise ValueError("invalid_sequence")
    if kind == INITIAL_PROPOSAL_TYPE:
        greeting = re.fullmatch(r"Oi, (.+) tudo bem\? Aqui é a Mel Storymaker ✨", sequence[0]["message"])
        link = re.fullmatch(r"Segue a sua proposta:\n🤍 (https://[^\s/?#\\@]+/p/[a-z0-9]{4})", sequence[2]["message"])
        if not greeting or not link:
            raise ValueError("invalid_initial_proposal")
        name = greeting[1]
        words = re.split(r"[ '\u2019.-]", name)
        if (not 1 <= len(name) <= 120 or not all(words)
                or any(unicodedata.category(c)[0] not in ("L", "M") for word in words for c in word)
                or sequence[1]["message"] != "Você solicitou um orçamento através do meu site."
                or sequence[3]["message"] != "Qualquer dúvida, é só me chamar. Ok?\nFico à disposição para te ajudar no que precisar!"
                or "\n\n".join(part["message"] for part in sequence) != job["message"]):
            raise ValueError("invalid_initial_proposal")
    if ("legacyBatchId" in job or "legacyAuthorization" in job) and legacy_authorization(job) is None:
        raise ValueError("invalid_legacy_authorization")
    return sequence


class Ledger:
    """Guarda somente IDs/hash/estado; não guarda telefone, texto ou conversas."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS pending_acks (id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('sent','indeterminate')))")
        self.db.commit()

    @staticmethod
    def digest(job: dict) -> str:
        value = [job["recipient"], job["message"]]
        if "messagesSequence" in job:
            value.extend(["messages_sequence_v2", [
                [part["message"], part["delayBeforeSeconds"]] for part in job["messagesSequence"]
            ]])
        if "tipo" in job:
            value.extend(["job_type_v3", job["tipo"]])
        if "testLeadId" in job:
            value.extend(["owner_test_lead_v1", job["testLeadId"]])
        if "legacyBatchId" in job:
            # A renewed short-lived ticket must not change a durable receipt.
            value.extend(["legacy_batch_v1", job["legacyBatchId"]])
        return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()

    def get(self, job: dict) -> str | None:
        row = self.db.execute("SELECT digest,state FROM jobs WHERE id=?", (job["id"],)).fetchone()
        if not row:
            return None
        if row[0] != self.digest(job):
            return "indeterminate"
        return row[1]

    def set(self, job: dict, state: str) -> None:
        outcome = "sent" if state == "sent" else "indeterminate"
        # Estado e recibo são um só commit: crash nunca perde o ACK pendente.
        with self.db:
            self.db.execute("INSERT INTO jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state", (job["id"], self.digest(job), state))
            self.db.execute("INSERT INTO pending_acks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET lease_token=excluded.lease_token,outcome=excluded.outcome", (job["id"], job["leaseToken"], outcome))

    def pending(self) -> list[dict]:
        return [
            {"id": row[0], "leaseToken": row[1], "outcome": row[2]}
            for row in self.db.execute("SELECT id,lease_token,outcome FROM pending_acks ORDER BY id")
        ]

    def acknowledged(self, ack: dict) -> None:
        with self.db:
            self.db.execute("DELETE FROM pending_acks WHERE id=? AND lease_token=? AND outcome=?", (ack["id"], ack["leaseToken"], ack["outcome"]))

    def close(self) -> None:
        self.db.close()


class API:
    def __init__(self, token: str):
        if len(token) < 32:
            raise ValueError("Token do worker inválido")
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers["Authorization"] = "Bearer " + token
        self.session.headers["X-Mel-Worker-Protocol"] = "6"
        self.poll_after_seconds = 60

    async def post(self, path: str, body: dict) -> dict:
        def request():
            timeout = 55 if path.endswith("/reivindicar") else 20
            response = self.session.post(ORIGIN + path, json=body, timeout=(5, timeout), allow_redirects=False)
            response.raise_for_status()
            return response.json()
        return await asyncio.to_thread(request)

    async def claim(self) -> dict:
        self.poll_after_seconds = 60
        response = await self.post("/api/integracoes/whatsapp/reivindicar", {})
        if response.get("protocolVersion") != 6:
            raise ValueError("invalid_worker_protocol")
        interval = response.get("pollAfterSeconds")
        self.poll_after_seconds = interval if type(interval) is int and interval in (10, 60) else 60
        job = response.get("job")
        if job is not None and (not isinstance(job, dict) or job.get("tipo") not in JOB_TYPES):
            raise ValueError("invalid_job")
        return response

    async def result(self, job: dict, outcome: str, code: str | None = None, activity: dict | None = None) -> dict:
        body = {"leaseToken": job["leaseToken"], "outcome": outcome}
        if code:
            body["code"] = code
        if activity is not None:
            body["activity"] = activity
        return await self.post("/api/integracoes/whatsapp/" + job["id"] + "/resultado", body)


class LocalMCP:
    def __init__(self, session: ClientSession):
        self.session = session

    async def ready(self) -> bool:
        def check():
            direct = requests.Session()
            direct.trust_env = False
            token = (STATE / "bridge-token").read_text().strip()
            try:
                response = direct.get("http://127.0.0.1:18281/api/status", headers={"Authorization": "Bearer " + token}, timeout=(3, 3), allow_redirects=False)
                response.raise_for_status()
                value = response.json()
                return value.get("connected") is True and value.get("simulation") is False
            finally:
                direct.close()
        return await asyncio.to_thread(check)

    async def send(self, job: dict) -> bool:
        arguments = {"recipient": job["recipient"], "message": job["message"]}
        if job.get("tipo") in PROPOSAL_TYPES:
            arguments["automation_job_id"] = job["id"]
        if "testLeadId" in job:
            if not valid_owner_test(job):
                raise ValueError("invalid_job")
            arguments["automation_test_lead_id"] = job["testLeadId"]
        if "legacyAuthorization" in job:
            arguments["automation_legacy_authorization"] = job["legacyAuthorization"]
        result = await asyncio.wait_for(self.session.call_tool("send_message", arguments), timeout=35)
        if result.isError or not result.content:
            return False
        value = json.loads(result.content[0].text)
        return value.get("success") is True

    async def activity(self, job: dict) -> dict:
        def check():
            direct = requests.Session()
            direct.trust_env = False
            token = (STATE / "bridge-token").read_text().strip()
            try:
                body = {"recipient": job["recipient"], "jobId": job["id"], "days": PROPOSAL_TYPES[job["tipo"]]}
                if "testLeadId" in job:
                    if not valid_owner_test(job):
                        raise ValueError("invalid_job")
                    body["testLeadId"] = job["testLeadId"]
                if "legacyAuthorization" in job:
                    body["legacyAuthorization"] = job["legacyAuthorization"]
                response = direct.post("http://127.0.0.1:18281/api/activity-check",
                    headers={"Authorization": "Bearer " + token},
                    json=body,
                    timeout=(3, 5), allow_redirects=False)
                response.raise_for_status()
                return response.json()
            finally:
                direct.close()
        return await asyncio.to_thread(check)


def activity_timestamps(proof: object, now: datetime) -> tuple[datetime, datetime, datetime | None] | None:
    """Only dated, coherent bridge metadata can be passed to the private API."""
    if (not isinstance(proof, dict)
            or set(proof) != {"checkedAt", "coverageStartedAt", "lastInteractionAt", "complete"}
            or type(proof.get("complete")) is not bool):
        return None
    try:
        checked = datetime.fromisoformat(proof["checkedAt"].replace("Z", "+00:00"))
        coverage = datetime.fromisoformat(proof["coverageStartedAt"].replace("Z", "+00:00"))
        last = None if proof["lastInteractionAt"] is None else datetime.fromisoformat(proof["lastInteractionAt"].replace("Z", "+00:00"))
        timestamps = (checked, coverage, *([] if last is None else [last]))
        if any(timestamp.tzinfo is None for timestamp in timestamps):
            return None
        age = (now - checked).total_seconds()
        epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
        if (age < -5 or age > 30 or any(timestamp <= epoch for timestamp in timestamps)
                or coverage > checked or (last is not None and last > checked)):
            return None
    except (AttributeError, ValueError, TypeError, OverflowError):
        return None
    return checked, coverage, last


def verified_activity(value: object, days: int, now: datetime) -> dict | None:
    """A complete, fresh window remains mandatory before every message part."""
    if (not isinstance(value, dict) or value.get("allowed") is not True
            or ("code" in value and value["code"] != "inactivity_clear")):
        return None
    proof = value.get("activity")
    timestamps = activity_timestamps(proof, now)
    if timestamps is None or proof["complete"] is not True:
        return None
    checked, coverage, last = timestamps
    cutoff = checked - timedelta(days=days)
    if coverage > cutoff or (last is not None and last > cutoff):
        return None
    return proof


def incomplete_activity(value: object, days: int, now: datetime) -> dict | None:
    """An incomplete proof explains a blocked job; it can never start a send."""
    if (not isinstance(value, dict) or value.get("allowed") is not False
            or value.get("code") != "historico_incompleto"):
        return None
    proof = value.get("activity")
    timestamps = activity_timestamps(proof, now)
    if timestamps is None or proof["complete"] is not False:
        return None
    checked, coverage, _ = timestamps
    if coverage <= checked - timedelta(days=days):
        return None
    return proof


def verified_legacy_activity(value: object, job: dict, now: datetime) -> dict | None:
    """Waive only incomplete coverage, never a known recent interaction."""
    if (legacy_authorization(job, now) is None or not isinstance(value, dict)
            or set(value) != {"allowed", "code", "activity", "legacyBatchId"}
            or value.get("allowed") is not True or value.get("code") != "legacy_history_exception"
            or value.get("legacyBatchId") != job["legacyBatchId"]):
        return None
    proof = value.get("activity")
    timestamps = activity_timestamps(proof, now)
    if timestamps is None:
        return None
    checked, coverage, last = timestamps
    cutoff = checked - timedelta(days=5)
    if proof["complete"] != (coverage <= cutoff) or (last is not None and last > cutoff):
        return None
    return proof


def verified_owner_test(value: object, job: dict, now: datetime) -> bool:
    """Exceção explícita vinculada ao job; nunca simula histórico de conversa."""
    if (not valid_owner_test(job) or now >= OWNER_TEST_DEADLINE or not isinstance(value, dict)
            or set(value) != {"allowed", "code", "testLeadId", "jobId", "recipient", "checkedAt"}
            or value.get("allowed") is not True or value.get("code") != "owner_test_authorized"
            or value.get("testLeadId") != job["testLeadId"] or value.get("jobId") != job["id"]
            or value.get("recipient") != job["recipient"]):
        return False
    try:
        checked = datetime.fromisoformat(value["checkedAt"].replace("Z", "+00:00"))
        if checked.tzinfo is None:
            return False
        age = (now - checked).total_seconds()
        return -5 <= age <= 30 and checked < OWNER_TEST_DEADLINE
    except (AttributeError, ValueError, TypeError, OverflowError):
        return False


async def report_ack(api, ledger: Ledger, ack: dict) -> bool:
    response = await api.result(ack, ack["outcome"])
    if response.get("accepted") is not True:
        return False
    ledger.acknowledged(ack)
    return True


async def reconcile(api, ledger: Ledger) -> None:
    """Repete apenas resultados; não reivindica jobs nem chama o MCP."""
    for ack in ledger.pending():
        try:
            if not await report_ack(api, ledger, ack):
                LOG.warning("Resultado local ainda não confirmado pelo sistema")
        except Exception:
            LOG.warning("Resultado local pendente de reconciliação")


async def report_job(api, ledger: Ledger, job: dict, outcome: str) -> None:
    await report_ack(api, ledger, {"id": job["id"], "leaseToken": job["leaseToken"], "outcome": outcome})


async def process(api, mcp, ledger: Ledger, job: dict, *, sleep=asyncio.sleep, clock=None) -> str:
    try:
        parts = message_parts(job)
    except (ValueError, TypeError, OverflowError):
        return "invalid_job"

    def still_unexpired() -> bool:
        return unexpired(job, clock()) if clock is not None else unexpired(job)

    def quiet_hours() -> bool:
        return formulario_quiet_hours(job, clock() if clock is not None else None)

    async def authorize_start(proof: dict | None) -> dict:
        code = "legacy_history_exception" if "legacyAuthorization" in job else None
        return await api.result(job, "started", code=code, activity=proof) if proof is not None else await api.result(job, "started")

    previous = ledger.get(job)
    if previous:
        outcome = "sent" if previous == "sent" else "indeterminate"
        ledger.set(job, outcome)
        await report_job(api, ledger, job, outcome)
        return "reconciled"
    if not still_unexpired():
        return "expired"
    if quiet_hours():
        await api.result(job, "failed", "formulario_nao_perturbe")
        return "quiet_hours"
    try:
        ready = await mcp.ready()
    except Exception:
        ready = False
    if not ready:
        await api.result(job, "failed", "bridge_disconnected")
        return "not_connected"
    async def activity_gate() -> tuple[dict | None, str | None]:
        days = PROPOSAL_TYPES.get(job.get("tipo"))
        if days is None:
            return None, None
        try:
            value = await mcp.activity(job)
            checked_now = clock() if clock is not None else datetime.now(timezone.utc)
            if "testLeadId" in job:
                return (None, None) if verified_owner_test(value, job, checked_now) else (None, "inactivity_unverified")
            if "legacyAuthorization" in job:
                proof = verified_legacy_activity(value, job, checked_now)
                if proof is not None:
                    return proof, None
                code = value.get("code") if isinstance(value, dict) and value.get("allowed") is False else None
                return (None, code if isinstance(code, str) and code in ACTIVITY_BLOCK_CODES else "inactivity_unverified")
            proof = verified_activity(value, days, checked_now)
            if proof is not None:
                return proof, None
            code = value.get("code") if isinstance(value, dict) and value.get("allowed") is False else None
            if not isinstance(code, str) or code not in ACTIVITY_BLOCK_CODES:
                return None, "inactivity_unverified"
            return incomplete_activity(value, days, checked_now), code
        except Exception:
            return None, "inactivity_unverified"

    proof, blocked = await activity_gate()
    if blocked is not None:
        if proof is not None:
            await api.result(job, "failed", blocked, activity=proof)
        else:
            await api.result(job, "failed", blocked)
        return blocked
    # O preflight pode atravessar 21h. Sem início/ledger, a nuvem adia às 9h.
    if quiet_hours():
        await api.result(job, "failed", "formulario_nao_perturbe")
        return "quiet_hours"
    # Se o servidor não confirmar a elegibilidade, não chama WhatsApp.
    accepted = await authorize_start(proof)
    if accepted.get("accepted") is not True:
        return "rejected"
    # O registro antecede o envio. Crash/timeout não permitem repetir o envio.
    ledger.set(job, "started")
    expired_after_start = False
    try:
        sent = still_unexpired()
        expired_after_start = not sent
        for index, part in enumerate(parts):
            if not sent:
                break
            if index:
                # A pausa começa somente depois do ACK de sucesso anterior.
                await sleep(part["delayBeforeSeconds"])
                if not still_unexpired() or quiet_hours() or not await mcp.ready():
                    sent = False
                    break
                # Revalida flag, coluna, telefone, corte e lease antes de cada parte.
                proof, blocked = await activity_gate()
                if blocked is not None:
                    sent = False
                    break
                if quiet_hours():
                    sent = False
                    break
                accepted = await authorize_start(proof)
                if accepted.get("accepted") is not True or not still_unexpired():
                    sent = False
                    break
            # Depois do início não há retomada: um envio parcial permanece
            # indeterminado no ledger, sem repetir mensagens no próximo dia.
            if quiet_hours():
                sent = False
                break
            single = {field: job[field] for field in LEGACY_JOB_FIELDS}
            if "tipo" in job:
                single["tipo"] = job["tipo"]
            if "testLeadId" in job:
                single["testLeadId"] = job["testLeadId"]
            if "legacyAuthorization" in job:
                single["legacyAuthorization"] = job["legacyAuthorization"]
                single["legacyBatchId"] = job["legacyBatchId"]
            single["message"] = part["message"]
            sent = await mcp.send(single) is True
    except asyncio.CancelledError:
        # O shutdown não espera rede: o recibo fica para a próxima reconciliação.
        ledger.set(job, "indeterminate")
        raise
    except Exception:
        sent = False
    outcome = "sent" if sent else "indeterminate"
    ledger.set(job, outcome)
    await report_job(api, ledger, job, outcome)
    return "expired_after_start" if expired_after_start else outcome


async def iteration(api, mcp, ledger: Ledger) -> str:
    # Recibos independem do claim: o servidor nunca devolve jobs já iniciados.
    # Esta sequência é serial sob o flock mantido por run(), inclusive no restart.
    await reconcile(api, ledger)
    # Sessão offline não deve reservar jobs nem consumir suas cinco tentativas.
    try:
        ready = await mcp.ready()
    except Exception:
        ready = False
    if not ready:
        return "not_connected"
    claim = await api.claim()
    if claim.get("active") is not True:
        return "inactive"
    if claim.get("job"):
        return await process(api, mcp, ledger, claim["job"])
    return "idle"


async def run(once: bool) -> None:
    config = json.loads((STATE / "worker-config.json").read_text())
    if config.get("enabled") is not True:
        LOG.info("Worker desativado na configuração local")
        return
    lock_file = (STATE / "worker.lock").open("a")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        LOG.info("Já existe um worker ativo neste Mac")
        return
    token = (STATE / "worker-token").read_text().strip()
    api = API(token)
    ledger = Ledger(STATE / "worker-ledger.db")
    params = StdioServerParameters(command="/bin/bash", args=[str(ROOT / "integrations/whatsapp-local/run-mcp.sh")], cwd=str(ROOT), env=os.environ.copy())
    try:
        # Mesmo um MCP indisponível no restart não bloqueia recibos já gravados.
        await reconcile(api, ledger)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                if [tool.name for tool in tools.tools] != ["send_message"]:
                    raise RuntimeError("Ferramentas MCP divergem da instalação aprovada")
                mcp = LocalMCP(session)
                while True:
                    try:
                        result = await iteration(api, mcp, ledger)
                        if result == "inactive":
                            LOG.info("Automação desativada no sistema")
                        elif result != "idle":
                            LOG.info("Job processado: %s", result)
                    except Exception:
                        # Nunca escrever resposta/telefone/texto/token nos logs.
                        LOG.warning("Fila indisponível ou resultado pendente de reconciliação")
                    if once:
                        break
                    await asyncio.sleep(getattr(api, "poll_after_seconds", 60))
    finally:
        ledger.close()
        api.session.close()
        lock_file.close()


if __name__ == "__main__":
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.once))
