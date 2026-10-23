import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizarFiltrosNavegacao, urlDetalheLead, urlQuadroLeads, vizinhosNaSequencia } from "./navegacao";
import type { LeadCartao } from "./tipos";

const agora = Date.parse("2026-10-23T18:00:00Z");
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const cartao = (n: number, status: LeadCartao["status"]): LeadCartao => ({
  id: id(n), created_at: new Date(agora - n * 60_000).toISOString(), status, categoria: "casamento",
  nome_display: `Fixture ${n}`, data_evento: null, passo_atual: null, enviado_em: null,
  lembrete_7_em: null, lembrete_30_em: null, lembrete_email_em: null, chamado_whatsapp_em: null,
  qualificado_em: null, pdf_url: null, whatsapp: null, email: null,
});

test("normaliza apenas filtros conhecidos, sem aceitar listas ambíguas da URL", () => {
  assert.deepEqual(normalizarFiltrosNavegacao({ q: "  Maria & João  ", categoria: "casamento", periodo: "semana" }),
    { q: "Maria & João", categoria: "casamento", periodo: "semana" });
  assert.deepEqual(normalizarFiltrosNavegacao({ q: ["Ana", "Bia"], categoria: "externo", periodo: "ano" }),
    { q: "", categoria: undefined, periodo: "todo" });
});

test("links internos preservam os filtros sem interpretar query ou fragmento injetados", () => {
  const filtros = normalizarFiltrosNavegacao({ q: "Ana & João?next=https://externo.invalid/#abc", categoria: "casamento", periodo: "hoje" });
  const href = urlDetalheLead(id(1), filtros);
  const url = new URL(href, "https://melstorymaker.com.br");
  assert.equal(url.pathname, `/admin/leads/${id(1)}`);
  assert.equal(url.searchParams.get("q"), filtros.q);
  assert.equal(url.searchParams.get("categoria"), "casamento");
  assert.equal(url.searchParams.get("periodo"), "hoje");
  assert.equal(url.searchParams.get("next"), null);
  assert.equal(url.hash, "");
  assert.equal(urlQuadroLeads(normalizarFiltrosNavegacao()), "/admin");
  assert.throws(() => urlDetalheLead("../../login?next=https://externo.invalid", filtros));
});

test("avança e volta entre cartões, pula colunas vazias e não circula nos extremos", () => {
  const novos = [cartao(1, "incompleto"), cartao(2, "incompleto")];
  const esfriou = cartao(3, "esfriou");
  const perdido = cartao(4, "perdido");
  const entrada = [perdido, novos[1], esfriou, novos[0]];
  const resumir = (l: LeadCartao) => ({ id: l.id, nome: l.nome_display, status: l.status });
  assert.deepEqual(vizinhosNaSequencia(novos[0].id, entrada, agora), {
    anterior: null, proximo: resumir(novos[1]), atualIncluido: true,
  });
  assert.deepEqual(vizinhosNaSequencia(novos[1].id, entrada, agora), {
    anterior: resumir(novos[0]), proximo: resumir(esfriou), atualIncluido: true,
  });
  assert.deepEqual(vizinhosNaSequencia(esfriou.id, entrada, agora), {
    anterior: resumir(novos[1]), proximo: resumir(perdido), atualIncluido: true,
  });
  assert.deepEqual(vizinhosNaSequencia(perdido.id, entrada, agora), {
    anterior: resumir(esfriou), proximo: null, atualIncluido: true,
  });
  assert.deepEqual(vizinhosNaSequencia(id(99), entrada, agora), {
    anterior: null, proximo: null, atualIncluido: false,
  });
  assert.deepEqual(entrada.map(l => l.id), [perdido.id, novos[1].id, esfriou.id, novos[0].id]);
});
