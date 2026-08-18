import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { CamposFaltandoError, gerarProposta, textoDoCampo } from "./gerar";
import type { Respostas } from "@/lib/form/types";

/**
 * Estes testes existem por um motivo so: proposta com campo em branco nao pode
 * chegar ao lead. Antes, campo vazio era simplesmente pulado no desenho, e o
 * PDF saia com um buraco onde deveria estar o nome.
 *
 * Rodam com --conditions=react-server (ver package.json) para o "server-only"
 * do gerar.ts resolver para modulo vazio.
 */

const CASAMENTO_COMPLETO: Respostas = {
  nome: "Lúcia",
  noivos: "Ana & João",
  data: "2027-08-31",
  horario: "16:00",
  local_cerimonia: "Igreja Nossa Senhora do Brasil",
  local_festa: "Espaço Villa Bisutti",
  making_of: "Não",
  entrega: "Em tempo real",
};

async function esperarFalta(
  categoria: Parameters<typeof gerarProposta>[0],
  respostas: Respostas,
): Promise<string[]> {
  try {
    await gerarProposta(categoria, respostas);
    assert.fail("deveria ter recusado a geração");
  } catch (e) {
    assert.ok(e instanceof CamposFaltandoError, `esperava CamposFaltandoError, veio ${e}`);
    return (e as CamposFaltandoError).campos;
  }
}

test("com tudo preenchido, gera normalmente", async () => {
  const r = await gerarProposta("casamento", CASAMENTO_COMPLETO);
  assert.equal(r.templateId, "casamento");
  const doc = await PDFDocument.load(r.bytes);
  assert.ok(doc.getPageCount() > 0);
});

test("nome em branco RECUSA a geração em vez de deixar buraco na arte", async () => {
  const campos = await esperarFalta("casamento", { ...CASAMENTO_COMPLETO, noivos: "" });
  assert.equal(campos.length, 1);
  assert.match(campos[0], /noivos/i);
});

test("espaço em branco não conta como resposta", async () => {
  const campos = await esperarFalta("casamento", { ...CASAMENTO_COMPLETO, noivos: "   " });
  assert.equal(campos.length, 1);
});

test("reclama de TODOS os campos faltando de uma vez, não um por vez", async () => {
  // Os três campos que a arte do casamento realmente imprime.
  const campos = await esperarFalta("casamento", {
    ...CASAMENTO_COMPLETO,
    noivos: "",
    data: "",
    nome: "",
  });
  assert.equal(campos.length, 3);
});

test("aniversário sem idade recusa: não dá para saber qual arte usar", async () => {
  const campos = await esperarFalta("aniversario", {
    nome: "Lúcia",
    aniversariante: "João",
    data: "2027-12-01",
    horario: "20:00",
    local: "Casa da vovó",
    entrega: "Em tempo real",
  });
  assert.match(campos.join(" "), /anos/i);
});

test("aniversário com idade escolhe a arte e gera", async () => {
  const base: Respostas = {
    nome: "Lúcia",
    aniversariante: "João",
    data: "2027-12-01",
    horario: "20:00",
    local: "Casa da vovó",
    entrega: "Em tempo real",
  };
  const infantil = await gerarProposta("aniversario", { ...base, idade: "8" });
  const adulto = await gerarProposta("aniversario", { ...base, idade: "30" });
  assert.equal(infantil.templateId, "aniversario_infantil");
  assert.equal(adulto.templateId, "aniversario_adulto");
});

test("corporativo exige o tipo de evento, que é impresso na arte", async () => {
  const campos = await esperarFalta("corporativo", {
    nome: "Lúcia",
    empresa: "Acme Ltda",
    data: "2027-05-20",
    horario: "09:00",
    local: "Centro de Convenções",
  });
  assert.match(campos.join(" "), /tipo de evento/i);
});

test("a mensagem do erro lista os campos pelo texto da pergunta", async () => {
  try {
    await gerarProposta("casamento", { ...CASAMENTO_COMPLETO, noivos: "" });
    assert.fail("deveria ter recusado");
  } catch (e) {
    // A Mel le esta mensagem no painel: precisa dizer a pergunta, nao a chave.
    assert.match((e as Error).message, /Nome dos noivos/);
  }
});

// --- campo composto -------------------------------------------------------
//
// O cabeçalho da capa do casamento é UM texto que junta duas respostas com a
// data já por extenso no meio. Formatar depois de concatenar seria impossível:
// não dá para saber onde a data começa dentro da string.

test("campo composto junta as respostas e formata cada uma", () => {
  const campo = {
    chave: "cabecalho",
    composicao: "{noivos} | {data}",
    formatos: { data: "data_extenso" },
  } as unknown as Parameters<typeof textoDoCampo>[0];

  assert.equal(
    textoDoCampo(campo, { noivos: "Ana & João", data: "2027-08-31" }),
    "Ana & João | 31 de agosto de 2027",
  );
});

test("faltar UMA chave do composto invalida a linha inteira", async () => {
  // "Ana & João | " com a data vazia é pior do que não gerar proposta.
  const campos = await esperarFalta("casamento", {
    nome: "Lúcia",
    noivos: "Ana & João",
    // data ausente
    horario: "16:00",
    local_cerimonia: "Igreja",
    local_festa: "Salão",
    making_of: "Não",
    entrega: "Em tempo real",
  });
  assert.match(campos.join(" "), /Data do casamento/);
});

test("a arte do casamento não exige horário nem os dois locais", async () => {
  // Eles continuam sendo perguntados e aparecem no painel, mas não são
  // impressos: a arte não reservou espaço.
  const r = await gerarProposta("casamento", {
    nome: "Lúcia",
    noivos: "Ana & João",
    data: "2027-08-31",
    making_of: "Não",
    entrega: "Em tempo real",
  });
  assert.equal(r.templateId, "casamento");
});
