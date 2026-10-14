import assert from "node:assert/strict";
import { test } from "node:test";
import { destinatarioConfirmacao, envelopeJob, MENSAGEM_CONFIRMACAO, resultadoSchema } from "./contrato";

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
});
