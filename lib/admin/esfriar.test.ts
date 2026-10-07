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

test("Enviado dura no máximo 7 dias: esfria no 7º, nem um minuto antes", () => {
  assert.equal(DIAS_SEM_UPDATE, 7);
  assert.equal(deveEsfriar(lead(6), AGORA), false);
  assert.equal(deveEsfriar(lead(7 - 1 / 1440), AGORA), false, "faltando 1 minuto ainda fica");
  assert.equal(deveEsfriar(lead(7), AGORA), true);
  assert.equal(deveEsfriar(lead(40), AGORA), true);
});

test("quem a Mel trouxe de volta do Esfriou ganha mais uma semana em Enviado", () => {
  // O cliente respondeu no dia 20: a mudança carimba o update, e a proposta
  // antiga não manda o cartão de volta na hora.
  assert.equal(deveEsfriar(lead(20, 0), AGORA), false);
  assert.equal(deveEsfriar(lead(26, 6), AGORA), false);
  assert.equal(deveEsfriar(lead(27, 7), AGORA), true);
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
  assert.equal(enviadoAte, ha(7));
  assert.equal(paradoDesde, ha(7));
  assert.equal(deveEsfriar({ status: "enviado", enviado_em: enviadoAte, updated_at: paradoDesde }, AGORA), true);
});
