import type { TemplateId } from "@/lib/form/types";
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
  /**
   * Padrao: false, ou seja, TODO campo do config e obrigatorio.
   *
   * Campo obrigatorio vazio faz a geracao falhar com a lista do que falta, em
   * vez de sair um PDF com um buraco onde deveria estar o nome do lead. So
   * marque `opcional` se a arte de fato funciona sem aquele texto.
   */
  opcional?: boolean;
};

export type TemplateConfig = {
  basePdf: string;
  /** Nome legivel da arte, exibido no painel para a Mel conferir. */
  rotulo: string;
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

/** Campos que toda arte tem, para nao repetir cinco vezes o mesmo bloco. */
function camposComuns(): CampoTemplate[] {
  return [
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
  ];
}

/**
 * Campo do SUJEITO do evento -- a debutante, o aniversariante, os noivos ou a
 * empresa. Nao e o `nome`, que guarda quem preencheu o formulario e nao entra
 * na arte. `chave` casa com a variavel de mesmo nome no Figma.
 */
function campoSujeito(
  chave: "debutante" | "aniversariante" | "noivos" | "empresa",
  font: NomeFonte = "BrandSerif-Bold",
  tamanho = 32,
): CampoTemplate {
  return {
    chave,
    fonte: `respostas.${chave}`,
    pagina: 0,
    x: 297,
    y: 420,
    font,
    tamanho,
    cor: COR_TINTA,
    maxLargura: 420,
    alinhamento: "centro",
  };
}

function campoLocal(chave: string, y: number): CampoTemplate {
  return {
    chave,
    fonte: `respostas.${chave}`,
    pagina: 1,
    x: 90,
    y,
    font: "BrandSans-Regular",
    tamanho: 14,
    cor: COR_TINTA,
    maxLargura: 380,
  };
}

/**
 * PROVISORIO ate a arte real do Figma entrar no repo.
 *
 * Os numeros abaixo posicionam texto legivel sobre os PDFs placeholder para o
 * pipeline rodar ponta a ponta. Eles NAO correspondem a arte da Mel. A
 * calibracao de verdade se faz em /admin/debug-template?template=X, e entra em
 * PR dedicada contendo so assets + este arquivo.
 *
 * Indexado por TemplateId, nao por Categoria: `aniversario` e uma categoria so
 * no banco, mas resolve entre duas artes conforme a idade.
 */
export const templates: Record<TemplateId, TemplateConfig> = {
  debutante: {
    basePdf: "assets/templates/debutante.pdf",
    rotulo: "Festa de 15 anos",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [campoSujeito("debutante"), ...camposComuns(), campoLocal("local", 360)],
  },

  aniversario_infantil: {
    basePdf: "assets/templates/aniversario_infantil.pdf",
    rotulo: "Aniversário infantil (até 14 anos)",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [campoSujeito("aniversariante"), ...camposComuns(), campoLocal("local", 360)],
  },

  aniversario_adulto: {
    basePdf: "assets/templates/aniversario_adulto.pdf",
    rotulo: "Aniversário adulto (15 anos ou mais)",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [campoSujeito("aniversariante"), ...camposComuns(), campoLocal("local", 360)],
  },

  // Unica arte com dois locais separados.
  casamento: {
    basePdf: "assets/templates/casamento.pdf",
    rotulo: "Casamento",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [
      campoSujeito("noivos"),
      ...camposComuns(),
      campoLocal("local_cerimonia", 360),
      campoLocal("local_festa", 390),
    ],
  },

  corporativo: {
    basePdf: "assets/templates/corporativo.pdf",
    rotulo: "Evento corporativo",
    origemCoordenadas: "figma",
    escala: 1,
    campos: [
      campoSujeito("empresa", "BrandSans-Bold", 28),
      // Coordenada provisoria: a posicao real sai da arte do Figma, onde este
      // campo vai existir como variavel.
      {
        chave: "tipo_evento",
        fonte: "respostas.tipo_evento",
        pagina: 0,
        x: 297,
        y: 470,
        font: "BrandSans-Regular",
        tamanho: 16,
        cor: COR_TINTA,
        maxLargura: 420,
        alinhamento: "centro",
      },
      ...camposComuns(),
      campoLocal("local", 360),
    ],
  },
};

/**
 * `nome` (quem preencheu), `idade`, `making_of` e `entrega` nao sao impressos:
 * servem para escolher a arte, para cumprimentar no e-mail ou como contexto da
 * Mel no painel. Se a arte de alguma categoria ganhar
 * espaco para eles, basta acrescentar o campo aqui.
 */
export function fontesUsadas(template: TemplateId): NomeFonte[] {
  return [...new Set(templates[template].campos.map((c) => c.font))];
}
