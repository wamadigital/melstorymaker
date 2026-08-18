import assert from "node:assert/strict";
import { test } from "node:test";
import { validarTelefoneBr } from "./validacao";

// -------------------------------------------------- telefone brasileiro real

test("telefone: celular e fixo válidos passam", () => {
  assert.equal(validarTelefoneBr("(19) 99999-8888"), null);
  assert.equal(validarTelefoneBr("19999998888"), null);
  // Fixo de 10 dígitos: WhatsApp Business roda em fixo, e o fluxo corporativo
  // precisa disso.
  assert.equal(validarTelefoneBr("(11) 3333-4444"), null);
  // Colado com o DDI, como quem copia do próprio WhatsApp.
  assert.equal(validarTelefoneBr("+55 19 99999-8888"), null);
  assert.equal(validarTelefoneBr("5519999998888"), null);
});

test("telefone: DDD que não existe é recusado", () => {
  assert.match(validarTelefoneBr("(00) 99999-8888") ?? "", /DDD/);
  assert.match(validarTelefoneBr("(10) 99999-8888") ?? "", /DDD/);
  assert.match(validarTelefoneBr("(20) 99999-8888") ?? "", /DDD/);
});

test("telefone: tamanho errado é recusado", () => {
  assert.ok(validarTelefoneBr("199999") !== null);
  assert.ok(validarTelefoneBr("1999999888812345") !== null);
});

test("telefone: celular de 11 dígitos precisa do 9", () => {
  assert.match(validarTelefoneBr("(19) 88888-7777") ?? "", /começa com 9/);
});

test("telefone: o validador é simples de propósito, não trava lead", () => {
  // Número claramente fictício, mas com forma válida: passa. Preferimos deixar
  // entrar a barrar alguém de verdade — a Mel confere depois.
  assert.equal(validarTelefoneBr("(19) 99999-9999"), null);
  assert.equal(validarTelefoneBr("(11) 91111-1111"), null);
});
