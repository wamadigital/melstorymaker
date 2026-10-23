import type { LeadCartao } from "@/lib/admin/tipos";

/** Cada coluna revela mais um lote ao chegar ao fim da lista visível. */
export const TAMANHO_LOTE_KANBAN = 50;

export type ColunaKanbanDados = {
  cartoes: LeadCartao[];
  total: number;
  erro: string | null;
  erroDisparos?: boolean;
};
