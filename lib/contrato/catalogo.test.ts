import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMPLATES } from "@/lib/form/types";
import { PACOTES, TABELAS_PRECO } from "@/lib/pdf/precos";
import { adicionalSchema, escopoSchema } from "./tipos";
import {
  ADICIONAL_LIVRE,
  ADICIONAL_LOCOMOCAO,
  PACOTE_PERSONALIZADO,
  adicionalDoCatalogo,
  adicionalPorId,
  catalogoDaArte,
  novoAdicional,
  pacoteDoCatalogo,
  itensArteDaTabela,
  precoPacote,
  proximoIdLivre,
  valorCatalogoAdicional,
} from "./catalogo";

/**
 * O catalogo so pre-preenche, mas pre-preenche o CONTRATO: um pacote com nome
 * diferente do de `PACOTES` sairia sem preco, e um escopo errado sairia
 * prometendo horas que a arte nao vendeu. Estes testes amarram o catalogo a
 * especificacao de preco e a arte.
 */

test("todo pacote do catalogo existe em PACOTES nas duas tabelas, e vice-versa, na mesma ordem", () => {
  for (const t of TEMPLATES) {
    const doCatalogo = catalogoDaArte(t)
      .pacotes.map((p) => p.nome)
      .filter((n) => n !== PACOTE_PERSONALIZADO);
    for (const tabela of TABELAS_PRECO) {
      assert.deepEqual(doCatalogo, PACOTES[tabela][t].map((p) => p.nome), `${t} na tabela ${tabela}`);
    }
  }
});

test("preco do pacote vem de PACOTES em centavos, sem numero duplicado", () => {
  for (const tabela of TABELAS_PRECO) {
    for (const t of TEMPLATES) {
      for (const p of PACOTES[tabela][t]) {
        assert.equal(precoPacote(t, tabela, p.nome), p.valor * 100, `${t} ${p.nome} ${tabela}`);
      }
    }
  }
  assert.equal(precoPacote("casamento", "2026", "Pacote Principal"), 129000);
  assert.equal(precoPacote("casamento", "2027", "Pacote Principal"), 149000);
  assert.equal(precoPacote("corporativo", "2026", "Pacote Pocket"), 79000);
});

test("pacote personalizado ou desconhecido nao tem preco de tabela (null, nao zero)", () => {
  for (const t of TEMPLATES) assert.equal(precoPacote(t, "2026", PACOTE_PERSONALIZADO), null);
  assert.equal(precoPacote("casamento", "2026", "Pacote Luxo"), null, "o casamento nao tem Luxo");
  assert.equal(precoPacote("debutante", "2026", ""), null);
});

test("toda arte oferece o pacote personalizado por ultimo, sem bullets de arte", () => {
  for (const t of TEMPLATES) {
    const pacotes = catalogoDaArte(t).pacotes;
    const ultimo = pacotes[pacotes.length - 1];
    assert.equal(ultimo.nome, PACOTE_PERSONALIZADO, t);
    assert.deepEqual(ultimo.itensArte, []);
    assert.equal(ultimo.escopo.minutosCobertura, 300);
    assert.deepEqual(ultimo.escopo.reels, ["resumo do evento"]);
  }
});

test("todo escopo do catalogo e valido pelo schema e tem cobertura e prazos", () => {
  for (const t of TEMPLATES) {
    for (const p of catalogoDaArte(t).pacotes) {
      assert.deepEqual(escopoSchema.parse(p.escopo), p.escopo, `${t} ${p.nome}`);
      assert.ok(p.escopo.minutosCobertura > 0, `${t} ${p.nome} sem cobertura`);
      assert.ok(p.escopo.reels.length >= 1, `${t} ${p.nome} sem Reels`);
      assert.equal(p.escopo.segundosReels, 90);
      assert.ok(p.escopo.stories);
    }
  }
});

/** As horas do escopo precisam somar o que a arte anuncia ("9H DE COBERTURA"). */
test("escopo bate com as horas desenhadas na arte", () => {
  const horas = (t: (typeof TEMPLATES)[number], nome: string) => {
    const e = pacoteDoCatalogo(t, nome)!.escopo;
    return (e.minutosCobertura + e.minutosMakingOf + e.minutosEnsaio) / 60;
  };
  assert.equal(horas("debutante", "Pacote Básico"), 5);
  assert.equal(horas("debutante", "Pacote Premium"), 7);
  assert.equal(horas("debutante", "Pacote Luxo"), 9);
  assert.equal(horas("aniversario_infantil", "Pacote Básico"), 4);
  assert.equal(horas("aniversario_infantil", "Pacote Premium"), 5);
  assert.equal(horas("aniversario_infantil", "Pacote Luxo"), 6);
  assert.equal(horas("aniversario_adulto", "Pacote Pocket"), 4);
  assert.equal(horas("aniversario_adulto", "Pacote Luxo"), 6.5, "5h + 1h30min de making of");
  assert.equal(horas("corporativo", "Pacote Pocket"), 2);
  assert.equal(horas("corporativo", "Pacote Luxo"), 7);
  assert.equal(horas("casamento", "Pacote Principal"), 5);
});

test("tempo real: o Real Time do casamento (com 2 storymakers) e os tres pacotes do corporativo (com 1)", () => {
  for (const t of TEMPLATES) {
    for (const p of catalogoDaArte(t).pacotes) {
      const realTime = t === "casamento" && p.nome === "Pacote Real Time";
      // A arte do corporativo promete stories concluidos em horas, sem o
      // asterisco de "caso a cobertura seja em tempo real" das outras.
      const corporativo = t === "corporativo" && p.nome !== PACOTE_PERSONALIZADO;
      assert.equal(p.escopo.tempoReal, realTime || corporativo, `${t} ${p.nome}`);
      assert.equal(p.escopo.storymakers, realTime ? 2 : 1, `${t} ${p.nome}`);
    }
  }
});

test("adicional por id em qualquer arte: a unidade e do item vendido, nao da arte atual", () => {
  assert.equal(adicionalPorId("aniversario_infantil.storymaker")?.unidade, "hora");
  assert.equal(adicionalPorId("debutante.storymaker")?.unidade, null);
  assert.equal(adicionalPorId("locomocao")?.tipo, "locomocao");
  assert.equal(adicionalPorId("livre-3")?.tipo, "outro");
  assert.equal(adicionalPorId("nao.existe"), null);
});

test("todo adicional tem nome e descricao para o contrato (exceto o 'outro', que a Mel escreve)", () => {
  for (const t of TEMPLATES) {
    const { adicionais } = catalogoDaArte(t);
    for (const a of adicionais) {
      assert.ok(a.nome.trim(), `${t} ${a.id} sem nome`);
      if (a.tipo === "outro") assert.equal(a.descricaoContrato, "", "o livre nasce vazio para a montagem acusar");
      else assert.ok(a.descricaoContrato.trim(), `${t} ${a.id} sem descrição`);
    }
  }
});

test("ids de adicional sao unicos na arte e levam o prefixo da arte (menos os comuns)", () => {
  for (const t of TEMPLATES) {
    const { adicionais } = catalogoDaArte(t);
    const ids = adicionais.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, t);
    for (const a of adicionais) {
      if (a.id === ADICIONAL_LOCOMOCAO.id || a.id === ADICIONAL_LIVRE.id) continue;
      assert.ok(a.id.startsWith(`${t}.`), a.id);
    }
    assert.ok(ids.includes("locomocao") && ids.includes("livre"), `${t} sem os adicionais comuns`);
  }
});

/**
 * Precos dos adicionais em CENTAVOS, como estao na pagina de Opcionais de cada
 * arte: o que vale ate a tabela 2027 e o que passou a valer na de 2028.
 *
 * As duas colunas existem por causa de uma armadilha concreta: o catalogo
 * pre-preenche contrato de QUALQUER ano, inclusive um de 2026 que a Mel reabra
 * hoje. Se o reajuste de 2028 fosse escrito por cima do valor antigo, ele
 * retroagiria sobre proposta ja aceita -- e ninguem veria, porque o numero
 * simplesmente apareceria diferente no painel.
 */
const PRECOS_ADICIONAIS: [(typeof TEMPLATES)[number], string, number | null, number | null][] = [
  ["casamento", "casamento.hora_adicional", 35000, 45000],
  ["casamento", "casamento.reels", 30000, 40000],
  ["casamento", "casamento.making_of_noiva", 38000, 50000],
  ["casamento", "casamento.making_of_noivo", 38000, 50000],
  ["casamento", "casamento.polaroid", 95000, 115000],
  ["debutante", "debutante.hora_adicional", 20000, 25000],
  ["debutante", "debutante.trend", 15000, 20000],
  ["debutante", "debutante.storymaker", 50000, 60000],
  ["aniversario_infantil", "aniversario_infantil.hora_adicional", 30000, 40000],
  ["aniversario_infantil", "aniversario_infantil.trend", 18000, 25000],
  ["aniversario_infantil", "aniversario_infantil.storymaker", 10000, 15000],
  ["aniversario_adulto", "aniversario_adulto.hora_adicional", 35000, 45000],
  ["aniversario_adulto", "aniversario_adulto.reels", 30000, 40000],
  ["aniversario_adulto", "aniversario_adulto.polaroid", null, null],
  ["corporativo", "corporativo.hora_adicional", 35000, 45000],
  ["corporativo", "corporativo.trend", 25000, 30000],
  ["corporativo", "corporativo.reels", 33000, 40000],
];

test("precos dos adicionais conforme a arte, em centavos, tabela a tabela", () => {
  for (const [t, id, ate2027, de2028] of PRECOS_ADICIONAIS) {
    const a = adicionalDoCatalogo(t, id);
    assert.ok(a, `${t} / ${id} sumiu do catálogo`);
    assert.equal(a.valor["2026"], ate2027, `${id} na tabela 2026`);
    assert.equal(a.valor["2027"], ate2027, `${id} na tabela 2027`);
    assert.equal(a.valor["2028"], de2028, `${id} na tabela 2028`);
  }
  assert.equal(adicionalDoCatalogo("corporativo", "locomocao")?.valor["2028"], null);
});

/**
 * O reajuste de 2028 NAO pode retroagir. Este e o teste que pega alguem
 * "atualizando o preco" no lugar, em vez de acrescentar a coluna da tabela nova.
 */
test("o reajuste de 2028 nao mexeu nas tabelas 2026 e 2027", () => {
  for (const t of TEMPLATES) {
    for (const a of catalogoDaArte(t).adicionais) {
      assert.equal(a.valor["2026"], a.valor["2027"], `${a.id}: 2027 nunca reajustou opcional`);
      for (const [pacote, porTab] of Object.entries(a.valorPorPacote ?? {})) {
        assert.equal(porTab["2026"], porTab["2027"], `${a.id} / ${pacote}`);
      }
    }
  }
});

/**
 * Regra aprovada pelo owner em 30/09/2026: +20% sobre 2027, arredondado para
 * CIMA ate o proximo multiplo de R$ 50. Grade propria, diferente da dos pacotes
 * (50 ou 90) -- aplicada a valor de 2 ou 3 digitos, a dos pacotes distorceria
 * demais. Este teste e o registro executavel da aprovacao: valor digitado
 * errado e pego aqui, e nao na arte, onde preco e pixel e nenhum teste le.
 */
test("tabela 2028: +20% sobre a de 2027, teto no proximo multiplo de R$ 50", () => {
  const grade = (centavos: number) => Math.ceil((centavos * 1.2) / 5000) * 5000;
  let conferidos = 0;

  for (const t of TEMPLATES) {
    for (const a of catalogoDaArte(t).adicionais) {
      const de2027 = a.valor["2027"];
      if (de2027 !== null) {
        assert.equal(a.valor["2028"], grade(de2027), `${a.id}`);
        conferidos++;
      } else {
        assert.equal(a.valor["2028"], null, `${a.id} sem preço na arte continua sem preço`);
      }
      for (const [pacote, porTab] of Object.entries(a.valorPorPacote ?? {})) {
        const base = porTab["2027"];
        if (base === null) continue;
        assert.equal(porTab["2028"], grade(base), `${a.id} / ${pacote}`);
        conferidos++;
      }
    }
  }
  // Numero EXATO, e nao um minimo: 16 adicionais com preco na arte mais os 3
  // do tempo real por pacote. Assim o teste tambem acusa preco que sumiu do
  // catalogo -- que, sem isto, o faria passar em silencio, conferindo menos.
  assert.equal(conferidos, 19, "mudou a quantidade de preços no catálogo");
});

test("entrega em tempo real do adulto tem preco por pacote, e so para pacotes que existem", () => {
  const item = adicionalDoCatalogo("aniversario_adulto", "aniversario_adulto.tempo_real")!;
  assert.equal(valorCatalogoAdicional(item, "Pacote Pocket", "2027"), 40000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Premium", "2027"), 50000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Luxo", "2027"), 60000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Pocket", "2028"), 50000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Premium", "2028"), 60000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Luxo", "2028"), 75000);
  assert.equal(valorCatalogoAdicional(item, PACOTE_PERSONALIZADO, "2027"), null);
  assert.equal(valorCatalogoAdicional(item, PACOTE_PERSONALIZADO, "2028"), null);
  const nomes = PACOTES["2026"].aniversario_adulto.map((p) => p.nome);
  for (const pacote of Object.keys(item.valorPorPacote ?? {})) assert.ok(nomes.includes(pacote), pacote);
});

/**
 * O bullet do tempo real (aniversario adulto) cita um preco que muda por
 * tabela, entao ele e montado com marcador e resolvido por `itensArteDaTabela`.
 *
 * Este e o UNICO lugar onde esse texto pode ser provado: `itensArte` nunca
 * chega ao PDF do contrato -- e lido so pelo painel --, entao o
 * `contrato:verificar`, que inspeciona o texto renderizado, nao passa nem perto.
 * Sem este teste, um marcador nao resolvido apareceria literalmente na tela em
 * que a Mel confere "o que o lead leu", e nada acusaria.
 */
test("nenhum bullet da arte vaza marcador, em tabela nenhuma", () => {
  for (const t of TEMPLATES) {
    for (const p of catalogoDaArte(t).pacotes) {
      for (const tabela of TABELAS_PRECO) {
        for (const item of itensArteDaTabela(t, p.nome, tabela)) {
          assert.ok(!item.includes("{") && !item.includes("}"), `${t} / ${p.nome} / ${tabela}: ${item}`);
        }
      }
    }
  }
});

test("o bullet do tempo real mostra o preço da tabela pedida", () => {
  const bullet = (pacote: string, tabela: (typeof TABELAS_PRECO)[number]) =>
    itensArteDaTabela("aniversario_adulto", pacote, tabela).find((i) =>
      i.startsWith("Entrega em tempo real"),
    );

  assert.equal(bullet("Pacote Pocket", "2027"), "Entrega em tempo real: Adicional de R$ 400");
  assert.equal(bullet("Pacote Premium", "2027"), "Entrega em tempo real: Adicional de R$ 500");
  assert.equal(bullet("Pacote Luxo", "2027"), "Entrega em tempo real: Adicional de R$ 600");
  // A tabela 2028 reajustou o tempo real: o texto acompanha, sem ninguem
  // reescrever bullet nenhum.
  assert.equal(bullet("Pacote Pocket", "2028"), "Entrega em tempo real: Adicional de R$ 500");
  assert.equal(bullet("Pacote Premium", "2028"), "Entrega em tempo real: Adicional de R$ 600");
  assert.equal(bullet("Pacote Luxo", "2028"), "Entrega em tempo real: Adicional de R$ 750");
});

test("making of do catalogo tem duracao padrao", () => {
  for (const t of TEMPLATES) {
    for (const a of catalogoDaArte(t).adicionais.filter((x) => x.tipo === "making_of")) {
      assert.ok((a.minutosPadrao ?? 0) > 0, a.id);
    }
  }
});

test("adicional de outra arte nao e encontrado; o livre e encontrado em qualquer arte", () => {
  assert.equal(adicionalDoCatalogo("aniversario_adulto", "aniversario_infantil.storymaker"), null);
  assert.equal(adicionalDoCatalogo("casamento", "inexistente"), null);
  assert.equal(adicionalDoCatalogo("casamento", "livre-3")?.tipo, "outro");
  assert.equal(adicionalDoCatalogo("debutante", "locomocao")?.nome, "Locomoção");
});

test("novo adicional sai pre-preenchido e valido pelo schema", () => {
  const noiva = novoAdicional(
    adicionalDoCatalogo("casamento", "casamento.making_of_noiva")!,
    "Pacote Principal",
    "2027",
  );
  assert.deepEqual(noiva, {
    id: "casamento.making_of_noiva",
    tipo: "making_of",
    descricao: "Making of da noiva",
    quantidade: 1,
    valorUnitario: 38000,
    minutos: 120,
  });
  assert.deepEqual(adicionalSchema.parse(noiva), noiva);

  const tempoReal = adicionalDoCatalogo("aniversario_adulto", "aniversario_adulto.tempo_real")!;
  assert.equal(novoAdicional(tempoReal, "Pacote Premium", "2027").valorUnitario, 50000);
  assert.equal(novoAdicional(tempoReal, "Pacote Premium", "2028").valorUnitario, 60000);
  assert.equal(
    novoAdicional(tempoReal, PACOTE_PERSONALIZADO, "2027").valorUnitario,
    0,
    "sem preco: a Mel digita",
  );
  assert.equal(novoAdicional(ADICIONAL_LOCOMOCAO, "Pacote Premium", "2027").valorUnitario, 0);
});

test("adicional livre ganha id 'livre-<n>' sem reusar numero", () => {
  assert.equal(proximoIdLivre([]), "livre-1");
  assert.equal(proximoIdLivre([{ id: "livre-1" }, { id: "casamento.reels" }, { id: "livre-4" }]), "livre-5");
  const livre = novoAdicional(ADICIONAL_LIVRE, "Pacote Principal", "2027", [{ id: "livre-1" }]);
  assert.equal(livre.id, "livre-2");
  assert.equal(livre.tipo, "outro");
  assert.equal(livre.descricao, "");
});

test("o catalogo devolvido e copia: editar o escopo no painel nao altera o catalogo", () => {
  const primeiro = catalogoDaArte("debutante");
  primeiro.pacotes[2].escopo.reels.push("inventado");
  primeiro.pacotes[2].escopo.minutosCobertura = 1;
  const segundo = catalogoDaArte("debutante");
  assert.deepEqual(segundo.pacotes[2].escopo.reels, ["do ensaio fotográfico", "do making of", "resumo do evento"]);
  assert.equal(segundo.pacotes[2].escopo.minutosCobertura, 300);
  // `valor` e um objeto CONGELADO, compartilhado entre as copias: em vez de
  // copiar a cada chamada ele simplesmente nao aceita edicao -- garantia mais
  // forte, e barata, porque preco de catalogo nunca se edita em memoria.
  try {
    (primeiro.adicionais[0].valor as Record<string, number | null>)["2026"] = 1;
  } catch {
    // Em strict mode congelado lanca em vez de ignorar. As duas saidas servem.
  }
  assert.equal(segundo.adicionais[0].valor["2026"], 20000);

  const pacote = pacoteDoCatalogo("casamento", "Pacote Principal")!;
  pacote.escopo.extras.push("x");
  assert.deepEqual(pacoteDoCatalogo("casamento", "Pacote Principal")!.escopo.extras, []);
});
