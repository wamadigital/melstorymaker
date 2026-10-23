import assert from "node:assert/strict";
import { test } from "node:test";
import { eventoPassado } from "./evento-passado";

test("ontem encerrou, mas hoje e datas futuras continuam ativas", () => {
  const agoraMs = Date.parse("2026-10-23T15:00:00.000Z");
  assert.equal(eventoPassado("2026-10-22", agoraMs), true);
  assert.equal(eventoPassado("2026-10-23", agoraMs), false);
  assert.equal(eventoPassado("2026-10-24", agoraMs), false);
});

test("a virada do evento segue São Paulo, sem antecipar à meia-noite UTC", () => {
  assert.equal(eventoPassado("2026-10-22", Date.parse("2026-10-23T00:00:00.000Z")), false);
  assert.equal(eventoPassado("2026-10-22", Date.parse("2026-10-23T02:59:59.999Z")), false);
  assert.equal(eventoPassado("2026-10-22", Date.parse("2026-10-23T03:00:00.000Z")), true);
});

test("datas inválidas, ausentes e formatos de apresentação não encerram o lead", () => {
  const agoraMs = Date.parse("2026-10-23T15:00:00.000Z");
  for (const valor of [null, undefined, "", "2026-02-29", "2026-04-31", "2026-00-10", "2026-13-10", "0000-10-10", "2026-10-00", "22.10.2026", "22/10/2026", "2026-10-22T00:00:00Z", " 2026-10-22 "]) {
    assert.equal(eventoPassado(valor, agoraMs), false, `Não encerrar por ${String(valor)}`);
  }
  assert.equal(eventoPassado("2026-10-22", NaN), false);
});

test("calendário real preserva anos bissextos e transições de mês e ano", () => {
  assert.equal(eventoPassado("2024-02-29", Date.parse("2024-03-01T03:00:00.000Z")), true);
  assert.equal(eventoPassado("2024-02-29", Date.parse("2024-02-29T15:00:00.000Z")), false);
  assert.equal(eventoPassado("2100-02-29", Date.parse("2100-03-01T15:00:00.000Z")), false);
  assert.equal(eventoPassado("2000-02-29", Date.parse("2000-03-01T15:00:00.000Z")), true);
  assert.equal(eventoPassado("2026-12-31", Date.parse("2027-01-01T03:00:00.000Z")), true);
});
