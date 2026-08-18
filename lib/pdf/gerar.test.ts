import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { CamposFaltandoError, gerarProposta } from "./gerar";
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
  nome: "Ana & João",
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
  const campos = await esperarFalta("casamento", { ...CASAMENTO_COMPLETO, nome: "" });
  assert.equal(campos.length, 1);
  assert.match(campos[0], /noivos/i);
});

test("espaço em branco não conta como resposta", async () => {
  const campos = await esperarFalta("casamento", { ...CASAMENTO_COMPLETO, nome: "   " });
  assert.equal(campos.length, 1);
});

test("reclama de TODOS os campos faltando de uma vez, não um por vez", async () => {
  const campos = await esperarFalta("casamento", {
    ...CASAMENTO_COMPLETO,
    nome: "",
    data: "",
    local_festa: "",
  });
  assert.equal(campos.length, 3);
});

test("aniversário sem idade recusa: não dá para saber qual arte usar", async () => {
  const campos = await esperarFalta("aniversario", {
    nome: "João",
    data: "2027-12-01",
    horario: "20:00",
    local: "Casa da vovó",
    entrega: "Em tempo real",
  });
  assert.match(campos.join(" "), /anos/i);
});

test("aniversário com idade escolhe a arte e gera", async () => {
  const base: Respostas = {
    nome: "João",
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
    nome: "Acme Ltda",
    data: "2027-05-20",
    horario: "09:00",
    local: "Centro de Convenções",
  });
  assert.match(campos.join(" "), /tipo de evento/i);
});

test("a mensagem do erro lista os campos pelo texto da pergunta", async () => {
  try {
    await gerarProposta("casamento", { ...CASAMENTO_COMPLETO, horario: "" });
    assert.fail("deveria ter recusado");
  } catch (e) {
    // A Mel le esta mensagem no painel: precisa dizer a pergunta, nao a chave.
    assert.match((e as Error).message, /Horário do convite/);
  }
});
