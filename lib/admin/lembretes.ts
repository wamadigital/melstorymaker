import type { Lead, Status } from "@/lib/form/types";
import type { DisparoWhatsApp } from "@/lib/admin/tipos";

/**
 * Cobranca de quem recebeu a proposta e sumiu.
 *
 * O relogio conta a partir de `enviado_em` -- a data em que a proposta saiu de
 * verdade -- e nao de quando o cartao entrou na coluna. Sao a mesma coisa na
 * pratica (a rota de status carimba `enviado_em` ao entrar em `enviado`), mas a
 * distincao importa no caso real: um cartao que voltou para revisao e depois
 * voltou para `enviado` NAO reinicia a contagem, porque `enviado_em` nunca e
 * limpo. O lead nao esquece que recebeu a proposta ha 40 dias so porque a Mel
 * reorganizou o quadro.
 *
 * A cobranca vive em DUAS colunas desde 07/10/2026: "Enviado" e "Esfriou". O
 * lead fica no maximo uma semana em "Enviado" e vai sozinho para "Esfriou"
 * (`lib/admin/esfriar.ts` -- a unica transicao automatica do sistema); la
 * aparecem o "Relembrar cliente" e, aos 30 dias, a "Ultima tentativa" se o
 * primeiro lembrete foi confirmado pelo WhatsApp para a proposta vigente.
 *
 * Este modulo só descreve o cartão. A Mel solicita o envio com um clique;
 * o worker verifica interação recente e confirma o envio antes de carimbar.
 */

export const DIAS_LEMBRETE_1 = 7;
export const DIAS_LEMBRETE_2 = 30;
export const DIAS_ENTRE_LEMBRETES = 15;

/** Os dois marcos de cobranca. `null` = o lead nao esta em nenhum deles. */
export type Marco = 7 | 30;

export type EstadoLembrete = {
  /** Dias corridos desde o envio da proposta, ou null se ainda nao foi enviada. */
  dias: number | null;
  /** Marco atingido, mesmo que a Mel ja tenha cobrado. */
  marco: Marco | null;
  /** Marco atingido e AINDA nao cobrado -- e o que pinta o cartao. */
  pendente: Marco | null;
  /** Ultimo marco ja cobrado, para o cartao mostrar "Lembrado aos N dias". */
  cobrado: Marco | null;
};

export const SEM_LEMBRETE: EstadoLembrete = {
  dias: null,
  marco: null,
  pendente: null,
  cobrado: null,
};

type CamposLembrete = Pick<Lead, "enviado_em" | "lembrete_7_em" | "lembrete_30_em"> & {
  disparos_whatsapp?: DisparoWhatsApp[];
  /** Metadado privado validado e produzido no servidor; não autoriza o envio. */
  teste_whatsapp?: { marco: 7 | 30; expiraEm: string };
};

/** As colunas em que existe cobranca: quem recebeu a proposta e ainda nao respondeu. */
export const COLUNAS_COM_COBRANCA = ["enviado", "esfriou"] as const satisfies readonly Status[];
export type ColunaCobranca = (typeof COLUNAS_COM_COBRANCA)[number];

export function temCobranca(coluna: Status): coluna is ColunaCobranca {
  return (COLUNAS_COM_COBRANCA as readonly Status[]).includes(coluna);
}

/**
 * Dias corridos entre duas datas, pela diferenca absoluta em milissegundos.
 *
 * De proposito NAO usa componentes de data (`getDate`, `setHours`): a conta por
 * diferenca independe de fuso, e o painel e renderizado num servidor em UTC
 * enquanto a Mel le em America/Sao_Paulo. Um "dia" aqui e 24h cheias desde o
 * envio, que e como qualquer pessoa conta "faz uma semana que mandei".
 */
export function diasCorridos(desdeIso: string, agoraMs: number): number {
  const desde = Date.parse(desdeIso);
  if (Number.isNaN(desde)) return 0;
  return Math.floor((agoraMs - desde) / 86_400_000);
}

/** Somente confirmações da proposta vigente, anteriores ao instante do quadro. */
function ultimoAckNesteEnvio(lead: CamposLembrete, tipo: DisparoWhatsApp["tipo"], agoraMs: number): number | null {
  const enviadoMs = Date.parse(lead.enviado_em ?? "");
  if (!Number.isFinite(enviadoMs) || !Number.isFinite(agoraMs)) return null;
  let ultimo: number | null = null;
  for (const disparo of lead.disparos_whatsapp ?? []) {
    const instante = Date.parse(disparo.enviado_em);
    // A comparação textual conserva a revisão exata, inclusive microssegundos.
    if (disparo.tipo === tipo && disparo.proposta_enviado_em === lead.enviado_em &&
      instante >= enviadoMs && instante <= agoraMs) ultimo = Math.max(ultimo ?? instante, instante);
  }
  return ultimo;
}

/** Prazo normal, sem estender ou fabricar uma autorização temporária de teste. */
export function prazoUltimaTentativa(lead: CamposLembrete, agoraMs: number): number | null {
  const seteMs = ultimoAckNesteEnvio(lead, "lembrete_proposta_7d", agoraMs);
  if (seteMs === null) return null;
  return Math.max(Date.parse(lead.enviado_em!) + DIAS_LEMBRETE_2 * 86_400_000,
    seteMs + DIAS_ENTRE_LEMBRETES * 86_400_000);
}

/**
 * Em que ponto da cobranca este lead esta.
 *
 * `coluna` e o status em que o cartao esta sendo DESENHADO -- inclusive o
 * otimista, enquanto o arraste ainda nao voltou do servidor. Cobranca so existe
 * em `enviado` e `esfriou`: quem virou cliente nao se cobra, quem foi perdido
 * ja foi cobrado, e quem voltou para revisao esta na mao da Mel.
 *
 * Desde que o lead esfria no 7o dia (fluxo do owner, 07/10/2026), o
 * "Relembrar cliente" mora no Esfriou, e a "Ultima tentativa" dos 30 dias
 * tambem. Em Enviado a cobranca so aparece no cartao que ficou la alem da
 * semana por ter tido update (ver `lib/admin/esfriar.ts`).
 */
export function estadoLembrete(
  lead: CamposLembrete,
  coluna: Status,
  agoraMs: number,
): EstadoLembrete {
  if (!temCobranca(coluna) || !lead.enviado_em) return SEM_LEMBRETE;

  const dias = diasCorridos(lead.enviado_em, agoraMs);
  // A marcação manual antiga não prova um envio pelo MCP. O histórico conserva
  // esses carimbos, mas a nova sequência só avança com um ACK real do worker.
  const cobrado7 = ultimoAckNesteEnvio(lead, "lembrete_proposta_7d", agoraMs) !== null;
  const cobrado30 = ultimoAckNesteEnvio(lead, "lembrete_proposta_30d", agoraMs) !== null;
  const cobrado: Marco | null = cobrado30 ? 30 : cobrado7 ? 7 : null;
  const marcoTeste = lead.teste_whatsapp && Date.parse(lead.teste_whatsapp.expiraEm) > agoraMs
    ? lead.teste_whatsapp.marco : null;

  // Mesmo aos 40 dias, o primeiro lembrete vem antes da última tentativa.
  // Nenhum dos textos afirma há quantos dias a proposta foi enviada.
  const marco: Marco | null =
    dias >= DIAS_LEMBRETE_2 && (cobrado7 || cobrado30 || marcoTeste === 30) ? 30 : dias >= DIAS_LEMBRETE_1 ? 7 : null;

  const jaCobrado = marco === 30 ? cobrado30 : marco === 7 ? cobrado7 : true;
  const prazo30 = prazoUltimaTentativa(lead, agoraMs);
  // Ter chegado ao marco de 30 dias não libera outra conversa imediatamente
  // após o primeiro lembrete. Durante a espera, conserva ACK/ícone e não volta
  // a oferecer o lembrete de 7 dias. O servidor revalida também o WhatsApp.
  const aguardandoIntervalo = marco === 30 && marcoTeste !== 30 &&
    (prazo30 === null || agoraMs < prazo30);

  return { dias, marco, pendente: jaCobrado || aguardandoIntervalo ? null : marco, cobrado };
}

/** Coluna do banco que guarda a data de cada marco. */
export const COLUNA_LEMBRETE: Record<Marco, "lembrete_7_em" | "lembrete_30_em"> = {
  7: "lembrete_7_em",
  30: "lembrete_30_em",
};

/**
 * Tema do cartao com cobranca pendente (fluxo do owner, 07/10/2026):
 *
 * - "Relembrar cliente" (7 dias): a tinta da COLUNA. No Esfriou, o cinza dela;
 *   em Enviado (so quem ficou alem da semana por ter tido update), um azul
 *   mais claro que o da coluna.
 * - "Ultima tentativa" (30 dias): VERMELHO, em qualquer coluna, como era antes
 *   -- e a ultima chance antes de a Mel dar o lead por perdido. O ambar saiu.
 *
 * Classes LITERAIS, como o `TEMA_COLUNA`: o scanner do Tailwind v4 nao le
 * string interpolada e `bg-${cor}-50` sumiria do CSS gerado.
 */
export const TEMA_COBRANCA: Record<ColunaCobranca, { cartao: string; barra: string; texto: string }> = {
  enviado: {
    cartao: "border-sky-200 bg-sky-100/70",
    barra: "bg-sky-300",
    texto: "text-sky-800",
  },
  esfriou: {
    cartao: "border-zinc-300 bg-zinc-100",
    barra: "bg-zinc-400",
    texto: "text-zinc-800",
  },
};

/** Os 30 dias: vermelho em qualquer coluna. */
export const TEMA_ULTIMA_TENTATIVA = {
  cartao: "border-red-300 bg-red-50",
  barra: "bg-red-500",
  texto: "text-red-800",
} as const;

/** Tema do cartao, ou null quando nao ha cobranca pendente nele. */
export function temaCobranca(coluna: Status, estado: EstadoLembrete) {
  if (!estado.pendente || !temCobranca(coluna)) return null;
  return estado.pendente === 30 ? TEMA_ULTIMA_TENTATIVA : TEMA_COBRANCA[coluna];
}

/** Rotulo do botao de cobranca, na voz de quem vai clicar. */
export const ROTULO_LEMBRETE: Record<Marco, string> = {
  7: "Relembrar cliente",
  30: "Última tentativa",
};

/**
 * Selo de cobranca ja feita. Curto de proposito: divide a linha com a data no
 * rodape do cartao, e "Mensagem de 30 dias enviada" nao cabe em 190px de coluna.
 */
export const SELO_LEMBRETE: Record<Marco, string> = {
  7: "Lembrado aos 7 dias",
  30: "Lembrado aos 30 dias",
};
