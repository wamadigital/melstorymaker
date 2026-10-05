import type { Lead, Status } from "@/lib/form/types";
import { diaMesLocal } from "@/lib/pdf/formatadores";

/**
 * Lembrete por e-mail de quem parou no meio do formulario.
 *
 * Pedido do owner em 05/10/2026: na coluna "Novo", o lead que deixou e-mail
 * ganha, embaixo do "Chamar no WhatsApp", um botao que manda um e-mail
 * chamando de volta para o formulario. O clique da Mel ENVIA, na hora e sem
 * confirmacao, e o botao trava por 7 dias. Nada sai sem o clique (regra 4).
 *
 * Este modulo so DIZ em que ponto o lead esta. Quem envia e
 * `POST /api/admin/leads/[id]/lembrete-email`, que roda ESTA MESMA funcao antes
 * de mandar: o botao desabilitado e conveniencia, quem recusa e o servidor.
 */

/** Dias entre um lembrete e o proximo, contados do envio. */
export const DIAS_ENTRE_LEMBRETES_EMAIL = 7;

const DIA_MS = 86_400_000;

type CamposLembreteEmail = Pick<Lead, "email" | "lembrete_email_em">;

export type EstadoLembreteEmail =
  /** Fora de "Novo", ou sem e-mail: nao ha botao. */
  | { visivel: false }
  /** Pode mandar. `ultimoEm` e o lembrete anterior, quando ja houve um. */
  | { visivel: true; liberado: true; ultimoEm: string | null }
  /** Mandou ha menos de 7 dias: travado ate `liberaEm`. */
  | {
      visivel: true;
      liberado: false;
      ultimoEm: string;
      liberaEm: string;
      /** Dias que faltam, arredondados para CIMA: "1 dia" ate o ultimo minuto. */
      diasParaLiberar: number;
    };

/**
 * Em que ponto do lembrete por e-mail este lead esta.
 *
 * `coluna` e o status em que o cartao esta sendo DESENHADO -- inclusive o
 * otimista do arraste. So existe dentro de `incompleto`: o lembrete chama de
 * volta para o formulario, e o formulario so aceita escrita em `incompleto`.
 * De "Aguardando revisao" em diante quem tem de agir e a Mel, nao o lead.
 *
 * Sem e-mail nao ha para onde mandar, e o botao some. Como o e-mail e a ULTIMA
 * pergunta do formulario (regra 5c), lead de "Novo" com e-mail e raro: e quem
 * teve o envio final interrompido, ou quem a Mel completou no detalhe.
 *
 * A conta e pela diferenca em ms, como `diasCorridos`: independe de fuso, e o
 * quadro e renderizado num servidor em UTC enquanto a Mel le em Sao Paulo.
 */
export function estadoLembreteEmail(
  lead: CamposLembreteEmail,
  coluna: Status,
  agoraMs: number,
): EstadoLembreteEmail {
  if (coluna !== "incompleto" || !lead.email?.trim()) return { visivel: false };

  const ultimoEm = lead.lembrete_email_em;
  const enviadoMs = ultimoEm ? Date.parse(ultimoEm) : Number.NaN;
  // Nunca mandado -- ou data ilegivel, que nao pode travar o botao para sempre.
  if (!ultimoEm || Number.isNaN(enviadoMs)) return { visivel: true, liberado: true, ultimoEm: null };

  const liberaMs = enviadoMs + DIAS_ENTRE_LEMBRETES_EMAIL * DIA_MS;
  if (agoraMs >= liberaMs) return { visivel: true, liberado: true, ultimoEm };

  return {
    visivel: true,
    liberado: false,
    ultimoEm,
    liberaEm: new Date(liberaMs).toISOString(),
    // O teto cobre relogio adiantado entre servidores: um carimbo alguns
    // segundos "no futuro" nao pode virar "libera em 8 dias".
    diasParaLiberar: Math.min(
      DIAS_ENTRE_LEMBRETES_EMAIL,
      Math.ceil((liberaMs - agoraMs) / DIA_MS),
    ),
  };
}

/**
 * Rotulo do botao, na voz de quem vai clicar. "Lembrar por e-mail" faz par com
 * o "Chamar no WhatsApp" logo acima; curto porque divide os mesmos ~190px de
 * cartao.
 */
export const ROTULO_LEMBRETE_EMAIL = {
  enviar: "Lembrar por e-mail",
  enviado: "Lembrete enviado",
} as const;

/**
 * Linha embaixo do botao. Travado, diz QUANDO volta -- botao desabilitado nao
 * mostra `title` (pointer-events: none), entao o motivo vai escrito. Liberado
 * depois de um lembrete, diz que ja houve um: o terceiro e-mail para a mesma
 * pessoa e decisao da Mel, e ela precisa saber que e o terceiro.
 */
export function legendaLembreteEmail(estado: EstadoLembreteEmail): string | null {
  if (!estado.visivel) return null;
  if (!estado.liberado) {
    const n = estado.diasParaLiberar;
    return `Libera de novo em ${n} ${n === 1 ? "dia" : "dias"}`;
  }
  return estado.ultimoEm ? `Último lembrete em ${diaMesLocal(estado.ultimoEm)}` : null;
}
