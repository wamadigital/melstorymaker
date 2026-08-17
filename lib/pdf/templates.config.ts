import type { Categoria } from "@/lib/form/types";
import type { NomeFormatador } from "./formatadores";
import type { NomeFonte } from "./fontes";

export type Alinhamento = "esquerda" | "centro" | "direita";

export type CampoTemplate = {
  /** Identificador do campo na arte. So para leitura humana e debug. */
  chave: string;
  /** Caminho da resposta, ex: "respostas.nome". */
  fonte: string;
  pagina: number;
  x: number;
  y: number;
  font: NomeFonte;
  tamanho: number;
  /** Hex da arte, ex: "#3A2E2A". */
  cor: string;
  /** Se o texto exceder, a fonte encolhe ate caber. Nunca quebra linha. */
  maxLargura?: number;
  formato?: NomeFormatador;
  /** Padrao: "esquerda". Em campo centralizado, x e o centro do bloco. */
  alinhamento?: Alinhamento;
};

export type TemplateConfig = {
  basePdf: string;
  /**
   * De onde vieram os numeros de x/y.
   *
   * "figma": origem no canto SUPERIOR esquerdo, como o painel do Figma mostra.
   *   A conversao para o pdf-lib acontece no gerar.ts.
   * "pdf": origem no canto INFERIOR esquerdo, ja no sistema do pdf-lib.
   *   Use quando o valor veio da rota de calibracao.
   *
   * Campo obrigatorio de proposito: deixar isso implicito e o jeito mais rapido
   * de passar uma tarde inteira calibrando texto de cabeca para baixo.
   */
  origemCoordenadas: "figma" | "pdf";
  /**
   * Razao entre a pagina do PDF exportado e o frame do Figma. Vale 1 quando o
   * frame foi desenhado no tamanho final em pontos. Se o frame do Figma tem
   * 1080px de largura e a pagina exportada tem 595pt, escala = 595/1080.
   * Aplicada a x, y e ao tamanho da fonte.
   */
  escala: number;
  campos: CampoTemplate[];
};

const COR_TINTA = "#3A2E2A";

/**
 * PROVISORIO ate a arte real do Figma entrar no repo.
 *
 * Os numeros abaixo posicionam texto legivel sobre os PDFs placeholder para o
 * pipeline rodar ponta a ponta. Eles NAO correspondem a arte da Mel. A
 * calibracao de verdade se faz em /admin/debug-template?categoria=X, e entra em
 * PR dedicada contendo so assets + este arquivo.
 */
export const templates: Record<Categoria, TemplateConfig> = {
  debutante: {
    basePdf: "assets/templates/debutante.pdf",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [
      {
        chave: "nome",
        fonte: "respostas.nome",
        pagina: 0,
        x: 297,
        y: 420,
        font: "BrandSerif-Bold",
        tamanho: 32,
        cor: COR_TINTA,
        maxLargura: 420,
        alinhamento: "centro",
      },
      {
        chave: "data",
        fonte: "respostas.data",
        pagina: 1,
        x: 90,
        y: 300,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "data_extenso",
      },
      {
        chave: "horario",
        fonte: "respostas.horario",
        pagina: 1,
        x: 90,
        y: 330,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "hora_br",
      },
      {
        chave: "local",
        fonte: "respostas.local",
        pagina: 1,
        x: 90,
        y: 360,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        maxLargura: 380,
      },
    ],
  },

  aniversario: {
    basePdf: "assets/templates/aniversario.pdf",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [
      {
        chave: "nome",
        fonte: "respostas.nome",
        pagina: 0,
        x: 297,
        y: 420,
        font: "BrandSerif-Bold",
        tamanho: 32,
        cor: COR_TINTA,
        maxLargura: 420,
        alinhamento: "centro",
      },
      {
        chave: "data",
        fonte: "respostas.data",
        pagina: 1,
        x: 90,
        y: 300,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "data_extenso",
      },
      {
        chave: "horario",
        fonte: "respostas.horario",
        pagina: 1,
        x: 90,
        y: 330,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "hora_br",
      },
      {
        chave: "local",
        fonte: "respostas.local",
        pagina: 1,
        x: 90,
        y: 360,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        maxLargura: 380,
      },
    ],
  },

  // Casamento e a unica categoria com dois locais separados na arte.
  casamento: {
    basePdf: "assets/templates/casamento.pdf",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [
      {
        chave: "nome",
        fonte: "respostas.nome",
        pagina: 0,
        x: 297,
        y: 420,
        font: "BrandSerif-Bold",
        tamanho: 32,
        cor: COR_TINTA,
        maxLargura: 420,
        alinhamento: "centro",
      },
      {
        chave: "data",
        fonte: "respostas.data",
        pagina: 1,
        x: 90,
        y: 300,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "data_extenso",
      },
      {
        chave: "horario",
        fonte: "respostas.horario",
        pagina: 1,
        x: 90,
        y: 330,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "hora_br",
      },
      {
        chave: "local_cerimonia",
        fonte: "respostas.local_cerimonia",
        pagina: 1,
        x: 90,
        y: 360,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        maxLargura: 380,
      },
      {
        chave: "local_festa",
        fonte: "respostas.local_festa",
        pagina: 1,
        x: 90,
        y: 390,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        maxLargura: 380,
      },
    ],
  },

  corporativo: {
    basePdf: "assets/templates/corporativo.pdf",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [
      {
        chave: "nome",
        fonte: "respostas.nome",
        pagina: 0,
        x: 297,
        y: 420,
        font: "BrandSans-Bold",
        tamanho: 28,
        cor: COR_TINTA,
        maxLargura: 420,
        alinhamento: "centro",
      },
      {
        chave: "data",
        fonte: "respostas.data",
        pagina: 1,
        x: 90,
        y: 300,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "data_extenso",
      },
      {
        chave: "horario",
        fonte: "respostas.horario",
        pagina: 1,
        x: 90,
        y: 330,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        formato: "hora_br",
      },
      {
        chave: "local",
        fonte: "respostas.local",
        pagina: 1,
        x: 90,
        y: 360,
        font: "BrandSans-Regular",
        tamanho: 14,
        cor: COR_TINTA,
        maxLargura: 380,
      },
    ],
  },
};

/**
 * `making_of` e `entrega` nao sao impressos: a arte de cada categoria nao tem
 * espaco reservado para eles. Aparecem no painel, como contexto para a Mel. Se
 * um dia a arte ganhar esse espaco, basta acrescentar o campo aqui.
 */
export function fontesUsadas(categoria: Categoria): NomeFonte[] {
  return [...new Set(templates[categoria].campos.map((c) => c.font))];
}
