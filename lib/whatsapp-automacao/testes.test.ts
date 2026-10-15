import { test } from "node:test";
import assert from "node:assert/strict";
import { marcoTesteOwner, testeOwnerPropostaValido, TESTE_OWNER_EXPIRA_EM, TESTES_OWNER_MARCOS } from "./testes";

const agora = Date.parse("2026-10-15T18:00:00Z");
const sete = "01b985e2-6bff-4e9c-bb5e-2f1cc280edf7";
const trinta = "abf88ff2-ea34-4e32-994d-f7dc75df599b";
const base = { leadId: sete, nome: "TESTE HENRIQUE", destinatario: "19988763916" };
const job = { leadId: sete, recipient: "5519988763916", tipo: "lembrete_proposta_7d", expiresAt: TESTE_OWNER_EXPIRA_EM };

test("somente cinco IDs fixos, tres de7d e dois de30d, exibem o botao de teste", () => {
  assert.equal(Object.keys(TESTES_OWNER_MARCOS).length, 5);
  for (const [leadId, marco] of Object.entries(TESTES_OWNER_MARCOS)) {
    assert.equal(marcoTesteOwner({ ...base, leadId }, agora), marco);
    assert.ok(testeOwnerPropostaValido({ ...job, leadId, tipo: `lembrete_proposta_${marco}d` }, agora));
  }
  assert.equal(marcoTesteOwner({ ...base, leadId: "10000000-0000-4000-8000-000000000001" }, agora), null);
  assert.equal(marcoTesteOwner({ ...base, leadId: "toString" }, agora), null);
  assert.ok(!testeOwnerPropostaValido({ ...job, leadId: "toString" }, agora));
});
test("apresentacao exige nome exato e aceita somente telefone nacional ou DDI do owner", () => {
  for (const destinatario of ["19988763916", "5519988763916", "+55 (19) 98876-3916"]) {
    assert.equal(marcoTesteOwner({ ...base, destinatario }, agora), 7);
  }
  for (const destinatario of ["19988763917", "x19988763916", "0019988763916", "", null]) {
    assert.equal(marcoTesteOwner({ ...base, destinatario }, agora), null);
  }
  for (const nome of ["TESTE HENRIQUE ", "Teste Henrique", "TESTE", null]) {
    assert.equal(marcoTesteOwner({ ...base, nome }, agora), null);
  }
});
test("prazo e fixo e fecha exatamente na expiracao", () => {
  const fim = Date.parse(TESTE_OWNER_EXPIRA_EM);
  assert.equal(marcoTesteOwner(base, fim - 1), 7);
  assert.ok(testeOwnerPropostaValido(job, fim - 1));
  for (const tempo of [fim, fim + 1, NaN, Infinity]) {
    assert.equal(marcoTesteOwner(base, tempo), null);
    assert.ok(!testeOwnerPropostaValido(job, tempo));
  }
});
test("wire exige marcador exato, telefone E164 e tipo correspondente; ausencia nao concede excecao", () => {
  assert.ok(testeOwnerPropostaValido(job, agora));
  assert.ok(testeOwnerPropostaValido({ ...job, expiresAt: "2026-10-17T18:00:00+00:00" }, agora));
  for (const alteracao of [
    { expiresAt: undefined }, { expiresAt: null }, { expiresAt: "2026-10-17T18:00:01Z" },
    { expiresAt: "invalid" }, { recipient: "19988763916" }, { recipient: "5519988763917" },
    { tipo: "lembrete_formulario_24h" }, { tipo: "lembrete_proposta_30d" }, { leadId: trinta },
  ]) assert.ok(!testeOwnerPropostaValido({ ...job, ...alteracao }, agora));
});
