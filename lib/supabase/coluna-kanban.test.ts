import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { lerColunaKanban } from "./coluna-kanban";
import { filtroBuscaLeads } from "./busca-leads";
import { maisNovoPrimeiro } from "@/lib/admin/ordem";
import { normalizarFiltrosNavegacao } from "@/lib/admin/navegacao";
import type { LeadCartao } from "@/lib/admin/tipos";
import { STATUS } from "@/lib/form/types";

const DIA = 86_400_000;
const agoraMs = Date.parse("2026-10-23T18:00:00Z");
const id = (numero: number) => `10000000-0000-4000-8000-${String(numero).padStart(12, "0")}`;
const card = (numero: number, patch: Partial<LeadCartao> = {}): LeadCartao => ({
  id: id(numero), created_at: new Date(agoraMs - numero * 60_000).toISOString(), categoria: "casamento",
  status: "incompleto", nome_display: `Fixture ${numero}`, data_evento: "2026-11-15", passo_atual: null,
  enviado_em: new Date(agoraMs - 40 * DIA).toISOString(), lembrete_7_em: null, lembrete_30_em: null,
  lembrete_email_em: null, chamado_whatsapp_em: null, qualificado_em: null,
  pdf_url: "https://example.invalid/p/abcd", whatsapp: "19900000000", email: null, ...patch,
});
type Historico = { lead_id: string; tipo: string; estado: string; enviado_em: string; ocorrido_em: string;
  proposta_enviado_em: string; ultimo_codigo: string | null; iniciado_em: string | null };

function banco(cartoes: LeadCartao[], historico: Historico[] = [], falha?: "leads" | "whatsapp_outbox" | "lancar", falhaInicio = 0) {
  const pedidos: URL[] = [];
  const db = createClient("https://kanban-test.invalid", "fixture-sem-segredo", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); pedidos.push(url);
      assert.ok(!init?.method || init.method === "GET", "A paginação só consulta dados.");
      if (falha === "lancar") throw new Error("privado@example.invalid segredo-dobanco");
      if (falha && url.pathname.endsWith(`/${falha}`) && Number(url.searchParams.get("offset") ?? 0) >= falhaInicio) return Response.json({
        message: "privado@example.invalid segredo-dobanco", code: "PGRST001",
      }, { status: 400 });
      if (url.pathname.endsWith("/leads")) {
        assert.equal(url.searchParams.get("order"), "created_at.desc,id.asc");
        assert.equal(url.searchParams.get("select")?.includes("rastreio"), false);
        const linhas = cartoes.filter(lead => `eq.${lead.status}` === url.searchParams.get("status"))
          .sort(maisNovoPrimeiro);
        const inicio = Number(url.searchParams.get("offset") ?? 0);
        const tamanho = Number(url.searchParams.get("limit"));
        assert.ok(tamanho <= 200);
        const pagina = linhas.slice(inicio, inicio + tamanho);
        return Response.json(pagina, { headers: { "content-range": pagina.length
          ? `${inicio}-${inicio + pagina.length - 1}/${linhas.length}` : `*/${linhas.length}` } });
      }
      assert.ok(url.pathname.endsWith("/whatsapp_outbox"));
      assert.equal(url.searchParams.get("select")?.includes("mensagem"), false);
      const ids = url.searchParams.get("lead_id")!.slice(4, -1).split(",");
      return Response.json(historico.filter(item => ids.includes(item.lead_id)));
    } },
  });
  return { db, pedidos };
}

test("a primeira carga e os prefixos 50/100/150 conservam limites, totais e fim de coluna", async () => {
  for (const tamanho of [0, 49, 50, 51, 100, 101]) {
    const { db, pedidos } = banco(Array.from({ length: tamanho }, (_, i) => card(i + 1)));
    for (const quantidade of [50, 100, 150]) {
      const resultado = await lerColunaKanban({ status: "incompleto", quantidade,
        filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
      assert.equal(resultado.erro, null);
      assert.equal(resultado.total, tamanho);
      assert.equal(resultado.cartoes.length, Math.min(tamanho, quantidade));
      assert.deepEqual(resultado.cartoes.map(lead => lead.id), Array.from({ length: Math.min(tamanho, quantidade) }, (_, i) => id(i + 1)));
    }
    assert.ok(pedidos.filter(url => url.pathname.endsWith("/leads")).every(url => Number(url.searchParams.get("offset") ?? 0) === 0));
  }
});

test("prefixo acima de 1.000 consulta ranges pequenos e preserva filtros e metadados", async () => {
  const cartoes = Array.from({ length: 1_051 }, (_, i) => card(i + 1));
  const historico: Historico[] = [{ lead_id: id(1_025), tipo: "lembrete_formulario_24h", estado: "enviado",
    enviado_em: "2026-10-22T18:00:00Z", ocorrido_em: "2026-10-22T18:00:00Z",
    proposta_enviado_em: cartoes[0].enviado_em!, ultimo_codigo: null, iniciado_em: null }];
  const { db, pedidos } = banco(cartoes, historico);
  const resultado = await lerColunaKanban({ status: "incompleto", quantidade: 1_050,
    filtros: normalizarFiltrosNavegacao({ q: "Fixture", categoria: "casamento", periodo: "hoje" }), agoraMs }, db);
  assert.equal(resultado.erro, null);
  assert.equal(resultado.total, 1_051);
  assert.equal(resultado.cartoes.length, 1_050);
  assert.equal(new Set(resultado.cartoes.map(lead => lead.id)).size, 1_050);
  assert.deepEqual(resultado.cartoes[1_024].disparos_whatsapp, [{ tipo: "lembrete_formulario_24h", enviado_em: "2026-10-22T18:00:00Z" }]);
  const consultas = pedidos.filter(url => url.pathname.endsWith("/leads"));
  assert.deepEqual(consultas.map(url => Number(url.searchParams.get("offset") ?? 0)), [0, 200, 400, 600, 800, 1_000]);
  assert.deepEqual(consultas.map(url => Number(url.searchParams.get("limit"))), [200, 200, 200, 200, 200, 50]);
  for (const url of consultas) {
    assert.equal(url.searchParams.get("categoria"), "eq.casamento");
    assert.equal(url.searchParams.get("created_at"), "gte.2026-10-23T03:00:00.000Z");
    assert.equal(url.searchParams.get("or"), `(${filtroBuscaLeads("Fixture")})`);
  }
});

test("todas as colunas consultam somente seu status; empate mantém microssegundos e ID", async () => {
  for (const status of STATUS) {
    const { db } = banco([
      card(3, { status, created_at: "2026-10-23T15:00:00.123001Z" }),
      card(2, { status, created_at: "2026-10-23T15:00:00.123999Z" }),
      card(1, { status, created_at: "2026-10-23T15:00:00.123999Z" }),
    ]);
    const resultado = await lerColunaKanban({ status, quantidade: 50, filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
    assert.equal(resultado.erro, null, status);
    assert.deepEqual(resultado.cartoes.map(lead => lead.id), [id(1), id(2), id(3)], status);
  }
});

test("Esfriou mantém última tentativa, primeiro lembrete e demais antes do prefixo de 100", async () => {
  const cartoes = Array.from({ length: 401 }, (_, i) => card(i + 1, { status: "esfriou" }));
  const historico: Historico[] = cartoes.filter(lead => lead.id !== id(350)).map(lead => ({
    lead_id: lead.id, tipo: "lembrete_proposta_7d", estado: "enviado", ultimo_codigo: null, iniciado_em: null,
    enviado_em: new Date(agoraMs - (lead.id === id(401) ? 20 : 1) * DIA).toISOString(),
    ocorrido_em: new Date(agoraMs - DIA).toISOString(), proposta_enviado_em: lead.enviado_em!,
  }));
  const { db } = banco(cartoes, historico);
  const resultado = await lerColunaKanban({ status: "esfriou", quantidade: 100,
    filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
  assert.equal(resultado.erro, null);
  assert.equal(resultado.total, 401);
  assert.equal(resultado.cartoes.length, 100);
  assert.deepEqual(resultado.cartoes.slice(0, 3).map(lead => lead.id), [id(401), id(350), id(1)]);
  assert.equal(resultado.cartoes[0].disparos_whatsapp?.[0].tipo, "lembrete_proposta_7d");
});

test("a próxima carga revalida o início depois de inserção e movimento, sem concatenar cópias antigas", async () => {
  const cartoes = Array.from({ length: 101 }, (_, i) => card(i + 1));
  const { db } = banco(cartoes);
  const primeira = await lerColunaKanban({ status: "incompleto", quantidade: 50,
    filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
  assert.equal(primeira.cartoes[0].id, id(1));
  cartoes[0].status = "aguardando_revisao";
  cartoes.push(card(500, { created_at: new Date(agoraMs).toISOString() }));
  const segunda = await lerColunaKanban({ status: "incompleto", quantidade: 100,
    filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
  assert.equal(segunda.cartoes[0].id, id(500));
  assert.equal(segunda.cartoes.some(lead => lead.id === id(1)), false);
  assert.equal(new Set(segunda.cartoes.map(lead => lead.id)).size, 100);
  assert.equal(segunda.cartoes[99].id, id(100));
});

test("falhas principais são humanas; falha auxiliar mantém cartões e avisa histórico", async () => {
  for (const falha of ["leads", "lancar"] as const) {
    const { db } = banco([card(1)], [], falha);
    const resultado = await lerColunaKanban({ status: "incompleto", quantidade: 50,
      filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
    assert.ok(resultado.erro);
    assert.equal(resultado.cartoes.length, 0);
    assert.doesNotMatch(JSON.stringify(resultado), /segredo-dobanco|privado@example|PGRST001/);
  }
  const { db } = banco([card(1)], [], "whatsapp_outbox");
  const resultado = await lerColunaKanban({ status: "incompleto", quantidade: 50,
    filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
  assert.equal(resultado.erro, null);
  assert.equal(resultado.cartoes.length, 1);
  assert.equal(resultado.erroDisparos, true);
});

test("falha numa página interna não publica prefixo parcial nem consulta histórico", async () => {
  const { db, pedidos } = banco(Array.from({ length: 251 }, (_, i) => card(i + 1)), [], "leads", 200);
  const resultado = await lerColunaKanban({ status: "incompleto", quantidade: 250,
    filtros: normalizarFiltrosNavegacao(), agoraMs }, db);
  assert.equal(resultado.cartoes.length, 0);
  assert.equal(resultado.total, 251);
  assert.ok(resultado.erro);
  assert.ok(pedidos.every(url => url.pathname.endsWith("/leads")));
  assert.deepEqual(pedidos.map(url => Number(url.searchParams.get("offset") ?? 0)), [0, 200, 200, 200]);
  assert.doesNotMatch(JSON.stringify(resultado), /segredo-dobanco|privado@example/);
});
