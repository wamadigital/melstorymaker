import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { CamposFaltandoError, gerarProposta, textoDoCampo } from "./gerar";
import { TEMPLATES, type Respostas } from "@/lib/form/types";
import { chavesDoCampo, templates } from "./templates.config";

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
    formatos: { data: "data_curta" },
  } as unknown as Parameters<typeof textoDoCampo>[0];

  assert.equal(
    textoDoCampo(campo, { noivos: "Ana & João", data: "2027-08-31" }),
    "Ana & João | 31/08/2027",
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

// --- debutante ------------------------------------------------------------

const DEBUTANTE_COMPLETO: Respostas = {
  nome: "Lúcia",
  debutante: "Maria Eduarda",
  data: "2027-03-14",
  horario: "19:30",
  local: "Espaço Villa Bisutti",
  making_of: "Não",
  entrega: "Em tempo real",
};

test("o cabeçalho do debutante compõe o texto fixo da arte", () => {
  const campo = {
    chave: "cabecalho",
    composicao: "15 ANOS DA {debutante} | {data}",
    formatos: { data: "data_curta" },
  } as unknown as Parameters<typeof textoDoCampo>[0];

  assert.equal(
    textoDoCampo(campo, { debutante: "Maria Eduarda", data: "2027-03-14" }),
    "15 ANOS DA Maria Eduarda | 14/03/2027",
  );
});

test("debutante gera as 6 páginas da arte real", async () => {
  const r = await gerarProposta("debutante", DEBUTANTE_COMPLETO);
  assert.equal(r.templateId, "debutante");
  assert.equal(r.usouPlaceholder, false);
  assert.equal(r.usouFallbackDeFonte, false);
  const doc = await PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(), 6);
});

test("debutante sem o nome da debutante recusa a geração", async () => {
  const campos = await esperarFalta("debutante", { ...DEBUTANTE_COMPLETO, debutante: "" });
  assert.match(campos.join(" "), /Nome da debutante/);
});

test("debutante não exige horário nem local: a arte não os imprime", async () => {
  const r = await gerarProposta("debutante", {
    nome: "Lúcia",
    debutante: "Maria Eduarda",
    data: "2027-03-14",
  });
  assert.equal(r.templateId, "debutante");
});

test("casamento e debutante compartilham o mesmo desenho de capa", () => {
  // O que muda entre as artes é só a composição do cabeçalho e o x do nome.
  // Se alguém quebrar o helper, os dois divergem aqui antes de sair no PDF.
  const cas = templates.casamento.campos;
  const deb = templates.debutante.campos;

  assert.deepEqual(
    cas.map((c) => c.chave),
    deb.map((c) => c.chave),
  );
  for (const chave of ["y", "tamanho", "cor", "font", "alinhamento"] as const) {
    assert.deepEqual(
      cas.map((c) => c[chave]),
      deb.map((c) => c[chave]),
      `divergiu em ${chave}`,
    );
  }
});

// --- aniversário infantil -------------------------------------------------

test("o cabeçalho do aniversário infantil traz o nome do aniversariante", () => {
  const campo = {
    chave: "cabecalho",
    composicao: "ANIVERSÁRIO {aniversariante} | {data}",
    formatos: { data: "data_curta" },
  } as unknown as Parameters<typeof textoDoCampo>[0];

  assert.equal(
    textoDoCampo(campo, { aniversariante: "João Vitor", data: "2027-12-01" }),
    "ANIVERSÁRIO João Vitor | 01/12/2027",
  );
});

test("aniversário com 14 anos ou menos usa a arte infantil real", async () => {
  const r = await gerarProposta("aniversario", {
    nome: "Lúcia",
    aniversariante: "João Vitor",
    idade: "8",
    data: "2027-12-01",
  });
  assert.equal(r.templateId, "aniversario_infantil");
  assert.equal(r.usouPlaceholder, false);
  assert.equal(r.usouFallbackDeFonte, false);
  const doc = await PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(), 6);
});

test("aniversário infantil sem o nome do aniversariante recusa", async () => {
  const campos = await esperarFalta("aniversario", {
    nome: "Lúcia",
    idade: "8",
    data: "2027-12-01",
  });
  assert.match(campos.join(" "), /aniversariante/i);
});

test("as três artes reais compartilham o desenho de capa, variando só x e composição", () => {
  const reais = ["casamento", "debutante", "aniversario_infantil"] as const;

  for (const t of reais) {
    const campos = templates[t].campos;
    assert.deepEqual(
      campos.map((c) => c.chave),
      ["cabecalho", "nome"],
      `${t} não tem os dois campos de capa`,
    );
    // O que NÃO pode variar entre as artes.
    assert.equal(campos[0].y, 64, `${t}: y do cabeçalho`);
    assert.equal(campos[1].y, 488.5, `${t}: y do nome`);
    assert.equal(campos[0].alinhamento, "direita", `${t}: alinhamento do cabeçalho`);
    assert.equal(campos[1].cor, "#FFFFFF", `${t}: cor do nome`);
  }
});

// --- aniversário adulto ---------------------------------------------------

test("aniversário com 15 anos ou mais usa a arte adulta real", async () => {
  const r = await gerarProposta("aniversario", {
    nome: "Lúcia",
    aniversariante: "João Vitor",
    idade: "30",
    data: "2027-12-01",
  });
  assert.equal(r.templateId, "aniversario_adulto");
  assert.equal(r.usouPlaceholder, false);
  assert.equal(r.usouFallbackDeFonte, false);
  const doc = await PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(), 6);
});

test("a arte adulta NÃO imprime o nome do aniversariante — é assim no Figma", async () => {
  // O cabeçalho do adulto é "ANIVERSÁRIO | {{data}}", sem a variável, enquanto
  // o infantil traz o nome. Este teste trava a diferença: se alguém "consertar"
  // o config sem mexer na arte, o texto sairia de uma variável que não existe
  // lá — e a proposta ficaria diferente do design aprovado.
  const adulto = templates.aniversario_adulto.campos[0];
  const infantil = templates.aniversario_infantil.campos[0];

  assert.equal(adulto.composicao, "ANIVERSÁRIO | {data}");
  assert.equal(infantil.composicao, "ANIVERSÁRIO {aniversariante} | {data}");
  assert.ok(!chavesDoCampo(adulto).includes("aniversariante"));
  assert.ok(chavesDoCampo(infantil).includes("aniversariante"));
});

test("adulto gera sem o nome do aniversariante, porque a arte não o usa", async () => {
  // Aqui não é permissividade: o campo simplesmente não faz parte desta arte.
  const r = await gerarProposta("aniversario", {
    nome: "Lúcia",
    idade: "30",
    data: "2027-12-01",
  });
  assert.equal(r.templateId, "aniversario_adulto");
});

test("as artes reais seguem o padrão de capa; só falta o corporativo", () => {
  // Quando o corporativo entrar, ele passa a aparecer em `prontas` e este teste
  // cobre as cinco. Enquanto isso, a asserção de baixo é o lembrete do que falta.
  const prontas = TEMPLATES.filter((t) => t !== "corporativo");

  for (const t of prontas) {
    assert.deepEqual(
      templates[t].campos.map((c) => c.chave),
      ["cabecalho", "nome"],
      `${t} fora do padrão de capa`,
    );
  }

  assert.equal(prontas.length, 4, "esperava 4 artes reais");
});
