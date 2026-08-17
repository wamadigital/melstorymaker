import assert from "node:assert/strict";
import { test } from "node:test";
import { dataCurta, dataExtenso, horaBr } from "./formatadores";

test("data por extenso em pt-BR (RF-15)", () => {
  assert.equal(dataExtenso("2026-03-14"), "14 de março de 2026");
  assert.equal(dataExtenso("2026-12-01"), "1 de dezembro de 2026");
  assert.equal(dataExtenso("2026-08-31"), "31 de agosto de 2026");
});

test("data por extenso nao escorrega de fuso", () => {
  // O bug que este teste existe para travar: new Date("2026-01-01") e meia-noite
  // UTC, que em Brasilia (UTC-3) e 21h de 31/12/2025. A proposta sairia com o
  // ano errado. O parse por regex nao passa por Date nenhuma vez.
  assert.equal(dataExtenso("2026-01-01"), "1 de janeiro de 2026");
  assert.equal(dataExtenso("2026-03-01"), "1 de março de 2026");
});

test("data invalida ou ausente vira string vazia, nunca 'Invalid Date' no PDF", () => {
  assert.equal(dataExtenso(null), "");
  assert.equal(dataExtenso(undefined), "");
  assert.equal(dataExtenso(""), "");
  assert.equal(dataExtenso("14/03/2026"), "");
  assert.equal(dataExtenso("2026-13-01"), "");
});

test("hora no padrao pt-BR", () => {
  assert.equal(horaBr("19:30"), "19h30");
  assert.equal(horaBr("09:45"), "9h45");
  assert.equal(horaBr("23:59"), "23h59");
});

test("hora cheia perde os zeros", () => {
  assert.equal(horaBr("19:00"), "19h");
  assert.equal(horaBr("08:00"), "8h");
});

test("hora invalida vira string vazia", () => {
  assert.equal(horaBr(null), "");
  assert.equal(horaBr("25:00"), "");
  assert.equal(horaBr("sete horas"), "");
});

test("data curta para o painel", () => {
  assert.equal(dataCurta("2026-03-14"), "14/03/2026");
  assert.equal(dataCurta(null), "");
});
