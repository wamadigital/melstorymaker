import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { normalizarFiltrosNavegacao, urlDetalheLead, urlQuadroLeads } from "@/lib/admin/navegacao";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";
import { linkSaiDaPagina } from "./contrato/estado";
import type { NavegacaoNoDetalhe } from "./NavegacaoLeads";

type Elemento = { type: string; props: { children?: unknown; [key: string]: unknown } };
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const fonte = ts.transpileModule(readFileSync(new URL("./NavegacaoLeads.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function montar(extra: Partial<NavegacaoNoDetalhe> = {}, bloqueio?: string): Elemento {
  const mod: { exports: { NavegacaoLeads?: (p: { navegacao: NavegacaoNoDetalhe; bloqueio?: string }) => Elemento } } = { exports: {} };
  const jsx = (type: string, props: Elemento["props"]) => ({ type, props });
  runInNewContext(fonte, {
    exports: mod.exports,
    require(nome: string) {
      if (nome === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (nome === "next/link") return { default: "Link" };
      if (nome === "lucide-react") return { ArrowLeft: "ArrowLeft", ChevronLeft: "ChevronLeft", ChevronRight: "ChevronRight" };
      if (nome === "@/lib/admin/rotulos") return { ROTULO_STATUS };
      if (nome === "@/lib/admin/navegacao") return { urlDetalheLead, urlQuadroLeads };
      throw new Error(`Importação inesperada no teste: ${nome}`);
    },
  });
  return mod.exports.NavegacaoLeads!({ navegacao: {
    anterior: { id: id(1), nome: "Anterior fictício", status: "incompleto" },
    proximo: { id: id(3), nome: "Próximo fictício", status: "enviado" },
    atualIncluido: true, erro: null, filtros: normalizarFiltrosNavegacao(), ...extra,
  }, bloqueio });
}

function elementos(elemento: unknown): Elemento[] {
  if (Array.isArray(elemento)) return elemento.flatMap(elementos);
  if (!elemento || typeof elemento !== "object" || !("props" in elemento)) return [];
  const e = elemento as Elemento;
  return [e, ...elementos(e.props.children)];
}
function texto(elemento: unknown): string {
  if (typeof elemento === "string") return elemento;
  if (Array.isArray(elemento)) return elemento.map(texto).join("");
  if (elemento && typeof elemento === "object" && "props" in elemento) return texto((elemento as Elemento).props.children);
  return "";
}
function seta(elemento: Elemento, rotulo: "Lead anterior" | "Próximo lead"): Elemento {
  const resultado = elementos(elemento).find(e => e.props["aria-label"] === rotulo);
  assert.ok(resultado);
  return resultado;
}

test("links reais preservam contexto, anunciam lead/coluna e não antecipam carregamentos", () => {
  const filtros = normalizarFiltrosNavegacao({ q: "Ana & João?next=https://externo.invalid/#abc", categoria: "casamento", periodo: "semana" });
  const arvore = montar({ filtros });
  const links = elementos(arvore).filter(e => e.type === "Link");
  assert.equal(links.length, 3);
  for (const link of links) {
    assert.equal(link.props.prefetch, false);
    const destino = new URL(String(link.props.href), "https://melstorymaker.com.br");
    assert.equal(destino.searchParams.get("q"), filtros.q);
    assert.equal(destino.searchParams.get("categoria"), "casamento");
    assert.equal(destino.searchParams.get("periodo"), "semana");
    assert.equal(destino.searchParams.get("next"), null);
    assert.equal(destino.hash, "");
  }
  assert.equal(new URL(String(links[0].props.href), "https://melstorymaker.com.br").pathname, "/admin");
  assert.equal(seta(arvore, "Lead anterior").props.href, urlDetalheLead(id(1), filtros));
  assert.equal(seta(arvore, "Próximo lead").props.href, urlDetalheLead(id(3), filtros));
  assert.equal(seta(arvore, "Lead anterior").props.title, "Lead anterior: Anterior fictício · Novo");
  assert.equal(seta(arvore, "Próximo lead").props.title, "Próximo lead: Próximo fictício · Enviado");
  assert.ok(elementos(arvore).some(e => e.type === "nav" && e.props["aria-label"] === "Navegar entre leads"));
});

test("extremos desabilitam somente a seta sem vizinho e não circulam a sequência", () => {
  const primeiro = montar({ anterior: null });
  assert.equal(seta(primeiro, "Lead anterior").type, "button");
  assert.equal(seta(primeiro, "Lead anterior").props.disabled, true);
  assert.equal(seta(primeiro, "Lead anterior").props.href, undefined);
  assert.equal(seta(primeiro, "Lead anterior").props.title, "Primeiro lead da sequência");
  assert.equal(seta(primeiro, "Próximo lead").type, "Link");
  const ultimo = montar({ proximo: null });
  assert.equal(seta(ultimo, "Próximo lead").type, "button");
  assert.equal(seta(ultimo, "Próximo lead").props.disabled, true);
  assert.equal(seta(ultimo, "Próximo lead").props.title, "Último lead da sequência");
  assert.equal(seta(ultimo, "Lead anterior").type, "Link");
  const unico = montar({ anterior: null, proximo: null });
  assert.equal(elementos(unico).filter(e => e.type === "button" && e.props.disabled).length, 2);
  assert.equal(elementos(unico).filter(e => e.props.role === "status").length, 0);
});

test("falha, filtro sem o lead e edição pendente retiram links e mostram a razão", () => {
  for (const caso of [
    { extra: { erro: "Falha ao ler a sequência." }, bloqueio: undefined, esperado: "Falha ao ler a sequência." },
    { extra: { atualIncluido: false }, bloqueio: undefined, esperado: "Este lead está fora dos filtros da lista." },
    { extra: { erro: "Falha ao ler a sequência." }, bloqueio: "Salve as respostas para navegar entre leads.", esperado: "Salve as respostas para navegar entre leads." },
    { extra: {}, bloqueio: "Aguarde a ação em andamento para navegar entre leads.", esperado: "Aguarde a ação em andamento para navegar entre leads." },
  ]) {
    const arvore = montar(caso.extra, caso.bloqueio);
    for (const rotulo of ["Lead anterior", "Próximo lead"] as const) {
      assert.equal(seta(arvore, rotulo).type, "button");
      assert.equal(seta(arvore, rotulo).props.disabled, true);
      assert.equal(seta(arvore, rotulo).props.href, undefined);
      assert.equal(seta(arvore, rotulo).props.title, caso.esperado);
    }
    assert.equal(texto(elementos(arvore).find(e => e.props.role === "status")), caso.esperado);
    const volta = elementos(arvore).filter(e => e.type === "Link");
    assert.equal(volta.length, 1);
    assert.equal(volta[0].props.href, "/admin");
  }
});

test("vizinho sem nome mantém acesso e identifica a coluna de destino", () => {
  const arvore = montar({ proximo: { id: id(3), nome: null, status: "esfriou" } });
  assert.equal(seta(arvore, "Próximo lead").type, "Link");
  assert.equal(seta(arvore, "Próximo lead").props.title, "Próximo lead: Sem nome · Esfriou");
});

test("links das setas permanecem sujeitos à captura existente de alterações não salvas do contrato", () => {
  const arvore = montar({ filtros: normalizarFiltrosNavegacao({ q: "Fixture", categoria: "casamento" }) });
  for (const link of elementos(arvore).filter(e => e.type === "Link")) {
    assert.equal(link.props.onClick, undefined, "a navegação permanece um link interno capturável");
    assert.equal(linkSaiDaPagina({ href: String(link.props.href), target: null, download: false,
      atual: `https://melstorymaker.com.br/admin/leads/${id(2)}?q=Fixture&categoria=casamento`,
      botao: 0, modificador: false }), true);
  }
});
