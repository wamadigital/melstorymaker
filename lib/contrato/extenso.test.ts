import assert from "node:assert/strict";
import { test } from "node:test";
import {
  centesimosDePercentual,
  duracaoCurta,
  duracaoPorExtenso,
  formatarInteiro,
  formatarPercentual,
  formatarReais,
  numeroPorExtenso,
  percentualComExtenso,
  quantidadeComExtenso,
  reaisPorExtenso,
  segundosPorExtenso,
  valorComExtenso,
} from "./extenso";

/**
 * O extenso era onde o contrato feito a mao mais errava. Cada linha desta
 * tabela foi conferida a mao, uma por uma -- e inclui TODOS os valores que
 * apareceram nos contratos antigos, porque sao os que vao voltar a aparecer.
 * Valores em REAIS aqui so para ler facil; a funcao recebe centavos.
 */
const VALORES_DOS_CONTRATOS_ANTIGOS: [reais: number, extenso: string][] = [
  [450, "quatrocentos e cinquenta reais"],
  [1050, "mil e cinquenta reais"],
  [1880, "mil oitocentos e oitenta reais"],
  [564, "quinhentos e sessenta e quatro reais"],
  [1316, "mil trezentos e dezesseis reais"],
  [1290, "mil duzentos e noventa reais"],
  [387, "trezentos e oitenta e sete reais"],
  [903, "novecentos e três reais"],
  [2450, "dois mil quatrocentos e cinquenta reais"],
  [367.5, "trezentos e sessenta e sete reais e cinquenta centavos"],
  [1715, "mil setecentos e quinze reais"],
  [2170, "dois mil cento e setenta reais"],
  [651, "seiscentos e cinquenta e um reais"],
  [1519, "mil quinhentos e dezenove reais"],
  [2050, "dois mil e cinquenta reais"],
  [615, "seiscentos e quinze reais"],
  [1435, "mil quatrocentos e trinta e cinco reais"],
  [193.5, "cento e noventa e três reais e cinquenta centavos"],
  [1100, "mil e cem reais"],
  [330, "trezentos e trinta reais"],
  [770, "setecentos e setenta reais"],
  [1110, "mil cento e dez reais"],
  [333, "trezentos e trinta e três reais"],
  [777, "setecentos e setenta e sete reais"],
  [550, "quinhentos e cinquenta reais"],
  [1790, "mil setecentos e noventa reais"],
  [537, "quinhentos e trinta e sete reais"],
  [1253, "mil duzentos e cinquenta e três reais"],
  [1670, "mil seiscentos e setenta reais"],
  [501, "quinhentos e um reais"],
  [1169, "mil cento e sessenta e nove reais"],
  [990, "novecentos e noventa reais"],
  [297, "duzentos e noventa e sete reais"],
  [693, "seiscentos e noventa e três reais"],
  [380, "trezentos e oitenta reais"],
];

test("todos os valores dos contratos antigos saem por extenso corretos", () => {
  for (const [reais, extenso] of VALORES_DOS_CONTRATOS_ANTIGOS) {
    const centavos = Math.round(reais * 100);
    assert.equal(reaisPorExtenso(centavos), extenso, `R$ ${reais}`);
  }
});

test("valor com extenso junta o numero formatado e o extenso entre parenteses", () => {
  assert.equal(valorComExtenso(150000), "R$ 1.500,00 (mil e quinhentos reais)");
  assert.equal(valorComExtenso(36750), "R$ 367,50 (trezentos e sessenta e sete reais e cinquenta centavos)");
  assert.equal(valorComExtenso(245000), "R$ 2.450,00 (dois mil quatrocentos e cinquenta reais)");
  assert.equal(valorComExtenso(19350), "R$ 193,50 (cento e noventa e três reais e cinquenta centavos)");
});

test("bordas do numero por extenso", () => {
  const casos: [number, string][] = [
    [0, "zero"],
    [1, "um"],
    [2, "dois"],
    [10, "dez"],
    [11, "onze"],
    [14, "quatorze"],
    [16, "dezesseis"],
    [19, "dezenove"],
    [20, "vinte"],
    [21, "vinte e um"],
    [99, "noventa e nove"],
    [100, "cem"],
    [101, "cento e um"],
    [110, "cento e dez"],
    [200, "duzentos"],
    [999, "novecentos e noventa e nove"],
    [1000, "mil"],
    [1001, "mil e um"],
    [1010, "mil e dez"],
    [1099, "mil e noventa e nove"],
    [1100, "mil e cem"],
    [1101, "mil cento e um"],
    [1500, "mil e quinhentos"],
    [2000, "dois mil"],
    [10000, "dez mil"],
    [21000, "vinte e um mil"],
    [100000, "cem mil"],
    [101000, "cento e um mil"],
    [999999, "novecentos e noventa e nove mil novecentos e noventa e nove"],
    [1000000, "um milhão"],
    [1000001, "um milhão e um"],
    [1200000, "um milhão e duzentos mil"],
    [1250000, "um milhão duzentos e cinquenta mil"],
    [1110500, "um milhão cento e dez mil e quinhentos"],
    [2000000, "dois milhões"],
    [2000500, "dois milhões e quinhentos"],
    [2500000, "dois milhões e quinhentos mil"],
    [
      999999999,
      "novecentos e noventa e nove milhões novecentos e noventa e nove mil novecentos e noventa e nove",
    ],
  ];
  for (const [n, extenso] of casos) assert.equal(numeroPorExtenso(n), extenso, String(n));
});

test("mil nunca leva 'um' na frente", () => {
  assert.equal(numeroPorExtenso(1000), "mil");
  assert.equal(numeroPorExtenso(1500), "mil e quinhentos");
  assert.doesNotMatch(reaisPorExtenso(150000), /um mil/);
});

test("entre as classes nao ha virgula (o erro do 'dois mil, quatrocentos')", () => {
  for (const [reais] of VALORES_DOS_CONTRATOS_ANTIGOS) {
    assert.doesNotMatch(reaisPorExtenso(Math.round(reais * 100)), /,/);
  }
});

test("genero feminino muda unidades e centenas, inclusive dos milhares", () => {
  assert.equal(numeroPorExtenso(1, "feminino"), "uma");
  assert.equal(numeroPorExtenso(2, "feminino"), "duas");
  assert.equal(numeroPorExtenso(21, "feminino"), "vinte e uma");
  assert.equal(numeroPorExtenso(32, "feminino"), "trinta e duas");
  assert.equal(numeroPorExtenso(200, "feminino"), "duzentas");
  assert.equal(numeroPorExtenso(522, "feminino"), "quinhentas e vinte e duas");
  assert.equal(numeroPorExtenso(2000, "feminino"), "duas mil");
  assert.equal(numeroPorExtenso(201000, "feminino"), "duzentas e uma mil");
  // Invariaveis: "cem", "cento", "doze".
  assert.equal(numeroPorExtenso(100, "feminino"), "cem");
  assert.equal(numeroPorExtenso(112, "feminino"), "cento e doze");
});

test("a classe dos milhoes e sempre masculina, porque concorda com 'milhão'", () => {
  assert.equal(numeroPorExtenso(2000000, "feminino"), "dois milhões");
  assert.equal(numeroPorExtenso(1000000, "feminino"), "um milhão");
  assert.equal(
    numeroPorExtenso(222222222, "feminino"),
    "duzentos e vinte e dois milhões duzentas e vinte e duas mil duzentas e vinte e duas",
  );
});

test("reais: singular, centavos soltos e o 'de' do milhao exato", () => {
  assert.equal(reaisPorExtenso(0), "zero reais");
  assert.equal(reaisPorExtenso(1), "um centavo");
  assert.equal(reaisPorExtenso(50), "cinquenta centavos");
  assert.equal(reaisPorExtenso(100), "um real");
  assert.equal(reaisPorExtenso(101), "um real e um centavo");
  assert.equal(reaisPorExtenso(200), "dois reais");
  assert.equal(reaisPorExtenso(10000), "cem reais");
  assert.equal(reaisPorExtenso(10100), "cento e um reais");
  assert.equal(reaisPorExtenso(100000), "mil reais");
  assert.equal(reaisPorExtenso(100100), "mil e um reais");
  assert.equal(reaisPorExtenso(110000), "mil e cem reais");
  assert.equal(reaisPorExtenso(1000000), "dez mil reais");
  assert.equal(reaisPorExtenso(10000000), "cem mil reais");
  assert.equal(reaisPorExtenso(100000000), "um milhão de reais");
  assert.equal(reaisPorExtenso(100000050), "um milhão de reais e cinquenta centavos");
  assert.equal(reaisPorExtenso(200000000), "dois milhões de reais");
  assert.equal(reaisPorExtenso(200050000), "dois milhões e quinhentos reais");
  assert.equal(reaisPorExtenso(250000000), "dois milhões e quinhentos mil reais");
  assert.equal(reaisPorExtenso(100000100), "um milhão e um reais");
});

test("formatacao em R$ com milhar e centavos, espaco normal depois do cifrao", () => {
  assert.equal(formatarReais(0), "R$ 0,00");
  assert.equal(formatarReais(5), "R$ 0,05");
  assert.equal(formatarReais(150000), "R$ 1.500,00");
  assert.equal(formatarReais(36750), "R$ 367,50");
  assert.equal(formatarReais(100000000), "R$ 1.000.000,00");
  assert.equal(formatarReais(-5000), "-R$ 50,00");
  assert.ok(!formatarReais(150000).includes(String.fromCodePoint(0xa0)), "sem NBSP");
  assert.equal(formatarInteiro(1234567), "1.234.567");
});

test("dinheiro em float e recusado: centavo e sempre inteiro", () => {
  assert.throws(() => formatarReais(1500.5), RangeError);
  assert.throws(() => reaisPorExtenso(10.5), RangeError);
  assert.throws(() => reaisPorExtenso(-100), RangeError);
  assert.throws(() => numeroPorExtenso(-1), RangeError);
  assert.throws(() => numeroPorExtenso(1_000_000_000), RangeError);
  assert.throws(() => numeroPorExtenso(1.5), RangeError);
});

test("percentual com extenso, inteiro e com casas decimais", () => {
  assert.equal(percentualComExtenso(30), "30% (trinta por cento)");
  assert.equal(percentualComExtenso(15), "15% (quinze por cento)");
  assert.equal(percentualComExtenso(70), "70% (setenta por cento)");
  assert.equal(percentualComExtenso(100), "100% (cem por cento)");
  assert.equal(percentualComExtenso(1), "1% (um por cento)");
  assert.equal(percentualComExtenso(21), "21% (vinte e um por cento)");
  assert.equal(
    percentualComExtenso(33.33),
    "33,33% (trinta e três inteiros e trinta e três centésimos por cento)",
  );
  assert.equal(
    percentualComExtenso(33.34),
    "33,34% (trinta e três inteiros e trinta e quatro centésimos por cento)",
  );
  assert.equal(percentualComExtenso(12.5), "12,5% (doze inteiros e cinco décimos por cento)");
  assert.equal(percentualComExtenso(1.01), "1,01% (um inteiro e um centésimo por cento)");
  assert.equal(percentualComExtenso(0.5), "0,5% (cinco décimos por cento)");
  assert.equal(percentualComExtenso(2.1), "2,1% (dois inteiros e um décimo por cento)");
});

test("percentual arredonda half-up na segunda casa, sem ruido de float", () => {
  assert.equal(centesimosDePercentual(33.33), 3333);
  assert.equal(centesimosDePercentual(0.285), 29);
  assert.equal(centesimosDePercentual(12.345), 1235);
  assert.equal(formatarPercentual(30), "30%");
  assert.equal(formatarPercentual(12.5), "12,5%");
  assert.equal(formatarPercentual(12.05), "12,05%");
  assert.equal(formatarPercentual(99.999), "100%");
});

test("quantidade com extenso respeita o genero do substantivo", () => {
  assert.equal(quantidadeComExtenso(5), "5 (cinco)");
  assert.equal(quantidadeComExtenso(1), "1 (um)");
  assert.equal(quantidadeComExtenso(1, "feminino"), "1 (uma)");
  assert.equal(quantidadeComExtenso(2, "feminino"), "2 (duas)");
  assert.equal(quantidadeComExtenso(10), "10 (dez)");
  assert.equal(quantidadeComExtenso(1000), "1.000 (mil)");
});

test("duracao por extenso: hora e feminino, minuto e masculino", () => {
  assert.equal(duracaoPorExtenso(300), "5 (cinco) horas");
  assert.equal(duracaoPorExtenso(60), "1 (uma) hora");
  assert.equal(duracaoPorExtenso(90), "1 (uma) hora e 30 (trinta) minutos");
  assert.equal(duracaoPorExtenso(30), "30 (trinta) minutos");
  assert.equal(duracaoPorExtenso(150), "2 (duas) horas e 30 (trinta) minutos");
  assert.equal(duracaoPorExtenso(120), "2 (duas) horas");
  assert.equal(duracaoPorExtenso(420), "7 (sete) horas");
  assert.equal(duracaoPorExtenso(61), "1 (uma) hora e 1 (um) minuto");
  assert.equal(duracaoPorExtenso(1), "1 (um) minuto");
  assert.equal(duracaoPorExtenso(1260), "21 (vinte e uma) horas");
  assert.equal(duracaoPorExtenso(0), "0 (zero) minutos");
});

test("duracao curta para o detalhamento do tempo de servico", () => {
  assert.equal(duracaoCurta(300), "5h");
  assert.equal(duracaoCurta(90), "1h30");
  assert.equal(duracaoCurta(65), "1h05");
  assert.equal(duracaoCurta(30), "30min");
  assert.equal(duracaoCurta(120), "2h");
  assert.equal(duracaoCurta(0), "0min");
});

test("segundos por extenso para a duracao dos Reels", () => {
  assert.equal(segundosPorExtenso(90), "1 (um) minuto e 30 (trinta) segundos");
  assert.equal(segundosPorExtenso(60), "1 (um) minuto");
  assert.equal(segundosPorExtenso(45), "45 (quarenta e cinco) segundos");
  assert.equal(segundosPorExtenso(120), "2 (dois) minutos");
  assert.equal(segundosPorExtenso(1), "1 (um) segundo");
  assert.equal(segundosPorExtenso(61), "1 (um) minuto e 1 (um) segundo");
  assert.equal(segundosPorExtenso(0), "0 (zero) segundos");
});

test("duracao negativa ou fracionada e erro de programacao, nao texto", () => {
  assert.throws(() => duracaoPorExtenso(-1), RangeError);
  assert.throws(() => duracaoPorExtenso(1.5), RangeError);
  assert.throws(() => segundosPorExtenso(-1), RangeError);
});
