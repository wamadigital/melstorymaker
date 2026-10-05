/**
 * Os casamentos que aparecem na `/casamento`, na ordem da galeria.
 *
 * Este arquivo é a ESCOLHA (qual Reel, com que rótulo, qual trecho vira
 * preview); os arquivos de vídeo saem dele pelo `npm run lp:reels`, que grava
 * os nomes com hash em `midia.gerado.ts`. Casamento novo = uma linha aqui e
 * rodar o script de novo.
 *
 * Sem nome de casal, por decisão do owner (01/10/2026): o rótulo é o espaço e
 * o mês. A ordem alterna os espaços (o Espaço Pieri aparece em 5 dos 11) em vez
 * de seguir as views do Instagram, que não dizem nada sobre quem chega pelo
 * anúncio.
 */
export type Reel = {
  /** Código do Reel no Instagram (instagram.com/reel/<id>). */
  id: string;
  espaco: string;
  /** Mês/ano do casamento, ou só o ano quando a legenda não traz a data. */
  quando: string;
  /**
   * Trecho, em segundos do Reel, que vira o preview mudo do card. É o momento
   * de pico (entrada, saída, pista), não o começo: os Reels abrem quase
   * sempre em detalhe e making of, que são os segundos mais fracos.
   */
  trecho: { inicio: number; fim: number };
};

export const REELS: readonly Reel[] = [
  { id: "DZFdXNGOoPH", espaco: "Casa Venamore", quando: "abr/2026", trecho: { inicio: 46, fim: 52 } },
  { id: "DWXY4QLDjsV", espaco: "Espaço Pieri", quando: "mar/2026", trecho: { inicio: 55, fim: 59 } },
  { id: "DZF5RZnxFYY", espaco: "Portal Paraíso", quando: "mai/2026", trecho: { inicio: 66, fim: 71 } },
  { id: "DXM41Y7DtAA", espaco: "Corsage Eventos", quando: "mar/2026", trecho: { inicio: 36, fim: 42 } },
  { id: "DdcXXy8O8hN", espaco: "Espaço Pieri", quando: "ago/2026", trecho: { inicio: 79, fim: 85 } },
  { id: "DdYyiYBxkMo", espaco: "Cerimoniello Festas", quando: "2026", trecho: { inicio: 12, fim: 18 } },
  // Criativo de anúncio (05/10/2026). Trecho quebrado de propósito: entre o
  // clarão de 55,3 s e o de 59,6 s, senão o pôster sairia branco.
  { id: "DF8s1wUyhhE", espaco: "Espaço Pieri", quando: "2025", trecho: { inicio: 55.5, fim: 59.5 } },
  { id: "DPeG5utjo1d", espaco: "Spazzio Felicità", quando: "set/2025", trecho: { inicio: 73, fim: 78 } },
  { id: "DVyShjmjuOO", espaco: "Espaço Pieri", quando: "fev/2026", trecho: { inicio: 46, fim: 52 } },
  { id: "DLqRcGRSdzn", espaco: "Rancho Verde", quando: "jun/2025", trecho: { inicio: 50, fim: 56 } },
  { id: "DR9y93sDiQO", espaco: "Espaço Pieri", quando: "nov/2025", trecho: { inicio: 45, fim: 51 } },
];

/**
 * Teaser do hero: a saída sob pétalas ao entardecer. Mudo, em loop, sem trilha
 * nenhuma no arquivo -- o hero nunca toca som.
 *
 * Desde 03/10/2026 o vídeo não fica mais ATRÁS do texto (a legibilidade do
 * título sobre as pétalas era ruim, apontou o owner): é um quadro 4:3 recortado
 * nos noivos, com cara de visor de câmera. `recorteY` é o topo do recorte, em
 * pixels do Reel bruto (720x1280): a faixa de 720x540 que vai da cabeça ao
 * joelho dos noivos ao longo dos 6 s. Mudou o trecho, confira o recorte de novo
 * numa folha de quadros.
 */
export const HERO = { id: "DdcXXy8O8hN", trecho: { inicio: 79, fim: 85 }, recorteY: 460 } as const;

/**
 * Desde quando a Mel registra casamento: o primeiro publicado no Instagram
 * dela é de nov/2024 (contado em 01/10/2026). É o "Desde 2024" da faixa de
 * baixo do hero.
 */
export const ANO_PRIMEIRO_CASAMENTO = 2024;

/**
 * Teto de peso por arquivo, usado pelo `lp:reels` ao gerar e conferido de novo
 * pelo `reels.test.ts`. O preview é o que mais importa: a galeria toca um
 * atrás do outro conforme a pessoa desliza, no 4G.
 *
 * `reelsTotal` subiu de 100 para 110 MiB em 05/10/2026, com o 11º Reel (pedido
 * do owner, criativo de anúncio): os dez já somavam 96 MiB. O Reel completo só
 * baixa no toque, então o total pesa no repositório, não na página.
 */
export const ORCAMENTO = {
  reel: 12 * 1024 * 1024,
  reelsTotal: 110 * 1024 * 1024,
  preview: 600 * 1024,
  teaser: 700 * 1024,
  poster: 120 * 1024,
} as const;
