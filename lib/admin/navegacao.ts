import { compararCartoesNaColuna } from "@/lib/admin/ordem";
import { ehPeriodo, type Periodo } from "@/lib/admin/periodo";
import type { LeadCartao } from "@/lib/admin/tipos";
import { isCategoria, STATUS, type Categoria, type Status } from "@/lib/form/types";

export type BuscaNavegacao = {
  q?: string | string[];
  categoria?: string | string[];
  periodo?: string | string[];
};

export type FiltrosNavegacao = { q: string; categoria?: Categoria; periodo: Periodo };
export type VizinhoLead = { id: string; nome: string | null; status: Status };
export type VizinhosLead = {
  anterior: VizinhoLead | null;
  proximo: VizinhoLead | null;
  /** Um acesso direto ou um lead movido pode ficar fora do filtro atual. */
  atualIncluido: boolean;
};

/** Os mesmos filtros do quadro, sem aceitar destinos arbitrários na URL. */
export function normalizarFiltrosNavegacao(busca: BuscaNavegacao = {}): FiltrosNavegacao {
  return {
    q: typeof busca.q === "string" ? busca.q.trim() : "",
    categoria: isCategoria(busca.categoria) ? busca.categoria : undefined,
    periodo: typeof busca.periodo === "string" && ehPeriodo(busca.periodo) ? busca.periodo : "todo",
  };
}

function parametrosDosFiltros(filtros: FiltrosNavegacao): string {
  const normalizados = normalizarFiltrosNavegacao(filtros);
  const params = new URLSearchParams();
  if (normalizados.q) params.set("q", normalizados.q);
  if (normalizados.categoria) params.set("categoria", normalizados.categoria);
  if (normalizados.periodo !== "todo") params.set("periodo", normalizados.periodo);
  const sufixo = params.toString();
  return sufixo ? `?${sufixo}` : "";
}

export function urlQuadroLeads(filtros: FiltrosNavegacao): string {
  return `/admin${parametrosDosFiltros(filtros)}`;
}

export function urlDetalheLead(id: string, filtros: FiltrosNavegacao): string {
  // UUIDs são os únicos segmentos de detalhe; o contexto só vira query string.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Identificador de lead inválido.");
  }
  return `/admin/leads/${id}${parametrosDosFiltros(filtros)}`;
}

/**
 * A sequência considera todas as raias: topo até o fim de uma coluna, depois
 * topo da seguinte. Não altera os cartões nem limita a navegação aos 50 visíveis.
 */
export function vizinhosNaSequencia(
  id: string,
  cartoes: readonly LeadCartao[],
  agoraMs: number,
): VizinhosLead {
  const unicos = [...new Map(cartoes.map(cartao => [cartao.id, cartao])).values()];
  const sequencia = STATUS.flatMap(status => unicos.filter(cartao => cartao.status === status)
    .sort((a, b) => compararCartoesNaColuna(a, b, status, agoraMs)));
  const indice = sequencia.findIndex(cartao => cartao.id === id);
  const resumir = (cartao: LeadCartao | undefined): VizinhoLead | null => cartao
    ? { id: cartao.id, nome: cartao.nome_display, status: cartao.status } : null;
  return indice < 0
    ? { anterior: null, proximo: null, atualIncluido: false }
    : { anterior: resumir(sequencia[indice - 1]), proximo: resumir(sequencia[indice + 1]), atualIncluido: true };
}
