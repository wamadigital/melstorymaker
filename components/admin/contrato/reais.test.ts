import assert from "node:assert/strict";
import { test } from "node:test";
import {
  centavosDoColado,
  centavosDoTexto,
  limitar,
  MAXIMO_CENTAVOS,
  numeroDoTexto,
  textoDeCentavos,
  textoDeNumero,
  textoNumericoAceito,
} from "./reais";

test("o campo de reais le so os digitos, como a maquininha: 1 5 0 0 0 0 vira R$ 1.500,00", () => {
  assert.equal(centavosDoTexto("150000"), 150000);
  assert.equal(centavosDoTexto("1.500,00"), 150000);
  assert.equal(centavosDoTexto("R$ 1.500,00"), 150000);
  // digitar mais um zero no fim empurra tudo uma casa
  assert.equal(centavosDoTexto("1.500,000"), 1500000);
  // apagar o ultimo digito puxa de volta
  assert.equal(centavosDoTexto("1.500,0"), 15000);
  assert.equal(centavosDoTexto("7"), 7);
});

test("campo de reais vazio, so com zeros ou com letra perdida vale zero, nunca NaN", () => {
  assert.equal(centavosDoTexto(""), 0);
  assert.equal(centavosDoTexto("0,00"), 0);
  assert.equal(centavosDoTexto("abc"), 0);
  assert.equal(centavosDoTexto("12a3"), 123);
});

test("valor acima do teto do schema para no teto, em vez de estourar no servidor", () => {
  assert.equal(centavosDoTexto("99999999999999999999"), MAXIMO_CENTAVOS);
  assert.equal(centavosDoTexto("100000001"), MAXIMO_CENTAVOS);
  assert.equal(centavosDoTexto("10000000"), MAXIMO_CENTAVOS);
  assert.equal(centavosDoTexto("9999999"), 9999999);
});

test("colar um preco em reais inteiros ('R$ 1.500', '1.500', '1500 reais') vale reais, nao centavos", () => {
  assert.equal(centavosDoColado("R$ 1.500"), 150000);
  assert.equal(centavosDoColado("1.500"), 150000);
  assert.equal(centavosDoColado("1500 reais"), 150000);
  assert.equal(centavosDoColado("R$ 380"), 38000);
  assert.equal(centavosDoColado("R$ 2.090"), 209000);
  assert.equal(centavosDoColado("  R$ 12.345  "), 1234500);
  assert.equal(centavosDoColado("1 real"), 100);
  // Antes desta regra o colar passava pela maquininha: "R$ 1.500" = R$ 15,00.
  assert.notEqual(centavosDoColado("R$ 1.500"), centavosDoTexto("R$ 1.500"));
});

test("colar com centavos escritos, ou numero puro, continua com a maquininha", () => {
  // Com virgula, os centavos estao no texto: a maquininha ja acerta.
  assert.equal(centavosDoColado("R$ 1.500,00"), null);
  assert.equal(centavosDoTexto("R$ 1.500,00"), 150000);
  assert.equal(centavosDoColado("1500,5"), null);
  // Numero puro e ambiguo: fica como a Mel ve acontecer ao digitar.
  assert.equal(centavosDoColado("1500"), null);
  assert.equal(centavosDoColado("15"), null);
  // Ponto decimal nao e milhar: "R$ 1500.50" fica com a maquininha (R$ 1.500,50).
  assert.equal(centavosDoColado("R$ 1500.50"), null);
  assert.equal(centavosDoTexto("R$ 1500.50"), 150050);
  // Texto que nao e preco.
  assert.equal(centavosDoColado(""), null);
  assert.equal(centavosDoColado("abc"), null);
  assert.equal(centavosDoColado("R$"), null);
  assert.equal(centavosDoColado("1.50"), null);
});

test("colar acima do teto para no teto, como ao digitar", () => {
  assert.equal(centavosDoColado("R$ 100.000"), MAXIMO_CENTAVOS);
  assert.equal(centavosDoColado("1.000.000"), MAXIMO_CENTAVOS);
  assert.equal(centavosDoColado("R$ 99999999999999999999"), MAXIMO_CENTAVOS);
});

test("zero aparece como campo vazio (ainda nao informado); o resto no formato pt-BR sem o R$", () => {
  assert.equal(textoDeCentavos(0), "");
  assert.equal(textoDeCentavos(-5), "");
  assert.equal(textoDeCentavos(150000), "1.500,00");
  assert.equal(textoDeCentavos(19350), "193,50");
  assert.equal(textoDeCentavos(1), "0,01");
});

test("ida e volta: o texto mostrado relido da o mesmo valor em centavos", () => {
  for (const c of [1, 99, 100, 38700, 90300, 129000, 1234567, MAXIMO_CENTAVOS]) {
    assert.equal(centavosDoTexto(textoDeCentavos(c)), c);
  }
});

test("percentual aceita virgula ou ponto e no maximo duas casas; letra e recusada na tecla", () => {
  assert.ok(textoNumericoAceito("", 2));
  assert.ok(textoNumericoAceito("33,33", 2));
  assert.ok(textoNumericoAceito("33.3", 2));
  assert.ok(textoNumericoAceito("33,", 2));
  assert.ok(!textoNumericoAceito("33,333", 2));
  assert.ok(!textoNumericoAceito("3a", 2));
  assert.ok(!textoNumericoAceito("33,3", 0));
  assert.ok(textoNumericoAceito("10", 0));
});

test("numero lido do texto: virgula no fim e digitacao em andamento, nao erro", () => {
  assert.equal(numeroDoTexto("33,33", 2), 33.33);
  assert.equal(numeroDoTexto("15", 2), 15);
  assert.equal(numeroDoTexto("12,", 2), 12);
  assert.equal(numeroDoTexto(",5", 2), 0.5);
  assert.equal(numeroDoTexto("", 2), null);
  assert.equal(numeroDoTexto(",", 2), null);
  assert.equal(numeroDoTexto("1,234", 2), null);
});

test("numero mostrado sem zero sobrando e com virgula decimal", () => {
  assert.equal(textoDeNumero(30, 2), "30");
  assert.equal(textoDeNumero(33.33, 2), "33,33");
  assert.equal(textoDeNumero(12.5, 2), "12,5");
  assert.equal(textoDeNumero(7.9, 0), "7");
  assert.equal(textoDeNumero(Number.NaN, 2), "");
});

test("limitar prende so nos limites informados", () => {
  assert.equal(limitar(150, 0, 100), 100);
  assert.equal(limitar(-1, 0, 100), 0);
  assert.equal(limitar(5), 5);
  assert.equal(limitar(5, undefined, 3), 3);
});
