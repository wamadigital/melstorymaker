import type { Lead } from "@/lib/form/types";
import { DIAS_LEMBRETE_1 } from "@/lib/admin/lembretes";

/**
 * "Esfriou": o lead de "Enviado" que ficou uma semana parado vai sozinho para a
 * coluna "Esfriou". Pedido do owner em 07/10/2026, na regra que ele escolheu:
 *
 *   dia 0   proposta enviada            -> Enviado, cartao branco
 *   dia 7   passou do prazo             -> Enviado, cartao azul-claro com
 *                                          "Relembrar cliente" (lembretes.ts)
 *   +7 dias sem NENHUM update no lead   -> Esfriou (cinza)
 *   dia 30  "Ultima tentativa" aparece no Esfriou; quem move para "Lead
 *           perdido" continua sendo a Mel
 *
 * Ou seja: vai para Esfriou quando ja passou do prazo da cobranca E faz uma
 * semana que ninguem mexe nele -- 14 dias do envio para quem nunca foi tocado,
 * mais para quem a Mel cobrou (cobrou no dia 9, esfria no 16).
 *
 * O "update" e o `updated_at`: o trigger `set_updated_at` carimba toda mudanca
 * na linha -- cobrar no WhatsApp, mover o cartao, editar respostas, regerar ou
 * reenviar a proposta. Com o lead em "Enviado", so acao da Mel escreve nele,
 * entao o "nenhum update" do pedido sai de graca, sem coluna nova e sem
 * carimbar a mao em cada rota. Voltar um cartao de "Esfriou" para "Enviado"
 * (o cliente respondeu) tambem e update: ganha mais uma semana.
 *
 * E a UNICA transicao de status que o sistema faz sozinho. "Lead perdido"
 * continua sendo decisao da Mel (RF-21). Quem executa e `esfriarParados`
 * (`lib/supabase/esfriar.ts`), com a mesma conta desta funcao.
 */

/** Semana sem update que faz o lead esfriar, depois do prazo da cobranca. */
export const DIAS_SEM_UPDATE = 7;

const DIA_MS = 86_400_000;

/** Os dois cortes da regra, em ISO, prontos para o filtro do banco. */
export function cortesDeEsfriar(agoraMs: number): { enviadoAte: string; paradoDesde: string } {
  return {
    enviadoAte: new Date(agoraMs - (DIAS_LEMBRETE_1 + DIAS_SEM_UPDATE) * DIA_MS).toISOString(),
    paradoDesde: new Date(agoraMs - DIAS_SEM_UPDATE * DIA_MS).toISOString(),
  };
}

/** Este lead deve ir para "Esfriou" agora? */
export function deveEsfriar(
  lead: Pick<Lead, "status" | "enviado_em" | "updated_at">,
  agoraMs: number,
): boolean {
  if (lead.status !== "enviado" || !lead.enviado_em) return false;
  const enviado = Date.parse(lead.enviado_em);
  const atualizado = Date.parse(lead.updated_at);
  if (Number.isNaN(enviado) || Number.isNaN(atualizado)) return false;
  const { enviadoAte, paradoDesde } = cortesDeEsfriar(agoraMs);
  return enviado <= Date.parse(enviadoAte) && atualizado <= Date.parse(paradoDesde);
}
