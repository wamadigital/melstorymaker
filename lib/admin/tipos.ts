import type { Lead } from "@/lib/form/types";

/**
 * Colunas que o quadro precisa de cada lead. Existe como constante para o
 * `select` do Supabase e o `Pick` do TypeScript nao divergirem: antes a lista
 * estava escrita duas vezes na mesma pagina, e nada avisaria se uma mudasse.
 */
export const COLUNAS_CARTAO =
  "id, created_at, categoria, status, nome_display, data_evento, passo_atual, enviado_em, " +
  "lembrete_7_em, lembrete_30_em, pdf_url, whatsapp, email";

export type LeadCartao = Pick<
  Lead,
  | "id"
  | "created_at"
  | "categoria"
  | "status"
  | "nome_display"
  | "data_evento"
  | "passo_atual"
  | "enviado_em"
  | "lembrete_7_em"
  | "lembrete_30_em"
  | "pdf_url"
  | "whatsapp"
  | "email"
>;
