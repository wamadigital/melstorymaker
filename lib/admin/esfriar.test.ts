import assert from "node:assert/strict";
import { test } from "node:test";
import { DIAS_SEM_UPDATE, cortesDeEsfriar, deveEsfriar } from "./esfriar";
import { STATUS } from "@/lib/form/types";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-10-07T15:00:00-03:00");
const ha = (dias: number) => new Date(AGORA - dias * DIA).toISOString();

/** Lead em "Enviado" com a proposta de `envio` dias atrás e o último update de `update` dias atrás. */
const lead = (envio: number, update = envio, status: (typeof STATUS)[number] = "enviado") => ({
  status,
  enviado_em: ha(envio),
  updated_at: ha(update),
});

test("intocado desde o envio: esfria no 14º dia, nem um minuto antes", () => {
  // Dia 7: passa do prazo e fica azul-claro em Enviado. Mais 7 sem update: Esfriou.
  assert.equal(DIAS_SEM_UPDATE, 7);
  assert.equal(deveEsfriar(lead(13), AGORA), false);
  assert.equal(deveEsfriar(lead(14 - 1 / 1440), AGORA), false, "faltando 1 minuto ainda fica");
  assert.equal(deveEsfriar(lead(14), AGORA), true);
  assert.equal(deveEsfriar(lead(40), AGORA), true);
});

test("cobrado no 9º dia: o update segura mais uma semana, esfria no 16º", () => {
  // A cobrança carimba `lembrete_7_em` e, com ela, o `updated_at`.
  const cobradoNoDia9 = (hoje: number) => lead(hoje, hoje - 9);
  assert.equal(deveEsfriar(cobradoNoDia9(15), AGORA), false);
  assert.equal(deveEsfriar(cobradoNoDia9(16), AGORA), true);
});

test("qualquer update recente segura o lead em Enviado, mesmo com a proposta velha", () => {
  // Ex.: a Mel trouxe o cartão de volta de Esfriou porque o cliente respondeu.
  assert.equal(deveEsfriar(lead(40, 2), AGORA), false);
  assert.equal(deveEsfriar(lead(40, 7), AGORA), true);
});

test("só esfria quem está em Enviado e tem data de envio", () => {
  for (const status of STATUS) {
    assert.equal(deveEsfriar(lead(40, 40, status), AGORA), status === "enviado", status);
  }
  assert.equal(deveEsfriar({ status: "enviado", enviado_em: null, updated_at: ha(40) }, AGORA), false);
  assert.equal(deveEsfriar({ status: "enviado", enviado_em: "torto", updated_at: ha(40) }, AGORA), false);
});

test("os cortes do banco são os mesmos da regra", () => {
  // `esfriarParados` filtra com estes dois ISO; a fronteira tem de bater com
  // `deveEsfriar`, senão o quadro e o cron discordariam de quem esfriou.
  const { enviadoAte, paradoDesde } = cortesDeEsfriar(AGORA);
  assert.equal(enviadoAte, ha(14));
  assert.equal(paradoDesde, ha(7));
  assert.equal(deveEsfriar({ status: "enviado", enviado_em: enviadoAte, updated_at: paradoDesde }, AGORA), true);
});
