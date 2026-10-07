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
 * "Esfriou" pelo mesmo motivo: so esfria quem recebeu uma proposta.
 *
 * `virou_cliente` NAO entra aqui: da para fechar negocio no telefone antes de
 * qualquer proposta formal, e travar isso impediria a Mel de registrar a
 * realidade dela.
 */
export const EXIGE_PROPOSTA: readonly Status[] = ["enviado", "esfriou"];

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

// ---------------------------------------------------- atalhos do detalhe --

/**
 * Os destinos para onde o detalhe do lead move sem arrastar (pedido do owner em
 * 03/10/2026). Sao os tres que a Mel decide depois de olhar o lead -- "Novo" e
 * travado (ver acima) e "Aguardando revisao" e consequencia do submit, nao
 * decisao. Desde 07/10/2026 eles nao aparecem mais lado a lado: `enviado` e
 * `virou_cliente` sao o PROXIMO PASSO (um botao so, ver `proximoPasso`), e
 * `perdido` e a saida do funil, com botao proprio no canto do cabecalho.
 */
export const ATALHOS_STATUS = ["enviado", "virou_cliente", "perdido"] as const satisfies readonly Status[];
export type AtalhoStatus = (typeof ATALHOS_STATUS)[number];

/**
 * O passo seguinte do funil, o botao verde do detalhe do lead (pedido do owner
 * em 07/10/2026: tres botoes lado a lado confundiam, e a Mel quer ver so o que
 * vem a seguir). O funil e uma linha -- Novo, Aguardando revisao, Enviado,
 * Virou cliente -- e "Lead perdido" e a saida dele, nunca um passo.
 *
 * - De "Novo" o passo e "Enviado", e nao "Aguardando revisao": revisao e
 *   consequencia do submit (ver `ATALHOS_STATUS`). Sem proposta o botao aparece
 *   travado, com a frase da recusa, e isso ja diz o que falta fazer.
 * - De "Lead perdido" e de "Esfriou" o passo e "Virou cliente": quem reaparece
 *   volta para fechar. Reenviar proposta passa pelo e-mail, ou pelo quadro.
 * - "Virou cliente" e o fim: sem botao.
 */
export function proximoPasso(status: Status): Exclude<AtalhoStatus, "perdido"> | null {
  switch (status) {
    case "incompleto":
    case "aguardando_revisao":
      return "enviado";
    case "enviado":
    case "esfriou":
    case "perdido":
      return "virou_cliente";
    case "virou_cliente":
      return null;
  }
}

/**
 * Como o botao do atalho aparece: `atual` quando o lead ja esta naquela coluna
 * (botao marcado, sem acao), `bloqueio` com a frase da recusa quando a matriz
 * nao deixa (ex.: "Enviado" sem proposta). A mesma `recusarMovimento` do
 * quadro: o atalho nunca permite o que o arraste recusaria.
 */
export function estadoDoAtalho(
  de: Status,
  para: AtalhoStatus,
  ctx: { temProposta: boolean },
): { atual: boolean; bloqueio: string | null } {
  const recusa = recusarMovimento(de, para, ctx);
  if (recusa === "mesmo_status") return { atual: true, bloqueio: null };
  return { atual: false, bloqueio: recusa ? MENSAGEM_RECUSA[recusa] : null };
}

/**
 * Marcar como "Enviado" sem que e-mail nenhum tenha saido (`enviado_em` nulo) e
 * uma DECISAO, nao efeito colateral: o quadro e o detalhe perguntam antes. Lead
 * que ja foi enviado e so volta para a coluna nao repergunta nada.
 */
export function pedeConfirmacaoDeEnvio(para: Status, enviadoEm: string | null): boolean {
  return para === "enviado" && !enviadoEm;
}

export function mensagemConfirmacaoDeEnvio(nome: string): string {
  return `Marcar a proposta de ${nome} como enviada?\n\nIsso só muda a coluna. Nenhum e-mail sai daqui.`;
}
