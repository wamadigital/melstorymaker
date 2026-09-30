import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MarcacaoInvalidaError,
  ReferenciaInvalidaError,
  idsRepetidos,
  negritoBalanceado,
  numerarClausulas,
  parseNegrito,
  placeholdersRestantes,
  referenciasDoTexto,
  resolverReferencias,
  textoSemMarcacao,
} from "./marcacao";

const CLAUSULAS = [{ id: "objeto" }, { id: "local" }, { id: "pagamento" }, { id: "direitos" }, { id: "desistencia" }];

test("numeracao sai da ordem das clausulas, comecando em 1", () => {
  const mapa = numerarClausulas(CLAUSULAS);
  assert.equal(mapa.get("objeto"), 1);
  assert.equal(mapa.get("direitos"), 4);
  assert.equal(mapa.get("desistencia"), 5);
  assert.equal(mapa.size, 5);
});

test("id repetido fica com a primeira posicao, e a repeticao e apontada", () => {
  const clausulas = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "b" }, { id: "a" }];
  assert.equal(numerarClausulas(clausulas).get("a"), 1);
  assert.deepEqual(idsRepetidos(clausulas), ["a", "b"]);
  assert.deepEqual(idsRepetidos(CLAUSULAS), []);
});

test("{{n}} vira o numero da propria clausula e {{ref:x}} o numero de x", () => {
  const mapa = numerarClausulas(CLAUSULAS);
  assert.equal(
    resolverReferencias("{{n}}.1. **O sinal previsto na Cláusula {{ref:pagamento}} não será reembolsado.**", 5, mapa),
    "5.1. **O sinal previsto na Cláusula 3 não será reembolsado.**",
  );
  assert.equal(resolverReferencias("{{n}}.1 e {{n}}.2", 7, mapa), "7.1 e 7.2");
  assert.equal(resolverReferencias("Sem marcação.", 1, mapa), "Sem marcação.");
});

test("espaco dentro das chaves e tolerado", () => {
  const mapa = numerarClausulas(CLAUSULAS);
  assert.equal(resolverReferencias("{{ n }} / {{ ref: direitos }} / {{ref :local}}", 9, mapa), "9 / 4 / 2");
});

test("remissao para clausula que nao existe lanca, com o id no erro", () => {
  const mapa = numerarClausulas(CLAUSULAS);
  assert.throws(
    () => resolverReferencias("Nos termos da Cláusula {{ref:equipe}}.", 1, mapa),
    (e: unknown) => e instanceof ReferenciaInvalidaError && e.id === "equipe" && /não existe/.test(e.message),
  );
});

test("outros {{...}} nao sao resolvidos: ficam para a validacao acusar", () => {
  const mapa = numerarClausulas(CLAUSULAS);
  assert.equal(resolverReferencias("Valor: {{valor}}.", 1, mapa), "Valor: {{valor}}.");
});

test("referencias do texto listam cada id uma vez", () => {
  assert.deepEqual(referenciasDoTexto("{{ref:a}} {{ref:b}} {{ ref: a }} {{n}}"), ["a", "b"]);
  assert.deepEqual(referenciasDoTexto("nada"), []);
});

test("negrito: cada ** alterna, espacos das pontas sao mantidos", () => {
  assert.deepEqual(parseNegrito("Texto **limitativo** e mais."), [
    { texto: "Texto ", negrito: false },
    { texto: "limitativo", negrito: true },
    { texto: " e mais.", negrito: false },
  ]);
  assert.deepEqual(parseNegrito("**Tudo em negrito.**"), [{ texto: "Tudo em negrito.", negrito: true }]);
  assert.deepEqual(parseNegrito("Sem negrito."), [{ texto: "Sem negrito.", negrito: false }]);
  assert.deepEqual(parseNegrito(""), []);
});

test("negrito: trecho vazio some e vizinhos de mesmo peso se juntam", () => {
  assert.deepEqual(parseNegrito("a****b"), [{ texto: "ab", negrito: false }]);
  assert.deepEqual(parseNegrito("**a****b**"), [{ texto: "ab", negrito: true }]);
});

test("negrito desbalanceado lanca, e a checagem sem lancar concorda", () => {
  assert.throws(() => parseNegrito("Texto **sem fim."), MarcacaoInvalidaError);
  assert.throws(() => parseNegrito("**a** **b"), MarcacaoInvalidaError);
  assert.equal(negritoBalanceado("Texto **sem fim."), false);
  assert.equal(negritoBalanceado("**a** e **b**"), true);
  assert.equal(negritoBalanceado("nenhum"), true);
});

test("texto sem marcacao tira so os **", () => {
  assert.equal(textoSemMarcacao("A **reserva** da data {{n}}"), "A reserva da data {{n}}");
});

test("placeholders restantes: chave de template, chave solta e placeholder da IA", () => {
  assert.deepEqual(placeholdersRestantes("Cláusula {{n}}, ver {{ref:direitos}}."), []);
  assert.deepEqual(placeholdersRestantes("Valor de {{valor}} e {{ valor_extenso }}."), ["{{valor}}", "{{ valor_extenso }}"]);
  assert.deepEqual(placeholdersRestantes("Ver Cláusula {{ref:direitos."), ["{{ref:direitos."]);
  assert.deepEqual(placeholdersRestantes("Ver Cláusula direitos}}."), ["direitos}}"]);
  assert.deepEqual(placeholdersRestantes("Assina [CONTRATANTE], CPF [CPF], em [ENDERECO_CONTRATANTE]."), [
    "[CONTRATANTE]",
    "[CPF]",
    "[ENDERECO_CONTRATANTE]",
  ]);
  assert.deepEqual(placeholdersRestantes("[HOMENAGEADO] e [HOMENAGEADO]"), ["[HOMENAGEADO]"]);
});

test("placeholders restantes nao confundem texto comum com marcacao", () => {
  assert.deepEqual(placeholdersRestantes("Item [A] e [b], com (parênteses) e R$ 1.500,00."), []);
  assert.deepEqual(placeholdersRestantes(""), []);
});
