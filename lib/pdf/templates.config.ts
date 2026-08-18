import type { TemplateId } from "@/lib/form/types";
import type { NomeFormatador } from "./formatadores";
import type { NomeFonte } from "./fontes";

export type Alinhamento = "esquerda" | "centro" | "direita";

export type CampoTemplate = {
  /** Identificador do campo na arte. So para leitura humana e debug. */
  chave: string;
  /**
   * Caminho da resposta, ex: "respostas.nome". Use `composicao` quando o texto
   * da arte junta mais de uma resposta numa linha so.
   */
  fonte?: string;
  /**
   * Template de string para texto composto, ex: "{noivos} | {data}".
   *
   * Existe porque na arte o cabecalho da capa e UM unico texto que mistura duas
   * respostas, com a data ja por extenso no meio. Cada `{chave}` resolve em
   * `respostas[chave]`, aplicando `formatos[chave]` quando houver. Se qualquer
   * chave usada estiver vazia, o campo conta como faltando.
   */
  composicao?: string;
  /** Formatador por chave, usado com `composicao`. */
  formatos?: Record<string, NomeFormatador>;
  pagina: number;
  x: number;
  y: number;
  font: NomeFonte;
  tamanho: number;
  /** Hex da arte, ex: "#3A2E2A". */
  cor: string;
  /** Se o texto exceder, a fonte encolhe ate caber. Nunca quebra linha. */
  maxLargura?: number;
  /**
   * Desconta estes pt assim que o texto passa de 90% de `maxLargura`, ou seja,
   * ANTES de estourar. Serve ao cabecalho da capa, cujo tamanho varia com o
   * nome digitado pelo lead. Exige `maxLargura`.
   */
  recuoPreventivo?: number;
  /**
   * Sobe o texto para CAIXA ALTA na hora de desenhar (com
   * `toLocaleUpperCase("pt-BR")`, entao acento vai junto: "josé" -> "JOSÉ").
   *
   * Fica aqui, e nao no `arvore.json`, porque e decisao da ARTE: o que o lead
   * digitou continua intacto no banco, no painel e no e-mail.
   */
  caixaAlta?: boolean;
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

/**
 * Os dois campos dinamicos da CAPA, que todas as cinco artes compartilham.
 *
 * O desenho e sempre o mesmo: um cabecalho no topo alinhado a direita e, no
 * bloco "Olá,", o nome de quem preencheu na segunda linha. Muda so a
 * composicao do cabecalho e o x do bloco de saudacao.
 *
 * Medido no Figma e igual em todas as artes:
 *   - borda direita do cabecalho: 1150,5   |  y 64   |  45,522pt Light
 *   - topo do bloco "Olá,": y 393,5, e cada linha ocupa 95pt, entao a segunda
 *     linha (o nome) comeca em 488,5       |  73,122pt Light
 *   - branco, porque os dois ficam sobre a banda taupe
 */
function camposCapa(opcoes: {
  /** Ex: "15 ANOS DA {debutante} | {data}". */
  composicao: string;
  /** x do bloco "Olá,". Varia entre as artes. */
  xNome: number;
  /**
   * Borda direita do cabecalho. Quase sempre 1150,5, mas o aniversario
   * infantil fica em 1151 -- meio ponto, medido no Figma. Invisivel a olho nu,
   * mas nao ha razao para desalinhar de proposito.
   */
  xCabecalho?: number;
}): CampoTemplate[] {
  const BRANCO = "#FFFFFF";

  return [
    {
      chave: "cabecalho",
      composicao: opcoes.composicao,
      formatos: { data: "data_curta" },
      pagina: 0,
      x: opcoes.xCabecalho ?? 1150.5,
      y: 64,
      font: "DMSans-Light",
      tamanho: 45.52,
      cor: BRANCO,
      maxLargura: 900,
      alinhamento: "direita",
      // A arte pede o cabecalho todo em caixa alta. So ELE: a saudacao logo
      // abaixo ("Olá, Fulana!") mantem o nome como o lead escreveu.
      caixaAlta: true,
      // Caixa alta e mais larga que caixa baixa, entao o nome longo passa a
      // encostar na borda antes. 2pt a menos resolvem sem que se perceba.
      recuoPreventivo: 2,
    },
    {
      chave: "nome",
      // Composicao por causa do "!": no Figma a linha era "{{nome}}!" e a
      // exclamacao faz parte da saudacao, nao do nome digitado pelo lead.
      composicao: "{nome}!",
      pagina: 0,
      x: opcoes.xNome,
      y: 488.5,
      font: "DMSans-Light",
      tamanho: 73.12,
      cor: BRANCO,
      maxLargura: 620,
    },
  ];
}

/** Chaves de resposta que um campo consome, seja simples ou composto. */
export function chavesDoCampo(campo: CampoTemplate): string[] {
  if (campo.composicao) {
    return [...campo.composicao.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  }
  const caminho = campo.fonte ?? "";
  return caminho.startsWith("respostas.") ? [caminho.slice("respostas.".length)] : [];
}

/**
 * As CINCO artes reais, exportadas do Figma. Nenhuma roda mais sobre placeholder.
 *
 * A pagina exportada tem 1240x1754 pt, exatamente o tamanho do frame em px,
 * entao `escala: 1` e as coordenadas do painel do Figma valem direto.
 * Calibracao em /admin/debug-template?template=X, em PR dedicada contendo so
 * assets + este arquivo.
 *
 * Indexado por TemplateId, nao por Categoria: `aniversario` e uma categoria so
 * no banco, mas resolve entre duas artes conforme a idade.
 *
 * Todas seguem o mesmo desenho de capa (`camposCapa`); o que varia esta na
 * chamada de cada uma. Nenhuma arte imprime `horario`, `local` ou os campos de
 * making of: eles seguem sendo perguntados e ficam visiveis no painel, como
 * contexto para a Mel planejar.
 */
export const templates: Record<TemplateId, TemplateConfig> = {
  // ARTE REAL — frame debutante_01, node 835:2. Seis paginas; so a capa tem
  // texto dinamico. `horario`, `local`, `making_of` e `entrega` nao entram: a
  // arte nao reservou espaco. Seguem no painel como contexto para a Mel.
  debutante: {
    basePdf: "assets/templates/debutante.pdf",
    rotulo: "Festa de 15 anos",
    origemCoordenadas: "figma",
    escala: 1,
    campos: camposCapa({
      composicao: "15 ANOS DA {debutante} | {data}",
      xNome: 205,
    }),
  },

  // ARTE REAL — frame aniversario_infantil_01, node 356:8. Seis paginas; so a
  // capa tem texto dinamico. Unica arte cuja borda direita do cabecalho e 1151.
  aniversario_infantil: {
    basePdf: "assets/templates/aniversario_infantil.pdf",
    rotulo: "Aniversário infantil (até 14 anos)",
    origemCoordenadas: "figma",
    escala: 1,
    campos: camposCapa({
      composicao: "ANIVERSÁRIO {aniversariante} | {data}",
      xNome: 205,
      xCabecalho: 1151,
    }),
  },

  /**
   * ARTE REAL — frame aniversario_adulto_01, node 1651:2436. Seis paginas.
   *
   * ATENCAO: o cabecalho desta arte e "ANIVERSÁRIO | {{data}}", SEM o nome do
   * aniversariante -- diferente do infantil, que traz "ANIVERSÁRIO
   * {{aniversariante}} | {{data}}". A composicao abaixo reproduz a arte como
   * ela esta. Se a intencao era ter o nome, a correcao e na arte (criar a
   * variavel no Figma) e aqui, nao so aqui.
   *
   * Consequencia: `aniversariante` continua obrigatorio no formulario e
   * aparece no painel, mas nao e impresso nesta arte.
   */
  aniversario_adulto: {
    basePdf: "assets/templates/aniversario_adulto.pdf",
    rotulo: "Aniversário adulto (15 anos ou mais)",
    origemCoordenadas: "figma",
    escala: 1,
    campos: camposCapa({
      composicao: "ANIVERSÁRIO | {data}",
      xNome: 205,
      xCabecalho: 1151,
    }),
  },

  // ARTE REAL — frame casamento_01, node 1084:11243. Sete paginas (tem galeria
  // de fotos, que as outras nao tem); so a capa tem texto dinamico. `horario`,
  // `local_cerimonia` e `local_festa` nao entram: a arte nao reservou espaco.
  casamento: {
    basePdf: "assets/templates/casamento.pdf",
    rotulo: "Casamento",
    origemCoordenadas: "figma",
    escala: 1,
    campos: camposCapa({
      composicao: "{noivos} | {data}",
      xNome: 148.5,
    }),
  },

  /**
   * ARTE REAL — frame corporativo_01, node 1119:3277. Seis paginas.
   *
   * O cabecalho e "{{tipo_evento}} | {{data}}": varri os 6 frames e `empresa`
   * NAO aparece em lugar nenhum da arte. Ela continua sendo perguntada e serve
   * ao `nome_display` (lista do painel) e a copy do e-mail corporativo
   * ("Obrigada pelo interesse da {empresa}") -- so nao e impressa no PDF.
   */
  corporativo: {
    basePdf: "assets/templates/corporativo.pdf",
    rotulo: "Evento corporativo",
    origemCoordenadas: "figma",
    escala: 1,
    campos: camposCapa({
      composicao: "{tipo_evento} | {data}",
      xNome: 205,
      xCabecalho: 1151,
    }),
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
