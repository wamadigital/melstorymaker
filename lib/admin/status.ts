import type { Status } from "@/lib/form/types";

/**
 * Regras de movimentacao do quadro de leads.
 *
 * Sem `server-only` de proposito: o servidor DECIDE (a rota recusa com 422) e o
 * cliente usa as mesmas funcoes para desabilitar o item de menu e recusar o drop
 * antes de disparar request. Uma regra, dois usos, zero divergencia.
 */

/**
 * REGRA DURA: nada volta para `incompleto`.
 *
 * `incompleto` nao e so uma raia do funil -- e a unica que devolve permissao de
 * ESCRITA a quem tiver o UUID do lead. Reabrir significa:
 *
 *   a) `PATCH /api/leads/[id]` (autosave publico, sem sessao) volta a aceitar e
 *      sobrescrever respostas que a Mel ja revisou;
 *   b) `POST /api/leads/[id]/submit` volta a passar pelo guard e dispara
 *      `notificarMel()` de novo -- ela recebe "lead novo" no WhatsApp por um
 *      lead que ela mesma moveu.
 *
 * Corrigir uma resposta depois do submit ja tem caminho proprio e seguro: o
 * PATCH do painel aceita lead em QUALQUER status.
 */
export const DESTINOS_PROIBIDOS: readonly Status[] = ["incompleto"];

/**
 * REGRA MACIA: "Enviado" sem PDF seria um badge mentindo -- nao existe o que
 * possa ter sido enviado. Uma linha para o dono relaxar, se um dia quiser.
 *
 * `virou_cliente` NAO entra aqui: da para fechar negocio no telefone antes de
 * qualquer proposta formal, e travar isso impediria a Mel de registrar a
 * realidade dela.
 */
export const EXIGE_PROPOSTA: readonly Status[] = ["enviado"];

export type MotivoRecusa = "destino_travado" | "sem_proposta" | "mesmo_status";

export function recusarMovimento(
  de: Status,
  para: Status,
  ctx: { temProposta: boolean },
): MotivoRecusa | null {
  if (de === para) return "mesmo_status";
  if (DESTINOS_PROIBIDOS.includes(para)) return "destino_travado";
  if (EXIGE_PROPOSTA.includes(para) && !ctx.temProposta) return "sem_proposta";
  return null;
}

export const MENSAGEM_RECUSA: Record<Exclude<MotivoRecusa, "mesmo_status">, string> = {
  destino_travado:
    "Esse lead já enviou o formulário e não volta para Novo. Para corrigir uma resposta, abra o lead e edite por lá.",
  sem_proposta: "Gere a proposta antes de marcar como enviada.",
};
