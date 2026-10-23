import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { lerEsfriouPrioritario } from "./esfriou-prioritario";
import type { LeadCartao } from "@/lib/admin/tipos";
import { filtroBuscaLeads } from "./busca-leads";

const DIA = 86_400_000;
const agoraMs = Date.parse("2026-10-15T18:00:00Z");
const id = (i: number) => `10000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
const enviado = new Date(agoraMs - 8 * DIA).toISOString();
const card = (i: number): LeadCartao => ({
  id: id(i), created_at: new Date(agoraMs - i * 60_000).toISOString(), categoria: "casamento", status: "esfriou",
  nome_display: `Fixture ${i}`, data_evento: "2026-11-15", passo_atual: null, enviado_em: enviado,
  lembrete_7_em: null, lembrete_30_em: null, lembrete_email_em: null, chamado_whatsapp_em: null,
  qualificado_em: null, pdf_url: "https://example.invalid/p/abcd", whatsapp: "19900000000", email: null,
});
test("vermelho antigo entra antes do limite visual mesmo depois de mais de duas paginas", async () => {
  const cards = Array.from({ length: 401 }, (_, i) => card(i + 1));
  const vermelho = cards[400]; vermelho.enviado_em = new Date(agoraMs - 45 * DIA).toISOString();
  const primeiro = cards[300];
  const pedidos: URL[] = [];
  const db = createClient("https://qa.invalid", "test-key", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); pedidos.push(url);
      assert.equal(url.searchParams.get("select")?.includes("mensagem"), false);
      if (url.pathname.endsWith("/leads")) {
        assert.equal(url.searchParams.get("status"), "eq.esfriou");
        assert.equal(url.searchParams.get("categoria"), "eq.casamento");
        assert.equal(url.searchParams.get("or"), `(${filtroBuscaLeads("Fixture")})`);
        assert.equal(url.searchParams.get("created_at"), "gte.2026-01-01T00:00:00Z");
        const inicio = Number(url.searchParams.get("offset") ?? 0);
        const limite = Number(url.searchParams.get("limit") ?? 200);
        return new Response(JSON.stringify(cards.slice(inicio, inicio + limite)), { headers: {
          "content-type": "application/json", "content-range": `${inicio}-${Math.min(inicio + limite, cards.length) - 1}/${cards.length}`,
        } });
      }
      assert.ok(url.pathname.endsWith("/whatsapp_outbox"));
      const ids = url.searchParams.get("lead_id")!.slice(4, -1).split(",");
      const rows = cards.filter(l => ids.includes(l.id) && l.id !== primeiro.id).map(l => ({
        lead_id: l.id, tipo: "lembrete_proposta_7d", estado: "enviado", ocorrido_em: new Date(agoraMs - DIA).toISOString(),
        enviado_em: new Date(agoraMs - (l.id === vermelho.id ? 20 : 1) * DIA).toISOString(),
        proposta_enviado_em: l.enviado_em, ultimo_codigo: null,
      }));
      return Response.json(rows);
    } },
  });
  const result = await lerEsfriouPrioritario({ termo: "Fixture", categoria: "casamento",
    desde: "2026-01-01T00:00:00Z", agoraMs, limite: 50 }, db);
  assert.equal(result.error, null);
  assert.equal(result.count, 401);
  assert.equal(result.data!.length, 50);
  assert.deepEqual(result.data!.slice(0, 3).map(l => l.id), [vermelho.id, primeiro.id, cards[0].id]);
  assert.equal(new Set(result.data!.map(l => l.id)).size, 50);
  assert.equal(result.erroDisparos, false);
  assert.equal(pedidos.filter(u => u.pathname.endsWith("/leads")).length, 3);
  assert.ok(pedidos.filter(u => u.pathname.endsWith("/whatsapp_outbox")).every(u => u.searchParams.get("lead_id")!.length < 4000));
});
