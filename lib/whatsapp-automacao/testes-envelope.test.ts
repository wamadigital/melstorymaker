import { test } from "node:test";
import assert from "node:assert/strict";
import { envelopeJob, validarJobWorker } from "./contrato";
import { sequenciaLembreteProposta } from "./lembretes-proposta";
import { TESTE_OWNER_EXPIRA_EM, TESTES_OWNER_MARCOS } from "./testes";

const now = Date.parse("2026-10-15T18:00:00Z");
const row = (leadId: string, marco: 7 | 30) => {
  const tipo = `lembrete_proposta_${marco}d` as const;
  const sequencia = sequenciaLembreteProposta(marco, "https://melstorymaker.com.br/p/abcd");
  return { id: "c350bc94-24f1-4359-9e92-eac5f1a76e44", lease_token: "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369",
    lead_id: leadId, destinatario: "5519988763916", mensagem: sequencia.map(p => p.message).join("\n\n"),
    expira_em: "2026-10-16T18:00:00Z", tipo, sequencia, teste_owner_expira_em: TESTE_OWNER_EXPIRA_EM };
};
test("envelope dos cinco testes entrega somente a autorizacao vinculada ao card correto", () => {
  for (const [leadId, marco] of Object.entries(TESTES_OWNER_MARCOS)) {
    const job = envelopeJob(row(leadId, marco), 3, now);
    assert.equal(job.testLeadId, leadId);
    assert.equal(job.tipo, `lembrete_proposta_${marco}d`);
    assert.ok(!("teste_owner_expira_em" in job));
    assert.deepEqual(validarJobWorker(job, 3, now), job);
    assert.throws(() => validarJobWorker({ ...job, recipient: "5519988763917" }, 3, now));
    assert.throws(() => validarJobWorker(job, 3, Date.parse(TESTE_OWNER_EXPIRA_EM)));
    assert.throws(() => validarJobWorker(job, 2, now));
  }
});
test("marcador de teste divergente nunca vira job normal como fallback", () => {
  const valid = row(Object.keys(TESTES_OWNER_MARCOS)[0], 7);
  for (const change of [{ lead_id: "10000000-0000-4000-8000-000000000001" },
    { lead_id: undefined }, { destinatario: "5519988763917" },
    { teste_owner_expira_em: "2026-10-17T18:00:01Z" }]) {
    assert.throws(() => envelopeJob({ ...valid, ...change }, 3, now));
  }
  assert.throws(() => envelopeJob(valid, 3, Date.parse(TESTE_OWNER_EXPIRA_EM)));
  const normal = envelopeJob({ ...valid, teste_owner_expira_em: null }, 3, now);
  assert.ok(!("testLeadId" in normal));
});
