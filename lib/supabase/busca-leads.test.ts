import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { aplicarBuscaLeads, filtroBuscaLeads } from "./busca-leads";

const CAMPOS_TEXTO = [
  "nome_display", "respostas->>nome", "respostas->>noivos",
  "respostas->>local_cerimonia", "respostas->>local_festa",
] as const;
const CAMPOS = [...CAMPOS_TEXTO, "whatsapp"] as const;
type Campo = (typeof CAMPOS)[number];
type Clausula = { campo: Campo; padrao: string };
type Fixture = {
  id: string;
  nome_display?: string | null;
  whatsapp?: string | null;
  respostas?: Record<string, string>;
};

/** A fronteira aceita somente campos/operador fixos e valores JSON completos. */
function lerClausulas(filtro: string): Clausula[] {
  const clausulas: Clausula[] = [];
  const valor = /^("(?:[^"\\]|\\.)*")/;
  let restante = filtro;
  while (restante) {
    const campo = CAMPOS.find((candidato) => restante.startsWith(`${candidato}.imatch.`));
    assert.ok(campo, `campo ou operador fora do contrato: ${restante}`);
    restante = restante.slice(`${campo}.imatch.`.length);
    const encontrado = valor.exec(restante);
    assert.ok(encontrado, "valor deve permanecer inteiro entre aspas, mesmo com vírgula ou parêntese");
    const padrao: unknown = JSON.parse(encontrado[1]);
    assert.equal(typeof padrao, "string");
    clausulas.push({ campo, padrao: padrao as string });
    restante = restante.slice(encontrado[1].length);
    if (restante) {
      assert.ok(restante.startsWith(","), "não permite outro fragmento depois do valor");
      restante = restante.slice(1);
      assert.ok(restante, "não permite cláusula vazia");
    }
  }
  assert.deepEqual(clausulas.map(({ campo }) => campo),
    clausulas.some(({ campo }) => campo === "whatsapp") ? CAMPOS : CAMPOS_TEXTO);
  return clausulas;
}

function valorDoCampo(fixture: Fixture, campo: Campo): string | null | undefined {
  if (campo === "nome_display" || campo === "whatsapp") return fixture[campo];
  return fixture.respostas?.[campo.slice("respostas->>".length)];
}

/** Só transporte HTTP falso: o SDK monta a URL real, nenhuma credencial/rede real. */
function banco(fixtures: Fixture[] = []) {
  const pedidos: { url: URL; metodo: string }[] = [];
  const db = createClient("https://busca-ficticia.invalid", "chave-ficticia-nao-enviada", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const metodo = init?.method ?? "GET";
      assert.equal(metodo, "GET", "busca nunca altera dados");
      assert.equal(url.pathname, "/rest/v1/leads");
      pedidos.push({ url, metodo });
      const or = url.searchParams.get("or");
      const clausulas = or ? lerClausulas(or.slice(1, -1)) : [];
      if (or) assert.ok(or.startsWith("(") && or.endsWith(")"));
      const resultado = fixtures.filter((fixture) => !or || clausulas.some(({ campo, padrao }) => {
        const texto = valorDoCampo(fixture, campo);
        return typeof texto === "string" && new RegExp(padrao, "i").test(texto);
      }));
      return Response.json(resultado.map(({ id }) => ({ id })));
    } },
  });
  return { db, pedidos };
}

async function buscar(termo: string, fixtures: Fixture[]) {
  const { db, pedidos } = banco(fixtures);
  const resposta = await aplicarBuscaLeads(db.from("leads").select("id"), termo);
  assert.equal(resposta.error, null);
  assert.equal(pedidos.length, 1);
  return { ids: (resposta.data ?? []).map((linha) => linha.id), url: pedidos[0].url };
}

test("OR pesquisa somente os cinco campos de texto fixos, inclusive nome de contato e locais do JSON", async () => {
  const fixtures: Fixture[] = [
    { id: "sujeito", nome_display: "Mariana & Luís" },
    { id: "contato", respostas: { nome: "Márcia Cerimonialista" } },
    { id: "noivos", nome_display: null, respostas: { noivos: "Érica & João" } },
    { id: "cerimonia", respostas: { local_cerimonia: "Paróquia São José" } },
    { id: "festa", respostas: { local_festa: "Espaço d'Ávila" } },
    { id: "nao-relacionado", nome_display: "Outro casal", respostas: { observacoes: "Luís João São José Ávila" } },
    { id: "nulos", nome_display: null, whatsapp: null },
  ];
  for (const [termo, esperado] of [
    ["luis", "sujeito"], ["LUÍS", "sujeito"], ["cerimonial", "contato"],
    ["joa", "noivos"], ["JOÃO", "noivos"], ["sao jose", "cerimonia"],
    ["SÃO JOSÉ", "cerimonia"], ["avila", "festa"], ["ÁVILA", "festa"],
  ]) {
    const { ids, url } = await buscar(termo, fixtures);
    assert.deepEqual(ids, [esperado], termo);
    assert.equal(url.searchParams.get("select"), "id", "filtro não acrescenta respostas ao payload");
    assert.deepEqual(lerClausulas(url.searchParams.get("or")!.slice(1, -1)).map(({ campo }) => campo), CAMPOS_TEXTO);
  }
});

test("acentos são equivalentes nas duas direções, com maiúsculas e entrada Unicode decomposta", async () => {
  for (const [simples, acentuado] of [
    ["a", "áàâãä"], ["e", "éèêë"], ["i", "íìîï"],
    ["o", "óòôõö"], ["u", "úùûü"], ["c", "ç"],
  ]) {
    for (const letra of acentuado) {
      const fixtures = [{ id: "sem", nome_display: `Lugar ${simples}` }, { id: "com", nome_display: `Lugar ${letra}` }];
      assert.deepEqual((await buscar(`lugar ${simples}`, fixtures)).ids, ["sem", "com"]);
      assert.deepEqual((await buscar(`LUGAR ${letra.toUpperCase()}`, fixtures)).ids, ["sem", "com"]);
      assert.deepEqual((await buscar(`Lugar ${letra}`.normalize("NFD"), fixtures)).ids, ["sem", "com"]);
    }
  }
});

test("busca telefone parcial ou mascarado com e sem DDI sem confundir DDD nacional 55", async () => {
  const fixtures: Fixture[] = [
    { id: "nacional", whatsapp: "19987654321" },
    { id: "internacional", whatsapp: "5519987654321" },
    { id: "ddd55", whatsapp: "55987654321" },
    { id: "ddd55-internacional", whatsapp: "5555987654321" },
    { id: "fixo", whatsapp: "1934567890" },
    { id: "outro", whatsapp: "11900000000" },
  ];
  for (const termo of ["19987654321", "(19) 98765-4321", "+55 (19) 98765-4321", "55 19 98765.4321"]) {
    const { ids, url } = await buscar(termo, fixtures);
    assert.deepEqual(ids, ["nacional", "internacional"], termo);
    assert.equal(lerClausulas(url.searchParams.get("or")!.slice(1, -1)).at(-1)?.campo, "whatsapp");
  }
  for (const termo of ["55987654321", "(55) 98765-4321", "+55 (55) 98765-4321"]) {
    assert.deepEqual((await buscar(termo, fixtures)).ids, ["ddd55", "ddd55-internacional"], termo);
  }
  assert.deepEqual((await buscar("98765-4321", fixtures)).ids,
    ["nacional", "internacional", "ddd55", "ddd55-internacional"]);
  assert.deepEqual((await buscar("+55 (19) 3456-7890", fixtures)).ids, ["fixo"]);
  for (const termo of ["Espaço 19", "telefone 19987654321", "+ ( ) . -"]) {
    const filtro = filtroBuscaLeads(termo);
    assert.ok(filtro);
    assert.equal(lerClausulas(filtro).some(({ campo }) => campo === "whatsapp"), false, termo);
  }
});

test("pontuação, curingas, regex e fragmentos OR/SQL permanecem texto literal dentro do filtro", async () => {
  const termos = [
    "D'Ávila (Fazenda), Salão: Sul",
    'Salão "Santa" \\ Caminho',
    "[A-Z].* +? ^$ {2} (a|b)",
    "100%_completo*",
    'Ana"),status.eq.perdido,nome_display.imatch.("',
    "'); SELECT * FROM leads; --",
  ];
  for (const termo of termos) {
    const fixtures = [{ id: "literal", respostas: { local_festa: termo } },
      { id: "outro", nome_display: "ZZZZ qualquer coisa", respostas: { local_festa: "100xxxxcompleto" } }];
    const { ids, url } = await buscar(termo, fixtures);
    assert.deepEqual(ids, ["literal"], termo);
    assert.deepEqual(lerClausulas(url.searchParams.get("or")!.slice(1, -1)).map(({ campo }) => campo), CAMPOS_TEXTO);
    assert.equal(url.searchParams.get("status"), null, "texto não cria parâmetro de status");
  }
});

test("vazio não acrescenta OR e mantém a mesma consulta", async () => {
  for (const termo of ["", " ", "\n\t "]) {
    assert.equal(filtroBuscaLeads(termo), null);
    const { db, pedidos } = banco([{ id: "todos" }]);
    const consulta = db.from("leads").select("id").eq("status", "esfriou");
    assert.equal(aplicarBuscaLeads(consulta, termo), consulta);
    const { data, error } = await consulta;
    assert.equal(error, null);
    assert.deepEqual(data, [{ id: "todos" }]);
    assert.equal(pedidos[0].url.searchParams.has("or"), false);
    assert.equal(pedidos[0].url.searchParams.get("status"), "eq.esfriou");
  }
});

test("OR preserva status, categoria, período, seleção mínima, ordem e paginação da consulta", async () => {
  const { db, pedidos } = banco();
  const consulta = db.from("leads").select("id", { count: "exact" }).eq("status", "esfriou")
    .eq("categoria", "casamento").gte("created_at", "2026-10-23T03:00:00.000Z")
    .order("created_at", { ascending: false }).order("id", { ascending: true }).range(200, 399);
  assert.equal(aplicarBuscaLeads(consulta, "São José"), consulta);
  const { error } = await consulta;
  assert.equal(error, null);
  const url = pedidos[0].url;
  assert.equal(url.searchParams.get("status"), "eq.esfriou");
  assert.equal(url.searchParams.get("categoria"), "eq.casamento");
  assert.equal(url.searchParams.get("created_at"), "gte.2026-10-23T03:00:00.000Z");
  assert.equal(url.searchParams.get("select"), "id");
  assert.equal(url.searchParams.get("order"), "created_at.desc,id.asc");
  assert.equal(url.searchParams.get("offset"), "200");
  assert.equal(url.searchParams.get("limit"), "200");
  assert.ok(url.searchParams.get("or"));
});
