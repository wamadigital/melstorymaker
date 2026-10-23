import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ComponentProps } from "react";
import type { CartaoLead } from "./CartaoLead";
import { eventoPassado } from "../../lib/admin/evento-passado";

type Props = ComponentProps<typeof CartaoLead>;
type Elemento = { type: string; props: { children?: unknown; [key: string]: unknown } };
const fonte = ts.transpileModule(readFileSync(new URL("./CartaoLead.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function montar(extra: Partial<Props["lead"]> = {}, hrefDetalhe?: string, extraProps: Partial<Omit<Props, "lead">> = {}) {
  const slots: unknown[] = [];
  let indice = 0;
  let props: Props = {
    lead: {
      id: "00000000-0000-4000-8000-00000000f004", categoria: "casamento", status: "aguardando_revisao",
      created_at: "2026-10-23T12:00:00.000Z", nome_display: "Cliente fictício", data_evento: null,
      qualificado_em: null, passo_atual: null, enviado_em: null, lembrete_7_em: null,
      lembrete_30_em: null, lembrete_email_em: null, chamado_whatsapp_em: null,
      pdf_url: null, whatsapp: null, email: null, ...extra,
    },
    coluna: "aguardando_revisao", agoraMs: Date.parse("2026-10-23T12:00:00.000Z"),
    hrefDetalhe, onMover() {},
    ...extraProps,
  };
  const mod: { exports: { CartaoLead?: (p: Props) => Elemento } } = { exports: {} };
  const jsx = (type: string, props: Elemento["props"]) => ({ type, props });
  runInNewContext(fonte, {
    exports: mod.exports,
    require(nome: string) {
      if (nome === "react") return { useState<T>(inicial: T) {
        const posicao = indice++;
        if (!(posicao in slots)) slots[posicao] = inicial;
        return [slots[posicao], (valor: T) => { slots[posicao] = valor; }];
      } };
      if (nome === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (nome === "next/link") return { default: "Link" };
      if (nome === "lucide-react") return { CalendarCheck: "CalendarCheck", Check: "Check", FileText: "FileText", GripVertical: "GripVertical", Mail: "Mail" };
      if (nome.startsWith("@/components/admin/")) {
        const componente = nome.split("/").at(-1)!;
        return { [componente]: componente };
      }
      if (nome === "@/lib/admin/lembretes") return {
        estadoLembrete: () => ({ pendente: null, cobrado: null }), temaCobranca: () => null,
      };
      if (nome === "@/lib/admin/ordem") return { prioridadeEsfriou: () => 2 };
      if (nome === "@/lib/admin/lembrete-email") return { estadoLembreteEmail: () => ({ visivel: false }) };
      if (nome === "@/lib/admin/acoes") return { linkContatoInicial: () => null };
      if (nome === "@/lib/admin/evento-passado") return { eventoPassado };
      if (nome === "@/lib/admin/rotulos") return {
        TEMA_COLUNA: Object.fromEntries(["incompleto", "aguardando_revisao", "enviado", "virou_cliente", "esfriou", "perdido"].map((status) => [status, { barra: "cor-da-coluna" }])),
        rotuloCategoria: (categoria: string) => categoria, rotuloPasso: () => null,
      };
      if (nome === "@/lib/pdf/formatadores") return { dataHoraLocal: () => "23.10.2026", dataEvento: () => "31.08.2027" };
      if (nome === "@/lib/utils") return { cn: (...classes: unknown[]) => classes.filter(Boolean).join(" ") };
      throw new Error(`Importação inesperada no teste: ${nome}`);
    },
  });
  return {
    render(lead: Partial<Props["lead"]> = {}) {
      props = { ...props, lead: { ...props.lead, ...lead } };
      indice = 0;
      // Um ajuste de estado durante renderização exige a mesma segunda
      // passagem que o React faz antes de confirmar a árvore.
      mod.exports.CartaoLead!(props);
      indice = 0;
      return mod.exports.CartaoLead!(props);
    },
  };
}

function texto(elemento: unknown): string {
  if (typeof elemento === "string") return elemento;
  if (Array.isArray(elemento)) return elemento.map(texto).join("");
  if (elemento && typeof elemento === "object" && "props" in elemento) return texto((elemento as Elemento).props.children);
  return "";
}

function elementos(elemento: unknown): Elemento[] {
  if (Array.isArray(elemento)) return elemento.flatMap(elementos);
  if (!elemento || typeof elemento !== "object" || !("props" in elemento)) return [];
  const e = elemento as Elemento;
  return [e, ...elementos(e.props.children)];
}

test("casamento mostra os dois locais, em texto pequeno, preservando o detalhe", () => {
  const href = "/admin/leads/00000000-0000-4000-8000-00000000f004?categoria=casamento";
  const arvore = montar({ local_cerimonia: " Capela fictícia ", local_festa: " Salão fictício " }, href).render();
  assert.match(texto(arvore), /Cerimônia: Capela fictíciaFesta: Salão fictício/);
  const locais = elementos(arvore).find((e) => e.type === "div" && texto(e).startsWith("Cerimônia:"));
  assert.ok(locais);
  assert.match(String(locais.props.className), /text-\[0\.6875rem\]/);
  assert.equal(elementos(arvore).find((e) => e.type === "Link")?.props.href, href);
  assert.equal(elementos(arvore).find((e) => e.type === "AcoesLead")?.props.hrefDetalhe, href);
});

test("locais vazios não criam linhas e outras categorias não mostram campos de casamento", () => {
  assert.doesNotMatch(texto(montar({ local_cerimonia: "  ", local_festa: null }).render()), /Cerimônia:|Festa:/);
  for (const categoria of ["aniversario", "corporativo", "debutante"] as const) {
    assert.doesNotMatch(texto(montar({ categoria, local_cerimonia: "Capela fictícia", local_festa: "Salão fictício" }).render()), /Cerimônia:|Festa:/);
  }
  const apenasFesta = texto(montar({ local_festa: "Salão fictício" }).render());
  assert.doesNotMatch(apenasFesta, /Cerimônia:/);
  assert.match(apenasFesta, /Festa: Salão fictício/);
});

test("selo acompanha a confirmação do menu imediatamente e depois as props reais do servidor", () => {
  const tela = montar();
  const arvore = tela.render();
  assert.doesNotMatch(texto(arvore), /Lead qualificado/);
  const menu = elementos(arvore).find((e) => e.type === "AcoesLead");
  assert.ok(menu);
  const confirmar = menu.props.onQualificacaoAlterada as (marca: string | null) => void;
  confirmar("2026-10-23T12:01:00.000Z");
  assert.match(texto(tela.render()), /Lead qualificado/);
  assert.match(texto(tela.render({ qualificado_em: "2026-10-23T12:01:00.000Z" })), /Lead qualificado/);
  assert.doesNotMatch(texto(tela.render({ qualificado_em: null })), /Lead qualificado/);
});

test("evento passado em Lead perdido fica cinza e continua clicável, com menu e arraste", () => {
  const href = "/admin/leads/00000000-0000-4000-8000-00000000f004?categoria=casamento";
  const arvore = montar({ data_evento: "2026-10-22", status: "perdido" }, href, {
    coluna: "perdido", handle: { onPointerDown() {} },
  }).render();
  assert.equal(arvore.props["data-evento-encerrado"], true);
  assert.match(String(arvore.props.className), /bg-zinc-100/);
  assert.doesNotMatch(String(arvore.props.className), /opacity-|pointer-events-none/);
  assert.equal(arvore.props["aria-disabled"], undefined);
  assert.match(texto(arvore), /Evento encerrado/);
  const filhos = elementos(arvore);
  const link = filhos.find((e) => e.type === "Link");
  assert.equal(link?.props.href, href);
  assert.equal(link?.props.tabIndex, undefined);
  assert.equal(filhos.find((e) => e.type === "AcoesLead")?.props.ocupadoExterno, false);
  assert.equal(filhos.find((e) => e.type === "button")?.props.disabled, undefined);
});

test("cinza de evento encerrado não vaza para hoje, datas inválidas ou outras colunas", () => {
  for (const data_evento of ["2026-10-23", "2026-10-24", "2026-02-29", null]) {
    const arvore = montar({ data_evento, status: "perdido" }, undefined, { coluna: "perdido" }).render();
    assert.equal(arvore.props["data-evento-encerrado"], undefined);
    assert.doesNotMatch(texto(arvore), /Evento encerrado/);
  }
  for (const coluna of ["incompleto", "aguardando_revisao", "enviado", "virou_cliente", "esfriou"] as const) {
    const arvore = montar({ data_evento: "2026-10-22", status: coluna }, undefined, { coluna }).render();
    assert.equal(arvore.props["data-evento-encerrado"], undefined);
  }
});
