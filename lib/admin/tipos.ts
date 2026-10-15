import type { Lead } from "@/lib/form/types";

/** Metadados de um envio confirmado pelo worker; nunca leva conteúdo ou contato. */
export type DisparoWhatsApp = {
  tipo: "confirmacao_recebimento" | "lembrete_formulario_24h" | "lembrete_proposta_7d" | "lembrete_proposta_30d";
  enviado_em: string;
  /** Revisão exata, somente para lembretes de proposta confirmados. */
  proposta_enviado_em?: string;
};

export type SolicitacaoWhatsApp = {
  tipo: "lembrete_proposta_7d" | "lembrete_proposta_30d";
  estado: "pendente" | "reservado" | "enviando" | "enviado" | "indeterminado" | "expirado" | "cancelado";
  ocorrido_em: string;
  proposta_enviado_em: string;
  /** Texto de uma lista fixa; nunca publica erro bruto do worker. */
  motivo: string | null;
};

/**
 * Colunas que o quadro precisa de cada lead. Existe como constante para o
 * `select` do Supabase e o `Pick` do TypeScript nao divergirem: antes a lista
 * estava escrita duas vezes na mesma pagina, e nada avisaria se uma mudasse.
 *
 * Coluna nova aqui precisa existir no banco ANTES do deploy: o select pede
 * todas de uma vez, e uma que falte derruba todas as raias do quadro.
 */
export const COLUNAS_CARTAO =
  "id, created_at, categoria, status, nome_display, data_evento, passo_atual, enviado_em, " +
  "lembrete_7_em, lembrete_30_em, lembrete_email_em, chamado_whatsapp_em, qualificado_em, pdf_url, whatsapp, email";

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
  | "qualificado_em"
  | "pdf_url"
  | "whatsapp"
  | "email"
> & {
  /** Resumo da fila privada, enriquecido no servidor depois da leitura das raias. */
  disparos_whatsapp?: DisparoWhatsApp[];
  solicitacoes_whatsapp?: SolicitacaoWhatsApp[];
};
