import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { TEMPLATES } from "@/lib/form/types";
import {
  PACOTES,
  TABELAS_EM_VIGENCIA,
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

/**
 * Mesma fronteira da 2027, um ano adiante. Fuso horario e o unico jeito de
 * errar aqui, e ele erra exatamente no dia em que a tabela vira.
 */
test("virada do ano: 1º de janeiro de 2028 já é tabela 2028", () => {
  assert.equal(resolverTabelaPreco("2028-01-01"), "2028");
  assert.equal(resolverTabelaPreco("2027-12-31"), "2027");
});

test("evento depois da última tabela em vigência continua na mais nova delas", () => {
  const maisNova = TABELAS_EM_VIGENCIA[TABELAS_EM_VIGENCIA.length - 1];
  assert.equal(resolverTabelaPreco("2031-06-10"), maisNova);
  assert.equal(resolverTabelaPreco("2099-06-10"), maisNova);
});

/**
 * Vigencia e arte andam JUNTAS. Este e o teste que fecha a porta: ligar a
 * vigencia de uma tabela sem publicar as cinco artes dela fica vermelho na
 * hora, em vez de so aparecer quando a Mel tentar gerar a primeira proposta do
 * ano. O caminho inverso (arte publicada, vigencia ainda desligada) continua
 * verde, que e o estado intermediario legitimo.
 */
test("toda tabela em vigência tem as 5 artes publicadas", () => {
  const pasta = path.join(process.cwd(), "assets", "templates");
  for (const tabela of TABELAS_EM_VIGENCIA) {
    for (const arte of TEMPLATES) {
      const arquivo = path.join(pasta, `${arte}.${tabela}.pdf`);
      assert.ok(
        fs.existsSync(arquivo),
        `tabela ${tabela} está em vigência mas falta assets/templates/${arte}.${tabela}.pdf`,
      );
    }
  }
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
test("todo valor de pacote é múltiplo de 10", () => {
  for (const tabela of TABELAS_PRECO) {
    for (const arte of TEMPLATES) {
      for (const { nome, valor } of PACOTES[tabela][arte]) {
        assert.equal(valor % 10, 0, `${tabela} / ${arte} / ${nome}: ${valor} não é redondo`);
      }
    }
  }
});

/**
 * A grade 50/90 vale para tabela que NASCEU DE REAJUSTE, nao para a base.
 *
 * A 2026 foi precificada a mao pela Mel e tem 1100, 1500, 1480 e 1870 -- nenhum
 * deles na grade, e nao ha nada de errado nisso. A grade descreve como um
 * reajuste ARREDONDA, e por isso so se aplica de 2027 em diante. Exigi-la da
 * base seria inventar uma regra que o owner nunca seguiu.
 */
test("tabela nascida de reajuste cai na grade comercial (50 ou 90)", () => {
  const derivadas = TABELAS_PRECO.filter((t) => t !== TABELA_BASE);
  assert.ok(derivadas.length >= 2, "esperava ao menos 2027 e 2028");

  for (const tabela of derivadas) {
    for (const arte of TEMPLATES) {
      for (const { nome, valor } of PACOTES[tabela][arte]) {
        const fim = valor % 100;
        assert.ok(
          fim === 50 || fim === 90,
          `${tabela} / ${arte} / ${nome}: ${valor} não está na grade 50/90`,
        );
      }
    }
  }
});

/**
 * O reajuste de cada tabela, como regra executavel.
 *
 * `proximoComercial` E a regra do owner: sobe ate o proximo numero terminado em
 * 50 ou 90. Que ela seja mesmo a regra usada nao e suposicao -- a travessia
 * 2026 -> 2027 abaixo reproduz os catorze valores daquela tabela, aprovados em
 * 28/08/2026, e so depois disso ela e aplicada a 2028.
 *
 * Sem este teste, um digito trocado passa em silencio: as assercoes genericas
 * deixam passar ate um preco de 2028 MENOR que o de 2027 (2750 -> 2250 no
 * debutante Luxo), que e a mesma classe de erro que o gotcha 6e existe para
 * impedir -- proposta enviada com preco defasado sem ninguem perceber.
 */
const REAJUSTES: { de: (typeof TABELAS_PRECO)[number]; para: (typeof TABELAS_PRECO)[number]; fator: number; quando: string }[] = [
  { de: "2026", para: "2027", fator: 1.15, quando: "aprovado em 28/08/2026" },
  { de: "2027", para: "2028", fator: 1.2, quando: "aprovado em 30/09/2026" },
];

function proximoComercial(alvo: number): number {
  let n = Math.ceil(alvo / 10) * 10;
  for (;;) {
    const fim = n % 100;
    if (fim === 50 || fim === 90) return n;
    n += 10;
  }
}

test("cada tabela é o reajuste da anterior na grade comercial", () => {
  let conferidos = 0;
  for (const { de, para, fator, quando } of REAJUSTES) {
    for (const arte of TEMPLATES) {
      const anterior = PACOTES[de][arte];
      const nova = PACOTES[para][arte];
      assert.equal(nova.length, anterior.length, `${arte}: ${de} e ${para} têm pacotes diferentes`);

      for (const [i, pacote] of anterior.entries()) {
        assert.equal(nova[i].nome, pacote.nome, `${arte}: pacotes fora de ordem entre tabelas`);
        assert.equal(
          nova[i].valor,
          proximoComercial(pacote.valor * fator),
          `${arte} / ${pacote.nome}: ${de} ${pacote.valor} → ${para} ${nova[i].valor} não é o reajuste ${quando}`,
        );
        conferidos++;
      }
    }
  }
  // Numero exato: o teste nao pode passar vazio se uma tabela sumir do meio.
  assert.equal(conferidos, 28, "mudou a quantidade de pacotes × reajustes");
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
