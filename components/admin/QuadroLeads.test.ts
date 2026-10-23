import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ComponentProps } from "react";
import type { QuadroLeads } from "./QuadroLeads";
import type { ColunaKanbanDados } from "../../lib/admin/paginacao-kanban";
import type { LeadCartao } from "../../lib/admin/tipos";
import { urlDetalheLead } from "../../lib/admin/navegacao";
import { compararCartoesNaColuna } from "../../lib/admin/ordem";
import * as regrasStatus from "../../lib/admin/status";
import { STATUS, type Status } from "../../lib/form/types";

type Props = ComponentProps<typeof QuadroLeads>;
type Elemento = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
type EstadoPaginado = {
  colunas: Props["colunas"];
  agoraMs: number;
  carregando: Partial<Record<Status, boolean>>;
  errosCarga: Partial<Record<Status, string>>;
  carregarMais: (status: Status) => void;
};
const fonte = ts.transpileModule(readFileSync(new URL("./QuadroLeads.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function lead(numero: number): LeadCartao {
  return {
    id: `00000000-0000-4000-8000-${String(numero).padStart(12, "0")}`,
    nome_display: `Cliente fictício ${numero}`, categoria: "casamento", status: "enviado",
    created_at: "2026-10-23T12:00:00.000Z", data_evento: "2027-10-23",
    enviado_em: "2026-10-22T12:00:00.000Z", pdf_url: "proposta-ficticia.pdf",
    passo_atual: null, qualificado_em: null, lembrete_7_em: null, lembrete_30_em: null,
    lembrete_email_em: null, chamado_whatsapp_em: null, whatsapp: null, email: null,
  };
}

function elementos(arvore: unknown): Elemento[] {
  if (Array.isArray(arvore)) return arvore.flatMap(elementos);
  if (!arvore || typeof arvore !== "object" || !("props" in arvore)) return [];
  const elemento = arvore as Elemento;
  return [elemento, ...elementos(elemento.props.children)];
}

/** Renderiza a composição do quadro; fronteiras de rede, realtime e DnD são locais. */
function montar() {
  const slots: unknown[] = [];
  const efeitos: (() => void)[] = [];
  let indice = 0;
  const todos = Array.from({ length: 51 }, (_, posicao) => lead(posicao + 1));
  const colunas = Object.fromEntries(STATUS.map((status) => [status, {
    cartoes: status === "enviado" ? todos.slice(0, 50) : [], total: status === "enviado" ? 51 : 0,
    erro: null,
  } satisfies ColunaKanbanDados])) as Props["colunas"];
  const props: Props = {
    colunas, termo: "Cliente & teste", periodo: "mes", agoraMs: Date.parse("2026-10-23T12:00:00.000Z"),
    filtros: { q: "Cliente & teste", categoria: "casamento", periodo: "mes" },
  };
  let estado: EstadoPaginado = {
    colunas, agoraMs: props.agoraMs, carregando: {}, errosCarga: {},
    carregarMais(status) {
      assert.equal(status, "enviado");
      estado = { ...estado, colunas: { ...estado.colunas, enviado: {
        ...estado.colunas.enviado, cartoes: todos,
      } }, agoraMs: props.agoraMs + 60_000 };
    },
  };
  let paginacaoPausada = false;
  let tempoReal: { pausado: boolean; atrasoMs: number } | undefined;
  let leadsNoPrazo: string[] = [];
  let prazoAgoraMs: number | undefined;
  let atualizacoes = 0;
  const pedidos: { url: string; init: RequestInit }[] = [];
  const sucessos: string[] = [];
  const erros: string[] = [];
  const mod: { exports: { QuadroLeads?: (p: Props) => Elemento } } = { exports: {} };
  const jsx = (type: unknown, p: Elemento["props"]) => ({ type, props: p });
  runInNewContext(fonte, {
    exports: mod.exports,
    window: { confirm: () => true },
    async fetch(url: string, init: RequestInit) {
      pedidos.push({ url, init });
      return { ok: true, async json() { return {}; } };
    },
    require(nome: string) {
      if (nome === "react") return {
        useState<T>(inicial: T | (() => T)) {
          const posicao = indice++;
          if (!(posicao in slots)) slots[posicao] = typeof inicial === "function" ? (inicial as () => T)() : inicial;
          return [slots[posicao], (valor: T | ((anterior: T) => T)) => {
            slots[posicao] = typeof valor === "function" ? (valor as (anterior: T) => T)(slots[posicao] as T) : valor;
          }];
        },
        useMemo: <T>(calcular: () => T) => calcular(),
        useCallback: <T>(callback: T) => callback,
        useEffect(efeito: () => void) { efeitos.push(efeito); },
        useTransition: () => [false, (acao: () => void) => acao()],
      };
      if (nome === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (nome === "next/navigation") return { useRouter: () => ({ refresh() { atualizacoes++; } }) };
      if (nome === "@dnd-kit/core") return {
        DndContext: "DndContext", DragOverlay: "DragOverlay", MeasuringStrategy: { Always: "Always" },
        MouseSensor: "MouseSensor", TouchSensor: "TouchSensor", KeyboardSensor: "KeyboardSensor",
        closestCorners() {}, useSensor() {}, useSensors() { return []; },
        useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef() {}, isDragging: false }),
        useDroppable: () => ({ setNodeRef() {}, isOver: false }),
      };
      if (nome === "sonner") return { toast: { success: (valor: string) => sucessos.push(valor), error: (valor: string) => erros.push(valor) } };
      if (nome === "@/components/admin/CartaoLead") return { CartaoLead: "CartaoLead", ColunaVazia: "ColunaVazia" };
      if (nome === "@/components/admin/ColunaKanban") return { ColunaKanban: "ColunaKanban" };
      if (nome === "@/components/admin/FaixaDestinos") return { FaixaDestinos: "FaixaDestinos" };
      if (nome === "@/components/admin/useColunasPaginadas") return {
        useColunasPaginadas: (entrada: { pausado: boolean }) => { paginacaoPausada = entrada.pausado; return estado; },
      };
      if (nome === "@/components/admin/useQuadroAoVivo") return {
        useQuadroAoVivo: (entrada: typeof tempoReal) => { tempoReal = entrada; },
      };
      if (nome === "@/lib/admin/prazos-lembretes") return {
        atrasoProximaMudancaLembrete(cartoes: LeadCartao[], agoraMs: number) {
          leadsNoPrazo = cartoes.map((cartao) => cartao.id);
          prazoAgoraMs = agoraMs;
          return cartoes.some((cartao) => cartao.id === todos[50].id) ? 51_000 : 50_000;
        },
      };
      if (nome === "@/lib/admin/ordem") return { compararCartoesNaColuna };
      if (nome === "@/lib/admin/navegacao") return { urlDetalheLead };
      if (nome === "@/lib/admin/rotulos") return { ROTULO_STATUS: Object.fromEntries(STATUS.map((status) => [status, status])) };
      if (nome === "@/lib/admin/status") return regrasStatus;
      if (nome === "@/lib/admin/periodo") return { FRASE_PERIODO: { mes: "este mês" } };
      if (nome === "@/lib/form/types") return { STATUS };
      throw new Error(`Importação inesperada: ${nome}`);
    },
  });
  function expandir(arvore: unknown): unknown {
    if (Array.isArray(arvore)) return arvore.map(expandir);
    if (!arvore || typeof arvore !== "object" || !("props" in arvore)) return arvore;
    const elemento = arvore as Elemento;
    if (typeof elemento.type === "function") return expandir(elemento.type(elemento.props));
    return { ...elemento, props: { ...elemento.props, children: expandir(elemento.props.children) } };
  }
  function render() {
    indice = 0;
    const arvore = mod.exports.QuadroLeads!(props);
    for (const efeito of efeitos.splice(0)) efeito();
    return expandir(arvore);
  }
  return { render, props, pedidos, sucessos, erros,
    get paginacaoPausada() { return paginacaoPausada; },
    get tempoReal() { return tempoReal; },
    get leadsNoPrazo() { return leadsNoPrazo; },
    get prazoAgoraMs() { return prazoAgoraMs; },
    get atualizacoes() { return atualizacoes; },
  };
}

test("card 51 carregado entra na raia, preserva os filtros no detalhe e participa do próximo prazo", () => {
  const tela = montar();
  const inicial = tela.render();
  assert.equal(elementos(inicial).filter((elemento) => elemento.type === "CartaoLead").length, 50);
  assert.equal(tela.leadsNoPrazo.length, 50);
  const raia = elementos(inicial).find((elemento) => elemento.type === "ColunaKanban" && elemento.props.status === "enviado")!;
  (raia.props.onCarregarMais as () => void)();
  const carregado = tela.render();
  const cartoes = elementos(carregado).filter((elemento) => elemento.type === "CartaoLead");
  assert.equal(cartoes.length, 51);
  const novo = cartoes.find((elemento) => (elemento.props.lead as LeadCartao).id === lead(51).id)!;
  assert.equal(novo.props.hrefDetalhe, urlDetalheLead(lead(51).id, tela.props.filtros));
  assert.match(String(novo.props.hrefDetalhe), /q=Cliente\+%26\+teste&categoria=casamento&periodo=mes$/);
  assert.equal(tela.leadsNoPrazo.includes(lead(51).id), true);
  assert.equal(tela.prazoAgoraMs, tela.props.agoraMs + 60_000);
  assert.equal(tela.tempoReal?.atrasoMs, 51_000);
});

test("card de outra página pode ser movido pelo menu, com otimismo, sem perder a identidade", async () => {
  const tela = montar();
  const inicial = tela.render();
  const raia = elementos(inicial).find((elemento) => elemento.type === "ColunaKanban" && elemento.props.status === "enviado")!;
  (raia.props.onCarregarMais as () => void)();
  const cartao = elementos(tela.render()).find((elemento) => elemento.type === "CartaoLead" && (elemento.props.lead as LeadCartao).id === lead(51).id)!;
  await (cartao.props.onMover as (id: string, para: Status) => Promise<void>)(lead(51).id, "virou_cliente");
  assert.equal(tela.pedidos.length, 1);
  assert.equal(tela.pedidos[0].url, `/api/admin/leads/${lead(51).id}/status`);
  assert.equal(tela.pedidos[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(tela.pedidos[0].init.body)), { status: "virou_cliente", de: "enviado" });
  assert.equal(tela.atualizacoes, 1);
  assert.equal(tela.sucessos.length, 1);
  assert.deepEqual(tela.erros, []);
  const movido = elementos(tela.render()).find((elemento) => elemento.type === "CartaoLead" && (elemento.props.lead as LeadCartao).id === lead(51).id)!;
  assert.equal(movido.props.coluna, "virou_cliente");
});

test("arraste do card 51 mostra o overlay e pausa paginação e realtime até cancelar", () => {
  const tela = montar();
  const inicial = tela.render();
  const raia = elementos(inicial).find((elemento) => elemento.type === "ColunaKanban" && elemento.props.status === "enviado")!;
  (raia.props.onCarregarMais as () => void)();
  const carregado = tela.render();
  const dnd = elementos(carregado).find((elemento) => elemento.type === "DndContext")!;
  (dnd.props.onDragStart as (evento: { active: { id: string } }) => void)({ active: { id: lead(51).id } });
  const arrastando = tela.render();
  assert.equal(tela.paginacaoPausada, true);
  assert.equal(tela.tempoReal?.pausado, true);
  const sobreposto = elementos(arrastando).find((elemento) => elemento.type === "CartaoLead" && elemento.props.sobreposto)!;
  assert.equal((sobreposto.props.lead as LeadCartao).id, lead(51).id);
  assert.equal(sobreposto.props.hrefDetalhe, urlDetalheLead(lead(51).id, tela.props.filtros));
  assert.equal(elementos(arrastando).filter((elemento) => elemento.type === "ColunaKanban").every((elemento) => elemento.props.cargaPausada === true), true);
  (dnd.props.onDragCancel as () => void)();
  const cancelado = tela.render();
  assert.equal(tela.paginacaoPausada, false);
  assert.equal(tela.tempoReal?.pausado, false);
  assert.equal(elementos(cancelado).some((elemento) => elemento.type === "CartaoLead" && elemento.props.sobreposto), false);
  assert.equal(tela.pedidos.length, 0);
});
