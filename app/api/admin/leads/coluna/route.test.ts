import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { CATEGORIAS, STATUS } from "@/lib/form/types";
import { normalizarFiltrosNavegacao } from "@/lib/admin/navegacao";
import { TAMANHO_LOTE_KANBAN, type ColunaKanbanDados } from "@/lib/admin/paginacao-kanban";
import { PERIODOS } from "@/lib/admin/periodo";
import type { lerColunaKanban } from "@/lib/supabase/coluna-kanban";

// Rota real executada com sessão e leitura isoladas. Não há acesso ao banco,
// automações, cookies, variáveis de produção ou rede neste teste.
const AGORA = Date.parse("2026-10-23T18:00:00Z");
const fonte = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function montar({ sessao = true, coluna = { cartoes: [], total: 0, erro: null }, lancar = false }: {
  sessao?: boolean; coluna?: ColunaKanbanDados; lancar?: boolean;
} = {}) {
  const consultas: Parameters<typeof lerColunaKanban>[0][] = [];
  let sessoes = 0;
  const mod: { exports: { GET?: (req: Request) => Promise<Response> } } = { exports: {} };
  runInNewContext(fonte, {
    exports: mod.exports, URL, console: { error() {} }, Date: { now: () => AGORA },
    require(nome: string) {
      if (nome === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (nome === "zod") return { z };
      if (nome === "@/lib/form/types") return { CATEGORIAS, STATUS };
      if (nome === "@/lib/admin/navegacao") return { normalizarFiltrosNavegacao };
      if (nome === "@/lib/admin/paginacao-kanban") return { TAMANHO_LOTE_KANBAN };
      if (nome === "@/lib/admin/periodo") return { PERIODOS };
      if (nome === "@/lib/supabase/server") return { getSessaoAdmin: async () => {
        sessoes++; return sessao ? { id: "admin-fixture" } : null;
      } };
      if (nome === "@/lib/supabase/coluna-kanban") return { lerColunaKanban: async (entrada: Parameters<typeof lerColunaKanban>[0]) => {
        consultas.push(entrada);
        if (lancar) throw new Error("contato@privado.invalid segredo-dobanco");
        return coluna;
      } };
      throw new Error(`Importação não autorizada no teste: ${nome}`);
    },
  });
  return { consultas, sessoes: () => sessoes,
    get: (query = "status=incompleto&quantidade=50") => mod.exports.GET!(new Request(`https://mel.example.invalid/api/admin/leads/coluna?${query}`)) };
}

test("sem sessão retorna 401 sem consultar dados e sem cache", async () => {
  const tela = montar({ sessao: false });
  const resposta = await tela.get();
  assert.equal(resposta.status, 401);
  assert.equal(resposta.headers.get("cache-control"), "no-store");
  assert.equal(tela.sessoes(), 1);
  assert.equal(tela.consultas.length, 0);
});

test("valida status, quantidade, filtros e parâmetros repetidos antes de consultas", async () => {
  const invalidos = [
    "", "status=fora&quantidade=50", "status=incompleto", "status=incompleto&quantidade=49",
    "status=incompleto&quantidade=51", "status=incompleto&quantidade=0", "status=incompleto&quantidade=-50",
    "status=incompleto&quantidade=50.0", "status=incompleto&quantidade=1e2", "status=incompleto&quantidade=1000050",
    "status=incompleto&quantidade=NaN", "status=incompleto&quantidade=50&categoria=outra",
    "status=incompleto&quantidade=50&periodo=ontem", "status=incompleto&quantidade=50&status=enviado",
    "status=incompleto&quantidade=50&quantidade=100", "status=incompleto&quantidade=50&offset=0",
  ];
  for (const query of invalidos) {
    const tela = montar();
    const resposta = await tela.get(query);
    assert.equal(resposta.status, 400, query);
    assert.equal(resposta.headers.get("cache-control"), "no-store");
    assert.equal(tela.consultas.length, 0, query);
  }
});

test("todas as colunas e prefixos válidos usam um único relógio e só leitura", async () => {
  for (const status of STATUS) {
    for (const quantidade of [50, 100, 150, 1_050, 1_000_000]) {
      const tela = montar();
      const resposta = await tela.get(`status=${status}&quantidade=${quantidade}`);
      assert.equal(resposta.status, 200);
      assert.equal(resposta.headers.get("cache-control"), "no-store");
      assert.deepEqual(await resposta.json(), { coluna: { cartoes: [], total: 0, erro: null }, agoraMs: AGORA });
      assert.equal(tela.consultas.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(tela.consultas[0])), {
        status, quantidade, filtros: { q: "", periodo: "todo" }, agoraMs: AGORA,
      });
    }
  }
});

test("mantém busca literal normalizada e filtros canônicos da coluna", async () => {
  const tela = montar();
  const busca = new URLSearchParams({ status: "esfriou", quantidade: "100", q: "  João & Capela  ", categoria: "casamento", periodo: "mes" });
  assert.equal((await tela.get(busca.toString())).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(tela.consultas[0])), {
    status: "esfriou", quantidade: 100,
    filtros: { q: "João & Capela", categoria: "casamento", periodo: "mes" }, agoraMs: AGORA,
  });
});

test("falhas viram 503 humano sem retornar dados parciais ou informações privadas", async () => {
  for (const config of [
    { coluna: { cartoes: [], total: 17, erro: "segredo-dobanco contato@privado.invalid" } },
    { lancar: true },
  ]) {
    const tela = montar(config);
    const resposta = await tela.get();
    assert.equal(resposta.status, 503);
    assert.equal(resposta.headers.get("cache-control"), "no-store");
    const body = await resposta.json();
    assert.match(body.erro, /Não consegui carregar esta coluna/);
    assert.doesNotMatch(JSON.stringify(body), /privado|segredo|cartoes|total/);
  }
});
