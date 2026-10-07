import assert from "node:assert/strict";
import { test } from "node:test";
import { PERIODOS, ROTULO_PERIODO, ehPeriodo, inicioDoPeriodo } from "./periodo";

/** Quarta-feira, 07/10/2026, 15h em Sao Paulo. */
const QUARTA = Date.parse("2026-10-07T15:00:00-03:00");
/** Meia-noite de Sao Paulo, em UTC: o que o `gte` recebe. */
const meiaNoite = (dia: string) => new Date(`${dia}T00:00:00-03:00`).toISOString();

test("todo o periodo nao corta nada", () => {
  assert.equal(inicioDoPeriodo("todo", QUARTA), null);
});

test("hoje comeca a meia-noite de Sao Paulo, nao a de UTC", () => {
  assert.equal(inicioDoPeriodo("hoje", QUARTA), "2026-10-07T03:00:00.000Z");
  // 23h de terca em SP ja e quarta em UTC: continua sendo terca para a Mel.
  assert.equal(inicioDoPeriodo("hoje", Date.parse("2026-10-06T23:00:00-03:00")), meiaNoite("2026-10-06"));
  assert.equal(inicioDoPeriodo("hoje", Date.parse("2026-10-07T00:00:00-03:00")), meiaNoite("2026-10-07"));
});

test("a semana comeca na segunda", () => {
  assert.equal(inicioDoPeriodo("semana", QUARTA), meiaNoite("2026-10-05"));
  // Na propria segunda, a semana e so ela.
  assert.equal(inicioDoPeriodo("semana", Date.parse("2026-10-05T08:00:00-03:00")), meiaNoite("2026-10-05"));
  // Domingo fecha a semana que comecou seis dias antes, e nao abre outra.
  assert.equal(inicioDoPeriodo("semana", Date.parse("2026-10-04T22:00:00-03:00")), meiaNoite("2026-09-28"));
  // Semana que atravessa o mes volta para o mes anterior.
  assert.equal(inicioDoPeriodo("semana", Date.parse("2026-10-01T10:00:00-03:00")), meiaNoite("2026-09-28"));
});

test("o mes comeca no dia 1, no mes de Sao Paulo", () => {
  assert.equal(inicioDoPeriodo("mes", QUARTA), meiaNoite("2026-10-01"));
  // 22h de 31/10 em SP ja e novembro em UTC: ainda e outubro para a Mel.
  assert.equal(inicioDoPeriodo("mes", Date.parse("2026-10-31T22:00:00-03:00")), meiaNoite("2026-10-01"));
  assert.equal(inicioDoPeriodo("mes", Date.parse("2027-01-01T00:30:00-03:00")), meiaNoite("2027-01-01"));
});

test("so os quatro periodos valem na URL, e todos tem rotulo", () => {
  assert.deepEqual([...PERIODOS], ["todo", "hoje", "semana", "mes"]);
  for (const p of PERIODOS) assert.ok(ehPeriodo(p) && ROTULO_PERIODO[p]);
  assert.equal(ehPeriodo(undefined), false);
  assert.equal(ehPeriodo("ontem"), false);
  assert.equal(ehPeriodo(""), false);
});
