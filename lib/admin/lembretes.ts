import type { Lead, Status } from "@/lib/form/types";

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
 * aparecem o "Relembrar cliente" e, aos 30 dias, a "Ultima tentativa".
 *
 * Este modulo so DIZ em que ponto o lead esta. Quem manda a mensagem, marca o
 * lembrete e move o cartao para "Lead perdido" e a Mel, um clique de cada vez.
 */

export const DIAS_LEMBRETE_1 = 7;
export const DIAS_LEMBRETE_2 = 30;

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

type CamposLembrete = Pick<Lead, "enviado_em" | "lembrete_7_em" | "lembrete_30_em">;

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
  // Reenviar a proposta reinicia o relógio. Os carimbos ficam no banco como
  // histórico, mas só uma cobrança do envio vigente pode silenciar o cartão.
  const enviadoMs = Date.parse(lead.enviado_em);
  const nesteEnvio = (carimbo: string | null) =>
    !!carimbo && Number.isFinite(enviadoMs) && Date.parse(carimbo) >= enviadoMs;
  const cobrado7 = nesteEnvio(lead.lembrete_7_em);
  const cobrado30 = nesteEnvio(lead.lembrete_30_em);
  const cobrado: Marco | null = cobrado30 ? 30 : cobrado7 ? 7 : null;

  // A ordem importa: aos 40 dias o marco e 30 mesmo que os 7 nunca tenham sido
  // cobrados. Cobrar "faz uma semana" em cima de um lead de mes e meio seria
  // pior do que nao cobrar.
  const marco: Marco | null =
    dias >= DIAS_LEMBRETE_2 ? 30 : dias >= DIAS_LEMBRETE_1 ? 7 : null;

  const jaCobrado = marco === 30 ? cobrado30 : marco === 7 ? cobrado7 : true;

  return { dias, marco, pendente: jaCobrado ? null : marco, cobrado };
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
