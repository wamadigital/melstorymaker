import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { lerTestesWhatsApp } from "./testes-whatsapp";
import type { LeadCartao } from "@/lib/admin/tipos";

const agora = Date.parse("2026-10-15T18:00:00Z");
const lead = { id: "abf88ff2-ea34-4e32-994d-f7dc75df599b", nome_display: "TESTE HENRIQUE", whatsapp: "19988763916",
  enviado_em: "2026-09-10T18:00:00+00:00", pdf_url: "https://melstorymaker.com.br/p/abcd" } as LeadCartao;
const row = { lead_id: lead.id, marco: 30, proposta_enviado_em: lead.enviado_em,
  proposta_pdf_url: lead.pdf_url, expira_em: "2026-10-17T18:00:00+00:00" };
const cliente = (rows: unknown[], error = false) => createClient("https://test.invalid", "test-key", {
  global: { fetch: async () => new Response(JSON.stringify(error ? { message: "unavailable" } : rows), {
    status: error ? 503 : 200, headers: { "content-type": "application/json" },
  }) }, auth: { persistSession: false, autoRefreshToken: false },
});
test("UI recebe somente o marco e prazo do card validado na allowlist privada", async () => {
  const result = await lerTestesWhatsApp([lead], agora, cliente([row]));
  assert.deepEqual([...result], [[lead.id, { marco: 30, expiraEm: row.expira_em }]]);
  assert.ok(!JSON.stringify([...result]).includes(lead.whatsapp!));
  for (const whatsapp of ["5519988763916", "+55 (19) 98876-3916"]) {
    assert.equal((await lerTestesWhatsApp([{ ...lead, whatsapp }], agora, cliente([row]))).size, 1);
  }
});
test("dados alterados, revisao diferente, cadastro ausente e falha de leitura nao liberam teste", async () => {
  for (const item of [{ ...row, marco: 7 }, { ...row, proposta_enviado_em: "2026-09-10T18:00:00.000001+00:00" },
    { ...row, proposta_pdf_url: "https://melstorymaker.com.br/p/efgh" }, { ...row, expira_em: "2026-10-18T18:00:00Z" }]) {
    assert.equal((await lerTestesWhatsApp([lead], agora, cliente([item]))).size, 0);
  }
  for (const item of [{ ...lead, whatsapp: "19988763917" }, { ...lead, nome_display: "Cliente real" },
    { ...lead, id: "10000000-0000-4000-8000-000000000001" }]) {
    assert.equal((await lerTestesWhatsApp([item], agora, cliente([row]))).size, 0);
  }
  assert.equal((await lerTestesWhatsApp([lead], agora, cliente([]))).size, 0);
  assert.equal((await lerTestesWhatsApp([lead], agora, cliente([], true))).size, 0);
  assert.equal((await lerTestesWhatsApp([lead], Date.parse(row.expira_em), cliente([row]))).size, 0);
});
