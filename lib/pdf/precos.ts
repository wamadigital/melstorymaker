import type { TemplateId } from "@/lib/form/types";

/**
 * Tabelas de preco da proposta.
 *
 * O preco NAO existe como numero neste sistema, e nao passa a existir aqui: ele
 * esta DESENHADO na arte, e a arte e rasterizada (gotchas 4d/4e do CLAUDE.md).
 * O valor que o lead le e um punhado de pixels dentro de um JPEG. Por isso
 * "mudar de preco" nao e trocar uma variavel: e usar OUTRA arte base.
 *
 * Dai a segunda dimensao que nomeia o arquivo. A primeira e o `TemplateId`
 * (QUAL arte), resolvido pela categoria + idade; esta e a `TabelaPreco` (QUAL
 * tabela), resolvida pelo ANO DO EVENTO:
 *
 *   assets/templates/<arte>.<tabela>.pdf
 *
 * A decisao travada nº6 do CLAUDE.md segue de pe -- continua sem logica de
 * preco, sem soma e sem calculo. O que existe aqui e roteamento de asset.
 */

export const TABELAS_PRECO = ["2026", "2027", "2028"] as const;
export type TabelaPreco = (typeof TABELAS_PRECO)[number];

/**
 * Tabela do MVP, e a unica que o placeholder consegue representar (um
 * placeholder nao tem preco nenhum desenhado).
 */
export const TABELA_BASE: TabelaPreco = "2026";

/**
 * Vigencias em ordem CRESCENTE de ano. Um evento usa a ultima tabela cujo ano
 * de inicio ja chegou, entao um evento em 2029 segue na tabela de 2027 ate
 * alguem criar uma nova -- o contrario (cair na tabela base) reduziria o preco
 * sozinho com o passar do tempo.
 *
 * Tabela nova = uma linha aqui + as cinco artes correspondentes.
 */
const VIGENCIAS: { desdeAno: number; tabela: TabelaPreco }[] = [
  // Cobre tambem qualquer data anterior a 2026: o formulario nao aceita data
  // passada, mas um lead antigo reaberto no painel nao pode ficar sem tabela.
  { desdeAno: 0, tabela: "2026" },
  { desdeAno: 2027, tabela: "2027" },
  { desdeAno: 2028, tabela: "2028" },
];

/**
 * As tabelas que ALGUMA data alcanca -- ou seja, as que estao em vigencia.
 *
 * Diferente de `TABELAS_PRECO`, que inclui tabela ja aprovada mas ainda sem
 * arte publicada. Quem precisa saber "esta tabela ja vale para um lead?" usa
 * esta lista; quem precisa do conjunto de valores aprovados usa a outra.
 */
export const TABELAS_EM_VIGENCIA: readonly TabelaPreco[] = [
  ...new Set(VIGENCIAS.map((v) => v.tabela)),
];

/**
 * Ano do evento a partir da resposta em ISO ("2027-01-01").
 *
 * Lido da STRING, nunca via `new Date`: `new Date("2027-01-01")` e meia-noite
 * em UTC, e `getFullYear()` em America/Sao_Paulo devolveria 2026 para um evento
 * de 1º de janeiro -- ou seja, a virada do ano cairia na tabela errada
 * exatamente no caso em que a tabela muda.
 */
export function anoDoEvento(dataISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO.trim());
  if (!m) return null;

  const [, ano, mes, dia] = m;
  const [nMes, nDia] = [Number(mes), Number(dia)];
  if (nMes < 1 || nMes > 12 || nDia < 1 || nDia > 31) return null;

  return Number(ano);
}

/**
 * Qual tabela de preco vale para um evento, ou `null` quando nao da para
 * decidir.
 *
 * Devolve `null` -- em vez de cair na tabela base -- quando a data falta ou nao
 * e ISO. Chutar aqui e mandar para o lead uma proposta com o preco do ano
 * errado, que e justamente o erro caro: a Mel so descobriria depois de enviar.
 * Mesma escolha de `resolverTemplateId`, pelo mesmo motivo.
 */
export function resolverTabelaPreco(dataISO: string): TabelaPreco | null {
  const ano = anoDoEvento(dataISO);
  if (ano === null) return null;

  let escolhida = VIGENCIAS[0].tabela;
  for (const v of VIGENCIAS) {
    if (ano >= v.desdeAno) escolhida = v.tabela;
  }
  return escolhida;
}

/**
 * Os valores desenhados em cada arte, por tabela.
 *
 * A geracao do PDF NAO le estes numeros -- quem manda e o pixel da arte. Eles
 * existem como ESPECIFICACAO: e por esta lista que se confere a arte exportada
 * do Figma (o `arte:preparar` imprime a tabela na hora do preparo) e e aqui que
 * fica registrado o que o owner aprovou, em vez de a decisao morar so no Figma.
 *
 * Tabela 2027 aprovada pelo owner em 28/08/2026: +15% sobre a de 2026,
 * arredondado para cima ate o numero comercial mais proximo. SO os pacotes
 * mudaram -- opcionais, locomocao, reserva de 30% e a validade de 3 meses
 * seguem identicos nas duas tabelas.
 *
 * Tabela 2028 aprovada pelo owner em 30/09/2026: +20% sobre a de 2027, com a
 * MESMA grade de arredondamento da de 2027 -- para cima, ate o proximo numero
 * terminado em 50 ou 90. A grade nao e folclore: aplicada com +15% sobre 2026
 * ela reproduz os catorze valores de 2027 exatamente, e `precos.test.ts` prova
 * isso. Desta vez os OPCIONAIS tambem foram reajustados (numa grade propria,
 * ver `lib/contrato/catalogo.ts`); locomocao, reserva de 30% e validade de 3
 * meses seguem iguais nas tres tabelas.
 *
 * A vigencia de 2028 entrou junto com as cinco artes dela, em 01/10/2026 --
 * nunca antes. Tabela em vigencia sem arte nao serve preco velho: aborta a
 * geracao com 409 (gotcha 6e) e deixa a Mel sem atender o ano inteiro. O teste
 * "toda tabela em vigencia tem as 5 artes publicadas", em `precos.test.ts`,
 * existe para que isso nao dependa de alguem lembrar.
 */
export const PACOTES: Record<TabelaPreco, Record<TemplateId, { nome: string; valor: number }[]>> = {
  "2026": {
    debutante: [
      { nome: "Pacote Básico", valor: 1100 },
      { nome: "Pacote Premium", valor: 1500 },
      { nome: "Pacote Luxo", valor: 1990 },
    ],
    aniversario_infantil: [
      { nome: "Pacote Básico", valor: 1090 },
      { nome: "Pacote Premium", valor: 1250 },
      { nome: "Pacote Luxo", valor: 1700 },
    ],
    aniversario_adulto: [
      { nome: "Pacote Pocket", valor: 1090 },
      { nome: "Pacote Premium", valor: 1250 },
      { nome: "Pacote Luxo", valor: 1480 },
    ],
    casamento: [
      { nome: "Pacote Principal", valor: 1290 },
      { nome: "Pacote Real Time", valor: 1790 },
    ],
    corporativo: [
      { nome: "Pacote Pocket", valor: 790 },
      { nome: "Pacote Premium", valor: 1350 },
      { nome: "Pacote Luxo", valor: 1870 },
    ],
  },
  "2027": {
    debutante: [
      { nome: "Pacote Básico", valor: 1290 },
      { nome: "Pacote Premium", valor: 1750 },
      { nome: "Pacote Luxo", valor: 2290 },
    ],
    aniversario_infantil: [
      { nome: "Pacote Básico", valor: 1290 },
      { nome: "Pacote Premium", valor: 1450 },
      { nome: "Pacote Luxo", valor: 1990 },
    ],
    aniversario_adulto: [
      { nome: "Pacote Pocket", valor: 1290 },
      { nome: "Pacote Premium", valor: 1450 },
      { nome: "Pacote Luxo", valor: 1750 },
    ],
    casamento: [
      { nome: "Pacote Principal", valor: 1490 },
      { nome: "Pacote Real Time", valor: 2090 },
    ],
    corporativo: [
      { nome: "Pacote Pocket", valor: 950 },
      { nome: "Pacote Premium", valor: 1590 },
      { nome: "Pacote Luxo", valor: 2190 },
    ],
  },
  "2028": {
    debutante: [
      { nome: "Pacote Básico", valor: 1550 },
      { nome: "Pacote Premium", valor: 2150 },
      { nome: "Pacote Luxo", valor: 2750 },
    ],
    aniversario_infantil: [
      { nome: "Pacote Básico", valor: 1550 },
      { nome: "Pacote Premium", valor: 1750 },
      { nome: "Pacote Luxo", valor: 2390 },
    ],
    aniversario_adulto: [
      { nome: "Pacote Pocket", valor: 1550 },
      { nome: "Pacote Premium", valor: 1750 },
      { nome: "Pacote Luxo", valor: 2150 },
    ],
    casamento: [
      { nome: "Pacote Principal", valor: 1790 },
      { nome: "Pacote Real Time", valor: 2550 },
    ],
    corporativo: [
      { nome: "Pacote Pocket", valor: 1150 },
      { nome: "Pacote Premium", valor: 1950 },
      { nome: "Pacote Luxo", valor: 2650 },
    ],
  },
};

/** Rotulo para o painel e para os scripts: "tabela 2027". */
export function rotuloTabela(tabela: TabelaPreco): string {
  return `tabela ${tabela}`;
}
