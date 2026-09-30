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

test("precos dos adicionais conforme a arte, em centavos", () => {
  const valor = (t: (typeof TEMPLATES)[number], id: string) => adicionalDoCatalogo(t, id)?.valor;
  assert.equal(valor("casamento", "casamento.hora_adicional"), 35000);
  assert.equal(valor("casamento", "casamento.reels"), 30000);
  assert.equal(valor("casamento", "casamento.making_of_noiva"), 38000);
  assert.equal(valor("casamento", "casamento.making_of_noivo"), 38000);
  assert.equal(valor("casamento", "casamento.polaroid"), 95000);
  assert.equal(valor("debutante", "debutante.hora_adicional"), 20000);
  assert.equal(valor("debutante", "debutante.trend"), 15000);
  assert.equal(valor("debutante", "debutante.storymaker"), 50000);
  assert.equal(valor("aniversario_infantil", "aniversario_infantil.hora_adicional"), 30000);
  assert.equal(valor("aniversario_infantil", "aniversario_infantil.trend"), 18000);
  assert.equal(valor("aniversario_infantil", "aniversario_infantil.storymaker"), 10000);
  assert.equal(valor("aniversario_adulto", "aniversario_adulto.hora_adicional"), 35000);
  assert.equal(valor("aniversario_adulto", "aniversario_adulto.reels"), 30000);
  assert.equal(valor("aniversario_adulto", "aniversario_adulto.polaroid"), null, "sob consulta na arte");
  assert.equal(valor("corporativo", "corporativo.hora_adicional"), 35000);
  assert.equal(valor("corporativo", "corporativo.trend"), 25000);
  assert.equal(valor("corporativo", "corporativo.reels"), 33000);
  assert.equal(valor("corporativo", "locomocao"), null);
});

test("entrega em tempo real do adulto tem preco por pacote, e so para pacotes que existem", () => {
  const item = adicionalDoCatalogo("aniversario_adulto", "aniversario_adulto.tempo_real")!;
  assert.equal(valorCatalogoAdicional(item, "Pacote Pocket"), 40000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Premium"), 50000);
  assert.equal(valorCatalogoAdicional(item, "Pacote Luxo"), 60000);
  assert.equal(valorCatalogoAdicional(item, PACOTE_PERSONALIZADO), null);
  const nomes = PACOTES["2026"].aniversario_adulto.map((p) => p.nome);
  for (const pacote of Object.keys(item.valorPorPacote ?? {})) assert.ok(nomes.includes(pacote), pacote);
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
  const noiva = novoAdicional(adicionalDoCatalogo("casamento", "casamento.making_of_noiva")!, "Pacote Principal");
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
  assert.equal(novoAdicional(tempoReal, "Pacote Premium").valorUnitario, 50000);
  assert.equal(novoAdicional(tempoReal, PACOTE_PERSONALIZADO).valorUnitario, 0, "sem preco: a Mel digita");
  assert.equal(novoAdicional(ADICIONAL_LOCOMOCAO, "Pacote Premium").valorUnitario, 0);
});

test("adicional livre ganha id 'livre-<n>' sem reusar numero", () => {
  assert.equal(proximoIdLivre([]), "livre-1");
  assert.equal(proximoIdLivre([{ id: "livre-1" }, { id: "casamento.reels" }, { id: "livre-4" }]), "livre-5");
  const livre = novoAdicional(ADICIONAL_LIVRE, "Pacote Principal", [{ id: "livre-1" }]);
  assert.equal(livre.id, "livre-2");
  assert.equal(livre.tipo, "outro");
  assert.equal(livre.descricao, "");
});

test("o catalogo devolvido e copia: editar o escopo no painel nao altera o catalogo", () => {
  const primeiro = catalogoDaArte("debutante");
  primeiro.pacotes[2].escopo.reels.push("inventado");
  primeiro.pacotes[2].escopo.minutosCobertura = 1;
  primeiro.adicionais[0].valor = 1;
  const segundo = catalogoDaArte("debutante");
  assert.deepEqual(segundo.pacotes[2].escopo.reels, ["do ensaio fotográfico", "do making of", "resumo do evento"]);
  assert.equal(segundo.pacotes[2].escopo.minutosCobertura, 300);
  assert.equal(segundo.adicionais[0].valor, 20000);

  const pacote = pacoteDoCatalogo("casamento", "Pacote Principal")!;
  pacote.escopo.extras.push("x");
  assert.deepEqual(pacoteDoCatalogo("casamento", "Pacote Principal")!.escopo.extras, []);
});
