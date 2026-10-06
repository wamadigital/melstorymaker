import type { Lead } from "@/lib/form/types";

/**
 * Colunas que o quadro precisa de cada lead. Existe como constante para o
 * `select` do Supabase e o `Pick` do TypeScript nao divergirem: antes a lista
 * estava escrita duas vezes na mesma pagina, e nada avisaria se uma mudasse.
 *
 * Coluna nova aqui precisa existir no banco ANTES do deploy: o select pede
 * todas de uma vez, e uma que falte derruba as cinco raias do quadro.
 */
export const COLUNAS_CARTAO =
  "id, created_at, categoria, status, nome_display, data_evento, passo_atual, enviado_em, " +
  "lembrete_7_em, lembrete_30_em, lembrete_email_em, chamado_whatsapp_em, pdf_url, whatsapp, email";

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
  | "lembrete_email_em"
  | "chamado_whatsapp_em"
  | "pdf_url"
  | "whatsapp"
  | "email"
>;
