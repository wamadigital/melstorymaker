import assert from "node:assert/strict";
import { test } from "node:test";
import { destinatarioConfirmacao, envelopeJob, MENSAGEM_CONFIRMACAO, resultadoSchema } from "./contrato";

const base = {
  id: "c350bc94-24f1-4359-9e92-eac5f1a76e44", lease_token: "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369",
  destinatario: "5519988887777", mensagem: MENSAGEM_CONFIRMACAO, expira_em: "2026-10-15T18:00:00+00:00",
};
const snapshot = () => [
  { message: "Saudacao congelada anterior", delayBeforeSeconds: 0 },
  { message: "Pergunta congelada anterior", delayBeforeSeconds: 2 },
  { message: "Convite congelado anterior:", delayBeforeSeconds: 3 },
  { message: `https://origem-anterior.invalid/continuar/${base.id}`, delayBeforeSeconds: 2 },
];
const lembrete = (sequencia = snapshot()) => ({
  ...base, tipo: "lembrete_formulario_24h", sequencia, mensagem: sequencia.map((p) => p.message).join("\n\n"),
});

test("destinatario valida DDD e celular antes de normalizar DDI", () => {
  assert.equal(destinatarioConfirmacao("(19) 98888-7777"), "5519988887777");
  assert.equal(destinatarioConfirmacao("+55 19 98888-7777"), "5519988887777");
  assert.equal(destinatarioConfirmacao("(19) 3333-4444"), "551933334444");
  for (const invalido of [null, "", "00000000000", "19888887777", "551998888777700"]) {
    assert.equal(destinatarioConfirmacao(invalido), null);
  }
});

test("envelope entrega somente o necessario ao worker, sem respostas/email/rastreio", () => {
  const job = envelopeJob({
    id: "c350bc94-24f1-4359-9e92-eac5f1a76e44", lease_token: "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369",
    destinatario: "5519988887777", mensagem: MENSAGEM_CONFIRMACAO,
    expira_em: "2026-10-15T18:00:00+00:00", lead_id: "privado", email: "nao@example.invalid",
    respostas: { nome: "privado" }, rastreio: { ip: "privado" },
  });
  assert.deepEqual(Object.keys(job), ["id", "leaseToken", "recipient", "message", "expiresAt"]);
  assert.ok(!JSON.stringify(job).includes("privado"));
  assert.match(job.message, /Recebi as informações do seu evento/);
  assert.ok(!/\b(dias|horas|minutos)\b/.test(job.message), "nao promete prazo");
});

test("resultado rejeita comandos/campos livres e erro bruto com telefone/token", () => {
  const leaseToken = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
  assert.equal(resultadoSchema.safeParse({ leaseToken, outcome: "started" }).success, true);
  assert.equal(resultadoSchema.safeParse({ leaseToken, outcome: "sent", recipient: "5519988887777" }).success, false);
  assert.equal(resultadoSchema.safeParse({ leaseToken, outcome: "retry" }).success, false);
  assert.equal(resultadoSchema.safeParse({ leaseToken, outcome: "failed", code: "HTTP token secreto" }).success, false);
  assert.equal(resultadoSchema.safeParse({ leaseToken, outcome: "failed", code: "bridge_disconnected" }).success, true);
  assert.equal(resultadoSchema.safeParse({ leaseToken, outcome: "started", protocol: 2 }).success, false);
});

test("confirmacao com protocolo2 conserva exatamente cinco campos mesmo apos coluna sequencia", () => {
  const job = envelopeJob({ ...base, tipo: "confirmacao_recebimento", sequencia: null, respostas: { privado: true } }, 2);
  assert.deepEqual(Object.keys(job), ["id", "leaseToken", "recipient", "message", "expiresAt"]);
});

test("protocolo2 entrega snapshot congelado sem derivar copy atual e remove atributos privados", () => {
  const antiga = snapshot().map((p) => ({ ...p, dado_privado: "nao-vazar" }));
  const job = envelopeJob({ ...lembrete(antiga), telefone_privado: "nao-vazar", rastreio: { ip: "nao-vazar" } }, 2);
  assert.deepEqual(job.messagesSequence, snapshot());
  assert.equal(job.message, snapshot().map((p) => p.message).join("\n\n"));
  assert.ok(!JSON.stringify(job).includes("nao-vazar"));
});

test("worker sem protocolo2 nunca recebe lembrete concatenado como fallback", () => {
  assert.throws(() => envelopeJob(lembrete()));
  assert.throws(() => envelopeJob(lembrete(), 1));
  assert.throws(() => envelopeJob({ ...base, tipo: "lembrete_formulario_24h" }, 2));
  assert.throws(() => envelopeJob({ ...base, tipo: "outro_tipo" }, 2));
  assert.throws(() => envelopeJob({ ...base, sequencia: snapshot() }, 2));
});

test("sequencia recusa cardinalidade/pausas/textos invalidos e mensagem legado divergente", () => {
  for (const sequencia of [null, [], snapshot().slice(0, 3), [...snapshot(), snapshot()[0]],
    snapshot().map((p, i) => i === 1 ? { ...p, delayBeforeSeconds: 0 } : p),
    snapshot().map((p, i) => i === 2 ? { ...p, message: " \n " } : p),
    snapshot().map((p, i) => i === 3 ? { ...p, delayBeforeSeconds: "2" } : p)]) {
    assert.throws(() => envelopeJob({ ...lembrete(), sequencia }, 2));
  }
  assert.throws(() => envelopeJob({ ...lembrete(), mensagem: "Texto legado diferente" }, 2));
});

test("quarta mensagem precisa ser somente link individual HTTPS valido", () => {
  for (const message of ["http://crm.invalid/continuar/" + base.id, "https://crm.invalid/formulario",
    "https://crm.invalid/continuar/invalido", "https://crm.invalid/continuar/" + base.id + "?",
    "https://user:senha@crm.invalid/continuar/" + base.id, "Clique: https://crm.invalid/continuar/" + base.id]) {
    const partes = snapshot().map((p, i) => i === 3 ? { ...p, message } : p);
    assert.throws(() => envelopeJob(lembrete(partes), 2));
  }
});
