import assert from "node:assert/strict";
import { test } from "node:test";
import { validarResposta, validarTelefoneBr } from "./validacao";
import { A_DEFINIR, ehADefinir, type Passo } from "./types";

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

// ------------------------------------------------------- "decidir depois" --

const horario = (aDefinir?: string) =>
  ({ id: "horario", tipo: "hora", pergunta: "", obrigatorio: true, a_definir: aDefinir }) as Passo;

test("'decidir depois': a marca vale como resposta onde o arvore.json oferece a caixa", () => {
  const passo = horario("Decidir isso depois");
  assert.equal(validarResposta(passo, A_DEFINIR), null);
  assert.equal(validarResposta(passo, "19:30"), null);
  // Fora da marca, a hora continua sendo conferida.
  assert.ok(validarResposta(passo, "às sete"));
});

test("'decidir depois': sem a caixa no passo, 'A definir' continua sendo horario invalido", () => {
  assert.ok(validarResposta(horario(), A_DEFINIR));
});

test("'decidir depois': vazio continua recusado, e a mensagem aponta a caixa", () => {
  assert.match(validarResposta(horario("Decidir isso depois"), "") ?? "", /Decidir isso depois/);
  assert.equal(validarResposta(horario(), ""), "Esse campo é obrigatório.");
});

test("'decidir depois': a marca e reconhecida mesmo digitada a mao", () => {
  assert.ok(ehADefinir("A definir"));
  assert.ok(ehADefinir("  a definir "));
  assert.ok(ehADefinir("A DEFINIR"));
  assert.ok(!ehADefinir(""));
  assert.ok(!ehADefinir(null));
  assert.ok(!ehADefinir("A definir com o buffet"));
});
