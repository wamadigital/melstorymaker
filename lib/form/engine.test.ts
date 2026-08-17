import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dataMinima,
  idsValidos,
  limparRespostasOrfas,
  normalizarOpcoes,
  passosVisiveis,
  progresso,
  proximoPasso,
} from "./engine";
import { mascararTelefone, validarResposta } from "./validacao";
import type { Passo } from "./types";

const ids = (categoria: Parameters<typeof passosVisiveis>[0], r = {}) =>
  passosVisiveis(categoria, r).map((p) => p.id);

test("contato e sempre injetado no fim de todo fluxo", () => {
  for (const cat of ["debutante", "aniversario", "casamento", "corporativo"] as const) {
    const lista = ids(cat);
    assert.deepEqual(lista.slice(-2), ["contato_email", "contato_whatsapp"]);
  }
});

test("making_of = Sim exibe o local do making of", () => {
  const lista = ids("casamento", { making_of: "Sim" });
  assert.ok(lista.includes("local_making_of"));
  // Entra logo depois do making_of e antes da entrega.
  assert.equal(lista.indexOf("local_making_of"), lista.indexOf("making_of") + 1);
  assert.equal(lista.indexOf("entrega"), lista.indexOf("local_making_of") + 1);
});

test("making_of = Nao pula direto para a entrega (RF-05)", () => {
  const lista = ids("debutante", { making_of: "Não" });
  assert.ok(!lista.includes("local_making_of"));
  assert.equal(lista.indexOf("entrega"), lista.indexOf("making_of") + 1);
  assert.equal(proximoPasso("debutante", { making_of: "Não" }, "making_of")?.id, "entrega");
});

test("passo condicional fica escondido enquanto a condicao nao foi respondida", () => {
  assert.ok(!ids("casamento").includes("local_making_of"));
});

test("casamento separa local da cerimonia e local da festa", () => {
  const lista = ids("casamento");
  assert.ok(lista.includes("local_cerimonia"));
  assert.ok(lista.includes("local_festa"));
});

test("corporativo nao tem making of nem entrega", () => {
  const lista = ids("corporativo");
  assert.ok(!lista.includes("making_of"));
  assert.ok(!lista.includes("entrega"));
  assert.deepEqual(lista, ["nome", "data", "horario", "local", "contato_email", "contato_whatsapp"]);
});

test("o total do progresso encolhe quando a ramificacao some", () => {
  const comSim = progresso("casamento", { making_of: "Sim" }, "entrega");
  const comNao = progresso("casamento", { making_of: "Não" }, "entrega");
  assert.equal(comSim.total, comNao.total + 1);
});

test("idsValidos inclui o passo escondido, para o autosave nao rejeitar a resposta", () => {
  assert.ok(idsValidos("casamento").has("local_making_of"));
});

test("limparRespostasOrfas descarta o local do making of ao trocar para Nao", () => {
  const sujo = { making_of: "Não", local_making_of: "Casa da noiva", nome: "Ana & João" };
  const limpo = limparRespostasOrfas("casamento", sujo);
  assert.equal(limpo.local_making_of, undefined);
  assert.equal(limpo.nome, "Ana & João");
});

test("normalizarOpcoes aceita as duas formas do arvore.json", () => {
  assert.deepEqual(normalizarOpcoes(["Sim", "Não"]), [
    { valor: "Sim", rotulo: "Sim" },
    { valor: "Não", rotulo: "Não" },
  ]);
  assert.deepEqual(normalizarOpcoes([{ valor: "debutante", rotulo: "Festa de 15 anos" }]), [
    { valor: "debutante", rotulo: "Festa de 15 anos" },
  ]);
});

test("dataMinima usa a data local, nao UTC", () => {
  // 23h45 em Brasilia (UTC-3) ja e o dia seguinte em UTC. Deve continuar dia 14.
  const noite = new Date(2026, 2, 14, 23, 45);
  assert.equal(dataMinima({ min: "hoje" } as Passo, noite), "2026-03-14");
});

test("validacao de data rejeita passado e aceita hoje", () => {
  const hoje = new Date(2026, 2, 14, 12, 0);
  const passo = { id: "data", tipo: "data", pergunta: "", obrigatorio: true, min: "hoje" } as Passo;
  assert.ok(validarResposta(passo, "2026-03-13", hoje));
  assert.equal(validarResposta(passo, "2026-03-14", hoje), null);
  assert.equal(validarResposta(passo, "2027-01-01", hoje), null);
});

test("campo opcional vazio passa; obrigatorio vazio nao", () => {
  const opcional = { id: "contato_whatsapp", tipo: "telefone", pergunta: "" } as Passo;
  const obrigatorio = { id: "nome", tipo: "texto", pergunta: "", obrigatorio: true } as Passo;
  assert.equal(validarResposta(opcional, ""), null);
  assert.ok(validarResposta(obrigatorio, "   "));
});

test("mascara de telefone BR", () => {
  assert.equal(mascararTelefone("19999998888"), "(19) 99999-8888");
  assert.equal(mascararTelefone("1999"), "(19) 99");
  assert.equal(mascararTelefone(""), "");
});

test("escolha_unica so aceita valor que existe no arvore.json", () => {
  const passo = {
    id: "entrega",
    tipo: "escolha_unica",
    pergunta: "",
    obrigatorio: true,
    opcoes: ["Em tempo real", "Em até 1 semana"],
  } as Passo;
  assert.equal(validarResposta(passo, "Em tempo real"), null);
  assert.ok(validarResposta(passo, "Amanhã"));
});
