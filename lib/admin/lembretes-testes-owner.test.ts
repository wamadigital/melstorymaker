import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoLembrete } from "./lembretes";

const now = Date.parse("2026-10-15T18:00:00Z");
const enviada = "2026-09-10T18:00:00Z";
const normal = { enviado_em: enviada, lembrete_7_em: null, lembrete_30_em: null };
const teste = { ...normal, teste_whatsapp: { marco: 30 as const, expiraEm: "2026-10-17T18:00:00Z" } };
test("apresenta ultima tentativa apenas com metadado de teste valido, sem inventar ACK7", () => {
  assert.equal(estadoLembrete(normal, "esfriou", now).pendente, 7);
  assert.equal(estadoLembrete(teste, "esfriou", now).pendente, 30);
  assert.equal(estadoLembrete(teste, "esfriou", Date.parse(teste.teste_whatsapp.expiraEm)).pendente, 7);
  assert.equal(estadoLembrete(teste, "aguardando_revisao", now).pendente, null);
  const recebido = { ...teste, disparos_whatsapp: [{ tipo: "lembrete_proposta_30d" as const,
    enviado_em: new Date(now).toISOString(), proposta_enviado_em: enviada }] };
  const depois = estadoLembrete(recebido, "esfriou", now);
  assert.equal(depois.pendente, null);
  assert.equal(depois.cobrado, 30);
  const fim = estadoLembrete(recebido, "esfriou", Date.parse(teste.teste_whatsapp.expiraEm));
  assert.equal(fim.pendente, null);
  assert.equal(fim.cobrado, 30);
});
