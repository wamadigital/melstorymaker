import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { lerNavegacaoLead } from "./navegacao-leads";
import { normalizarFiltrosNavegacao } from "@/lib/admin/navegacao";
import type { LeadCartao } from "@/lib/admin/tipos";

const DIA = 86_400_000;
const agora = Date.parse("2026-10-23T18:00:00Z");
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const cartao = (n: number, extra: Partial<LeadCartao> = {}): LeadCartao => ({
  id: id(n), created_at: new Date(agora - n * 60_000).toISOString(), categoria: "casamento", status: "incompleto",
  nome_display: `Fixture ${n}`, data_evento: null, passo_atual: null, enviado_em: null,
  lembrete_7_em: null, lembrete_30_em: null, lembrete_email_em: null, chamado_whatsapp_em: null,
  qualificado_em: null, pdf_url: null, whatsapp: null, email: null, ...extra,
});

type LinhaHistorico = { lead_id: string; tipo: string; estado: string; enviado_em: string; ocorrido_em: string;
  proposta_enviado_em: string | null; ultimo_codigo: string | null };
function banco(cartoes: LeadCartao[], historico: LinhaHistorico[] = [], falhar?: "leads" | "whatsapp_outbox") {
  const pedidos: { url: URL; metodo: string }[] = [];
  const db = createClient("https://qa.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const metodo = init?.method ?? "GET";
      pedidos.push({ url, metodo });
      assert.equal(metodo, "GET", "navegar nunca escreve nem solicita automação");
      const tabela = url.pathname.split("/").at(-1);
      assert.ok(tabela === "leads" || tabela === "whatsapp_outbox");
      if (tabela === falhar) return Response.json({ message: "falha simulada", code: "XX000" }, { status: 500 });
      const inicio = Number(url.searchParams.get("offset") ?? 0);
      const limite = Number(url.searchParams.get("limit") ?? 1000);
      if (tabela === "leads") {
        assert.equal(url.searchParams.get("order"), "created_at.desc,id.asc");
        const categoria = url.searchParams.get("categoria")?.slice(3);
        const desde = url.searchParams.get("created_at")?.slice(4);
        const termo = url.searchParams.get("nome_display")?.slice(7, -1).toLowerCase();
        const linhas = cartoes.filter(l => `eq.${l.status}` === url.searchParams.get("status") &&
          (!categoria || l.categoria === categoria) && (!desde || l.created_at >= desde) &&
          (!termo || l.nome_display?.toLowerCase().includes(termo)))
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
        return Response.json(linhas.slice(inicio, inicio + limite));
      }
      assert.ok(!url.searchParams.get("select")?.includes("mensagem"));
      const ids = url.searchParams.get("lead_id")!.slice(4, -1).split(",");
      return Response.json(historico.filter(l => ids.includes(l.lead_id)).slice(inicio, inicio + limite));
    } },
  });
  return { db, pedidos };
}

test("navega além dos 50 cartões e de 1.000 registros sem saltar para a próxima coluna", async () => {
  const cartoes = Array.from({ length: 1003 }, (_, i) => cartao(i + 1));
  cartoes.push(cartao(2000, { status: "enviado" }));
  const { db, pedidos } = banco(cartoes);
  const resultado = await lerNavegacaoLead(id(1001), normalizarFiltrosNavegacao(), agora, db);
  assert.equal(resultado.erro, null);
  assert.equal(resultado.atualIncluido, true);
  assert.equal(resultado.anterior?.id, id(1000));
  assert.equal(resultado.proximo?.id, id(1002));
  assert.deepEqual(pedidos.filter(p => p.url.searchParams.get("status") === "eq.incompleto")
    .map(p => Number(p.url.searchParams.get("offset"))), [0, 200, 400, 600, 800, 1000]);
  const ultimo = await lerNavegacaoLead(id(1003), normalizarFiltrosNavegacao(), agora, db);
  assert.equal(ultimo.proximo?.id, id(2000));
  assert.equal(ultimo.proximo?.status, "enviado");
});

test("contexto conserva busca, categoria e meia-noite de São Paulo em todas as consultas", async () => {
  const cartoes = [cartao(1), cartao(2, { categoria: "corporativo" }), cartao(3, { nome_display: "Outro" }),
    cartao(4, { created_at: "2026-10-23T02:59:59.999Z" }), cartao(5, { status: "esfriou" })];
  const { db, pedidos } = banco(cartoes);
  const resultado = await lerNavegacaoLead(id(1), normalizarFiltrosNavegacao({
    q: "  Fixture  ", categoria: "casamento", periodo: "hoje",
  }), agora, db);
  assert.equal(resultado.erro, null);
  assert.equal(resultado.anterior, null);
  assert.equal(resultado.proximo?.id, id(5));
  for (const { url } of pedidos.filter(p => p.url.pathname.endsWith("/leads"))) {
    assert.equal(url.searchParams.get("nome_display"), "ilike.%Fixture%");
    assert.equal(url.searchParams.get("categoria"), "eq.casamento");
    assert.equal(url.searchParams.get("created_at"), "gte.2026-10-23T03:00:00.000Z");
  }
  const fora = await lerNavegacaoLead(id(2), normalizarFiltrosNavegacao({ categoria: "casamento" }), agora, db);
  assert.equal(fora.atualIncluido, false);
  assert.equal(fora.erro, null);
  assert.equal(fora.proximo, null);
});

test("Esfriou conserva prioridade real do histórico antes da chegada, inclusive depois dos 50", async () => {
  const enviado = new Date(agora - 40 * DIA).toISOString();
  const cartoes = Array.from({ length: 72 }, (_, i) => cartao(i + 1, { status: "esfriou", enviado_em: enviado }));
  const historico = cartoes.filter(l => l.id !== id(71)).map(l => ({
    lead_id: l.id, tipo: "lembrete_proposta_7d", estado: "enviado",
    enviado_em: new Date(agora - (l.id === id(72) ? 20 : 1) * DIA).toISOString(),
    ocorrido_em: new Date(agora - DIA).toISOString(), proposta_enviado_em: enviado, ultimo_codigo: null,
  }));
  const { db } = banco(cartoes, historico);
  const resultado = await lerNavegacaoLead(id(72), normalizarFiltrosNavegacao(), agora, db);
  assert.equal(resultado.erro, null);
  assert.equal(resultado.anterior, null);
  assert.equal(resultado.proximo?.id, id(71));
  const primeiro = await lerNavegacaoLead(id(71), normalizarFiltrosNavegacao(), agora, db);
  assert.equal(primeiro.anterior?.id, id(72));
  assert.equal(primeiro.proximo?.id, id(1));
});

test("prioridade de Esfriou também alcança um vermelho depois de 1.000 e cruza para a raia seguinte", async () => {
  const enviado = new Date(agora - 40 * DIA).toISOString();
  const cartoes = Array.from({ length: 1003 }, (_, i) => cartao(i + 1, { status: "esfriou", enviado_em: enviado }));
  cartoes.push(cartao(2000, { status: "perdido" }));
  const historico = cartoes.filter(l => l.status === "esfriou").map(l => ({
    lead_id: l.id, tipo: "lembrete_proposta_7d", estado: "enviado",
    enviado_em: new Date(agora - (l.id === id(1003) ? 20 : 1) * DIA).toISOString(),
    ocorrido_em: new Date(agora - DIA).toISOString(), proposta_enviado_em: enviado, ultimo_codigo: null,
  }));
  const { db, pedidos } = banco(cartoes, historico);
  const vermelho = await lerNavegacaoLead(id(1003), normalizarFiltrosNavegacao(), agora, db);
  assert.equal(vermelho.erro, null);
  assert.equal(vermelho.anterior, null);
  assert.equal(vermelho.proximo?.id, id(1));
  assert.deepEqual(pedidos.filter(p => p.url.searchParams.get("status") === "eq.esfriou")
    .map(p => Number(p.url.searchParams.get("offset"))), [0, 200, 400, 600, 800, 1000]);
  const ultimo = await lerNavegacaoLead(id(1002), normalizarFiltrosNavegacao(), agora, db);
  assert.equal(ultimo.proximo?.id, id(2000));
  assert.equal(ultimo.proximo?.status, "perdido");
});

test("falha de coluna ou de histórico não vira salto silencioso entre leads", async () => {
  for (const tabela of ["leads", "whatsapp_outbox"] as const) {
    const { db } = banco([cartao(1, { status: "esfriou" })], [], tabela);
    const resultado = await lerNavegacaoLead(id(1), normalizarFiltrosNavegacao(), agora, db);
    assert.equal(resultado.atualIncluido, false);
    assert.equal(resultado.anterior, null);
    assert.equal(resultado.proximo, null);
    assert.ok(resultado.erro);
    assert.ok(!resultado.erro.includes("XX000"));
  }
});
