import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { envelopeJob, validarJobWorker } from "./contrato";
import { assinarAutorizacaoLegada, validarAutorizacaoLegada } from "./lote-legado";
import { sequenciaLembreteProposta } from "./lembretes-proposta";
import { tratarReivindicacao, type DependenciasHttpWhatsApp } from "./http";
import { createClient } from "@supabase/supabase-js";
import { criarRepositorioWhatsApp } from "./index";

const KEY = "fixture-legacy-worker-secret-32-characters";
const NOW = Date.parse("2026-10-16T18:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const SEQ = sequenciaLembreteProposta(7, "https://crm.invalid/p/fixture");
function linha() {
  return { id: ID, lead_id: LEAD, lote_legado_id: BATCH,
    lease_token: "44444444-4444-4444-8444-444444444444", destinatario: "5519988887777",
    tipo: "lembrete_proposta_7d", expira_em: "2026-10-17T18:00:00Z",
    sequencia: SEQ, mensagem: SEQ.map(p => p.message).join("\n\n") };
}
function job() { return envelopeJob(linha(), 6, NOW, KEY); }

test("lote só é exposto ao protocolo6, com chave e snapshot válido", () => {
  for (const protocolo of [1, 2, 3, 4, 5] as const) assert.throws(() => envelopeJob(linha(), protocolo, NOW, KEY));
  assert.throws(() => envelopeJob(linha(), 6, NOW));
  assert.throws(() => envelopeJob({ ...linha(), lead_id: undefined }, 6, NOW, KEY));
  assert.throws(() => envelopeJob({ ...linha(), tipo: "lembrete_proposta_30d" }, 6, NOW, KEY));
  assert.throws(() => envelopeJob({ ...linha(), sequencia: [{ message: "arbitraria", delayBeforeSeconds: 0 }] }, 6, NOW, KEY));
  const j = job();
  assert.equal(j.legacyBatchId, BATCH);
  assert.deepEqual(j.messagesSequence, SEQ);
  validarAutorizacaoLegada(j, NOW, KEY);
  const [encoded, mac] = j.legacyAuthorization!.split(".");
  assert.equal(mac, createHmac("sha256", KEY).update("mel-whatsapp-legacy-v1." + encoded).digest("base64url"));
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(payload.leadId, LEAD);
  assert.equal(payload.expiresAt, "2026-10-16T18:05:00.000Z");
  assert.deepEqual(payload.messages, SEQ.map(p => p.message));
  assert.deepEqual(Object.keys(payload), ["batchId", "jobId", "leadId", "recipient", "tipo", "expiresAt", "messages"]);
});

test("ticket não pode mudar lote, job, destinatário, copy, pausas ou assinatura", () => {
  const j = job();
  for (const mutate of [
    { legacyBatchId: LEAD }, { id: LEAD }, { recipient: "5519977776666" },
    { tipo: "lembrete_proposta_30d" as const }, { legacyAuthorization: j.legacyAuthorization!.slice(0, -1) + "!" },
    { testLeadId: LEAD }, { legacyBatchId: undefined }, { legacyAuthorization: undefined },
    { messagesSequence: SEQ.map((p, i) => i === 1 ? { ...p, message: "outra mensagem" } : p) },
    { messagesSequence: SEQ.map((p, i) => i === 1 ? { ...p, delayBeforeSeconds: 3 } : p) },
  ]) assert.throws(() => validarAutorizacaoLegada({ ...j, ...mutate }, NOW, KEY));
  assert.throws(() => validarAutorizacaoLegada(j, NOW, "outra-chave-com-mais-de-32-caracteres"));
  assert.throws(() => validarAutorizacaoLegada(j, NOW + 300_000, KEY));
  assert.throws(() => validarAutorizacaoLegada(j, NOW - 1, KEY));
  assert.throws(() => validarJobWorker(j, 5, NOW, KEY));
  assert.throws(() => assinarAutorizacaoLegada({ ...j, expiresAt: "2026-10-15T00:00:00Z" }, LEAD, KEY, NOW));
});

test("ticket com campos desconhecidos ou formato ambíguo é recusado", () => {
  const j = job();
  const [encoded] = j.legacyAuthorization!.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const texto = Buffer.from(JSON.stringify({ ...payload, allowRecent: true })).toString("base64url");
  const mac = createHmac("sha256", KEY).update("mel-whatsapp-legacy-v1." + texto).digest("base64url");
  assert.throws(() => validarAutorizacaoLegada({ ...j, legacyAuthorization: texto + "." + mac }, NOW, KEY));
  for (const token of ["x.y", "a".repeat(8193), j.legacyAuthorization! + "=", ""])
    assert.throws(() => validarAutorizacaoLegada({ ...j, legacyAuthorization: token }, NOW, KEY));
});

test("protocolos antigos conservam o envelope normal sem exceção", () => {
  const normal = { ...linha(), lote_legado_id: null };
  for (const protocolo of [3, 4, 5, 6] as const) {
    const j = envelopeJob(normal, protocolo, NOW);
    assert.equal(j.legacyBatchId, undefined);
    assert.equal(j.legacyAuthorization, undefined);
  }
});

test("claim6 informa cadência temporária e verifica a assinatura do envelope", async () => {
  const deps: DependenciasHttpWhatsApp = {
    ambiente: { WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_LEMBRETE_PROPOSTA_ATIVO: "true", WHATSAPP_WORKER_TOKEN: KEY },
    agora: () => NOW, reivindicar: async () => job(), resultado: async () => null, cadencia: async () => 10,
  };
  const request = () => new Request("https://crm.invalid/api/integracoes/whatsapp/reivindicar", {
    method: "POST", headers: { authorization: `Bearer ${KEY}`, "X-Mel-Worker-Protocol": "6" },
  });
  const response = await tratarReivindicacao(request(), deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.protocolVersion, 6);
  assert.equal(body.pollAfterSeconds, 10);
  assert.equal(body.job.legacyBatchId, BATCH);
  deps.reivindicar = async () => null;
  deps.cadencia = async () => 60;
  const idle = await (await tratarReivindicacao(request(), deps)).json();
  assert.equal(idle.job, null);
  assert.equal(idle.pollAfterSeconds, 60);
});

test("repositório6 usa V7 e preserva prova incompleta verdadeira no resultado", async () => {
  const calls: { nome: string; body: Record<string, unknown> }[] = [];
  const db = createClient("https://crm.invalid", "fixture", { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.hostname, "crm.invalid");
      const nome = url.pathname.split("/").at(-1)!;
      const body = JSON.parse(String(init?.body));
      calls.push({ nome, body });
      return Response.json(nome === "reivindicar_whatsapp_v7" ? [linha()] : "enviando");
    },
  } });
  const repo = criarRepositorioWhatsApp(db, { protocolo: 6, agora: () => NOW, ambiente: {
    WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_LEMBRETE_PROPOSTA_ATIVO: "true", WHATSAPP_WORKER_TOKEN: KEY,
  } });
  const j = await repo.reivindicar();
  assert.equal(j?.legacyBatchId, BATCH);
  validarAutorizacaoLegada(j!, NOW, KEY);
  const proof = { checkedAt: new Date(NOW).toISOString(), coverageStartedAt: new Date(NOW - 3_600_000).toISOString(), lastInteractionAt: null, complete: false };
  assert.equal(await repo.resultado(ID, { leaseToken: linha().lease_token, outcome: "started", code: "legacy_history_exception", activity: proof }), "enviando");
  assert.equal(calls[0].nome, "reivindicar_whatsapp_v7");
  assert.equal(calls[1].nome, "resultado_whatsapp_v7");
  assert.equal(calls[1].body.p_historico_completo, false);
  assert.equal(calls[1].body.p_historico_cobertura_inicio_em, proof.coverageStartedAt);
  assert.equal(calls[1].body.p_propostas_ativo, true);
});
