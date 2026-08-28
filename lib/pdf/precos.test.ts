import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMPLATES } from "@/lib/form/types";
import {
  PACOTES,
  TABELAS_PRECO,
  TABELA_BASE,
  anoDoEvento,
  resolverTabelaPreco,
} from "./precos";

/**
 * O que estes testes protegem: o lead de um evento de 2027 nao pode receber
 * proposta com o preco de 2026. Como o preco esta desenhado na arte, o unico
 * ponto onde isso pode dar errado no codigo e a escolha da tabela -- e ela sai
 * de uma string de data, sem passar por `Date`.
 */

test("ano do evento sai da string, sem fuso", () => {
  assert.equal(anoDoEvento("2026-08-31"), 2026);
  assert.equal(anoDoEvento("2027-01-01"), 2027);
  // Espaco em volta acontece com dado colado no painel.
  assert.equal(anoDoEvento("  2027-03-14  "), 2027);
});

test("data que nao e ISO nao vira ano", () => {
  assert.equal(anoDoEvento(""), null);
  assert.equal(anoDoEvento("   "), null);
  assert.equal(anoDoEvento("14/03/2027"), null);
  assert.equal(anoDoEvento("2027-3-14"), null);
  assert.equal(anoDoEvento("2027"), null);
  assert.equal(anoDoEvento("2027-13-01"), null);
  assert.equal(anoDoEvento("2027-00-10"), null);
  assert.equal(anoDoEvento("2027-01-00"), null);
  assert.equal(anoDoEvento("2027-01-32"), null);
});

test("evento em 2026 mantem a tabela de hoje", () => {
  assert.equal(resolverTabelaPreco("2026-01-01"), "2026");
  assert.equal(resolverTabelaPreco("2026-08-31"), "2026");
  assert.equal(resolverTabelaPreco("2026-12-31"), "2026");
});

/**
 * O caso que motivou ler o ano da string: `new Date("2027-01-01")` e meia-noite
 * em UTC, e em America/Sao_Paulo isso ainda e 31/12/2026. Com `getFullYear()`,
 * o primeiro dia da nova tabela cairia na tabela velha.
 */
test("virada do ano: 1º de janeiro de 2027 ja e tabela 2027", () => {
  assert.equal(resolverTabelaPreco("2027-01-01"), "2027");
  assert.equal(resolverTabelaPreco("2026-12-31"), "2026");
});

test("evento depois de 2027 continua na tabela mais nova", () => {
  assert.equal(resolverTabelaPreco("2028-06-10"), "2027");
  assert.equal(resolverTabelaPreco("2031-06-10"), "2027");
});

/** Lead antigo reaberto no painel nao pode ficar sem tabela. */
test("evento anterior a 2026 cai na tabela base", () => {
  assert.equal(resolverTabelaPreco("2024-05-05"), TABELA_BASE);
});

test("data ausente ou torta nao escolhe tabela", () => {
  assert.equal(resolverTabelaPreco(""), null);
  assert.equal(resolverTabelaPreco("amanhã"), null);
  assert.equal(resolverTabelaPreco("31/08/2027"), null);
});

test("toda arte tem pacotes em toda tabela", () => {
  for (const tabela of TABELAS_PRECO) {
    for (const arte of TEMPLATES) {
      const pacotes = PACOTES[tabela][arte];
      assert.ok(pacotes?.length, `${arte} sem pacotes na tabela ${tabela}`);
    }
  }
});

/**
 * A tabela de 2027 e um reajuste da de 2026, entao as duas descrevem os MESMOS
 * pacotes. Nome ou quantidade diferente significa que uma das duas saiu de
 * sincronia com a arte.
 */
test("as tabelas descrevem os mesmos pacotes", () => {
  for (const arte of TEMPLATES) {
    const nomes = TABELAS_PRECO.map((t) => PACOTES[t][arte].map((p) => p.nome).join(" | "));
    assert.equal(new Set(nomes).size, 1, `${arte}: pacotes divergem entre tabelas (${nomes})`);
  }
});

/**
 * Regra aprovada pelo owner em 28/08/2026 para a tabela 2027: no minimo +15%
 * sobre 2026, arredondado para cima ate um numero comercial. Este teste e o
 * registro executavel dessa aprovacao -- se alguem editar um valor, ele diz na
 * hora se o novo numero ainda respeita o reajuste.
 */
test("tabela 2027 aplica pelo menos 15% sobre a de 2026", () => {
  for (const arte of TEMPLATES) {
    const de2026 = PACOTES["2026"][arte];
    const de2027 = PACOTES["2027"][arte];

    for (const [i, pacote] of de2026.entries()) {
      const novo = de2027[i];
      assert.equal(novo.nome, pacote.nome, `${arte}: pacotes fora de ordem entre tabelas`);
      assert.ok(
        novo.valor >= pacote.valor * 1.15,
        `${arte} / ${pacote.nome}: ${novo.valor} e menos que 15% sobre ${pacote.valor}`,
      );
    }
  }
});

/** "Nada quebrado": o owner pediu numero redondo, e a arte so mostra inteiros. */
test("todo valor e multiplo de 10", () => {
  for (const tabela of TABELAS_PRECO) {
    for (const arte of TEMPLATES) {
      for (const { nome, valor } of PACOTES[tabela][arte]) {
        assert.equal(valor % 10, 0, `${tabela} / ${arte} / ${nome}: ${valor} nao e redondo`);
      }
    }
  }
});

/** A escada de pacotes de uma arte sobe: Basico < Premium < Luxo. */
test("os pacotes de cada arte sobem de preco", () => {
  for (const tabela of TABELAS_PRECO) {
    for (const arte of TEMPLATES) {
      const valores = PACOTES[tabela][arte].map((p) => p.valor);
      for (let i = 1; i < valores.length; i++) {
        assert.ok(
          valores[i] > valores[i - 1],
          `${tabela} / ${arte}: ${valores[i]} nao e maior que ${valores[i - 1]}`,
        );
      }
    }
  }
});
