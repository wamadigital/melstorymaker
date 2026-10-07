import type { Lead } from "@/lib/form/types";
import { DIAS_LEMBRETE_1 } from "@/lib/admin/lembretes";

/**
 * "Esfriou": o lead fica em "Enviado" por no maximo uma semana e depois vai
 * sozinho para a coluna "Esfriou". Fluxo do owner, revisto em 07/10/2026:
 *
 *   Aguardando revisao  a Mel entra em contato e move o cartao para Enviado
 *   dia 0   Enviado, cartao branco
 *   dia 7   -> Esfriou (cinza), com "Relembrar cliente" (lembretes.ts)
 *   dia 30  no Esfriou o cartao fica VERMELHO, com "Ultima tentativa"; quem
 *           move para "Lead perdido" continua sendo a Mel
 *
 * A semana conta do envio E do ultimo update, as duas coisas: no fluxo normal
 * (a Mel move para Enviado e deixa) sao exatamente 7 dias. O `updated_at`
 * entra por causa de quem VOLTA: o cartao que a Mel traz do Esfriou para
 * Enviado (o cliente respondeu) tem `enviado_em` antigo e voltaria para o
 * Esfriou na hora; a propria mudanca carimba `updated_at`, e ele ganha mais uma
 * semana. Editar ou regerar a proposta com o lead em Enviado tambem estende --
 * e o cartao que passar dos 7 dias assim aparece azul-claro com "Relembrar
 * cliente" em Enviado mesmo, para nao ficar parado sem aviso.
 *
 * O trigger `set_updated_at` carimba toda mudanca na linha, e com o lead em
 * Enviado so acao da Mel escreve nele: por isso nao precisa de coluna nova.
 *
 * E a UNICA transicao de status que o sistema faz sozinho. "Lead perdido"
 * continua sendo decisao da Mel (RF-21). Quem executa e `esfriarParados`
 * (`lib/supabase/esfriar.ts`), com a mesma conta desta funcao.
 */

/** O maximo que um lead fica em "Enviado" sem update: uma semana. */
export const DIAS_SEM_UPDATE = 7;

const DIA_MS = 86_400_000;

/** Os dois cortes da regra, em ISO, prontos para o filtro do banco. */
export function cortesDeEsfriar(agoraMs: number): { enviadoAte: string; paradoDesde: string } {
  return {
    // O mesmo marco do "Relembrar cliente": esfria quando a cobranca vence.
    enviadoAte: new Date(agoraMs - DIAS_LEMBRETE_1 * DIA_MS).toISOString(),
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
