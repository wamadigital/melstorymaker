import "server-only";

// Renderizacao do contrato em PDF: DocumentoContrato -> bytes + onde cada
// parte assina.
//
// Diferente da proposta, aqui nao ha arte de fundo: a pagina inteira e texto
// desenhado por nos. Por isso a diagramacao mora toda neste arquivo --
// quebra de linha, justificacao, paginacao, rodape e bloco de assinaturas.
// E e por isso tambem que sabemos, ao ponto, onde cada linha de assinatura
// foi desenhada: a plataforma de assinatura recebe essas posicoes e poe o
// campo de cada parte exatamente em cima da linha dela.
//
// Duas passadas. A primeira DIAGRAMA: mede cada palavra com a fonte real,
// quebra as linhas, decide as paginas e produz uma lista de comandos por
// pagina, com coordenadas de ORIGEM NO TOPO (y cresce para baixo), que e como
// se pensa uma pagina e como a iLoveAPI espera as posicoes. A segunda
// DESENHA: so ela fala com o pdf-lib, e so ela converte para a origem do PDF
// (canto INFERIOR esquerdo): y_pdf = ALTURA_PAGINA - y_topo. O rodape
// "Página X de Y" sai nessa segunda passada, quando Y ja e conhecido.
//
// Por que o texto e emitido com operadores de baixo nivel (TJ) e nao com
// `page.drawText`: justificar exige esticar o espaco entre as palavras, e o
// operador do PDF feito para isso (Tw) NAO age sobre fonte embutida como a
// DM Sans (codificacao de 2 bytes, em que o espaco nao e o byte 32). Desenhar
// palavra por palavra resolveria o visual, mas o texto copiado do PDF sairia
// sem espacos e o arquivo cresceria. Com TJ, cada linha e um trecho so, com o
// espaco de verdade entre as palavras e o ajuste de justificacao logo depois
// dele: o PDF copia e busca como texto normal.

import {
  PDFArray,
  PDFDocument,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  type PDFFont,
  type PDFName,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import {
  MarcacaoInvalidaError,
  numerarClausulas,
  parseNegrito,
  resolverReferencias,
  textoSemMarcacao,
  type TrechoMarcado,
} from "@/lib/contrato/marcacao";
import { sanitizarPdf } from "@/lib/contrato/texto";
import type { Assinante, DocumentoContrato, PosicaoAssinatura } from "@/lib/contrato/tipos";
import { carregarFontes } from "@/lib/pdf/fontes";
import { hexParaRgb } from "@/lib/pdf/geometria";

// ------------------------------------------------------------- geometria --

const LARGURA_PAGINA = 595.28; // A4
const ALTURA_PAGINA = 841.89;
const MARGEM_LATERAL = 64;
const MARGEM_TOPO = 64;
// A base e mais funda que o topo: o rodape mora nela, e texto rente ao
// rodape parece encostado nele.
const MARGEM_BASE = 72;
const LARGURA_UTIL = LARGURA_PAGINA - 2 * MARGEM_LATERAL;
/** y (a partir do topo) que nenhuma linha do corpo ultrapassa. */
const LIMITE_BASE = ALTURA_PAGINA - MARGEM_BASE;
const ALTURA_UTIL = LIMITE_BASE - MARGEM_TOPO;

/**
 * A geometria da pagina, para quem precisa conferir posicoes (testes e o
 * `contrato:verificar`) sem repetir numero magico.
 */
export const GEOMETRIA_CONTRATO = Object.freeze({
  larguraPagina: LARGURA_PAGINA,
  alturaPagina: ALTURA_PAGINA,
  margemLateral: MARGEM_LATERAL,
  margemTopo: MARGEM_TOPO,
  margemBase: MARGEM_BASE,
});

// ------------------------------------------------------------ tipografia --

// Corpo 12 pt: o CDC (art. 54, par. 3o) exige fonte nao inferior a 12 no
// contrato de adesao. Nao descer daqui "para caber numa pagina a menos".
const CORPO = 12;
const ENTRELINHA = CORPO * 1.45;
const ESPACO_PARAGRAFO = 8;
const ESPACO_ANTES_CLAUSULA = 16;
// Pouco espaco depois do titulo e muito antes dele: e a proximidade que diz
// ao olho que o titulo pertence ao texto de baixo, e nao ao de cima.
const ESPACO_DEPOIS_TITULO_CLAUSULA = 4;

const TITULO_DOCUMENTO = 14;
const ENTRELINHA_TITULO_DOCUMENTO = TITULO_DOCUMENTO * 1.35;
const ESPACO_DEPOIS_TITULO_DOCUMENTO = 22;

/** Item "A." pendurado: a letra na margem, o texto (e as linhas seguintes) alinhados depois dela. */
const RECUO_ITEM = 20;

/**
 * Linha justificada cujo espaco entre palavras passaria de 3x o normal sai
 * alinhada a esquerda. Sem hifenizacao (nao ha dicionario de pt-BR aqui), uma
 * linha com uma palavra comprida logo depois abriria buracos -- os "rios" que
 * atravessam o paragrafo. Uma linha curta a esquerda le melhor que um buraco.
 *
 * Antes de chegar nisso, a sobra da linha e distribuida em tres degraus, na
 * ordem em que o olho menos percebe (a mesma dos programas de paginacao):
 *   1. os espacos crescem ate 2x o normal;
 *   2. as letras se afastam ate 2,5% do corpo (0,3 pt no corpo 12). So as
 *      linhas dificeis chegam aqui -- as que terminam antes de uma palavra
 *      longa como "CONTRATANTE", que neste texto aparece em quase toda frase;
 *   3. os espacos voltam a crescer, ate o teto de 3x.
 */
const MAX_ESPACO_JUSTIFICADO = 3;
const ESPACO_CONFORTAVEL = 2;
const MAX_ESPACAMENTO_LETRAS = 0.025;

/**
 * Palavra maior que a linha inteira (o e-mail de 80 caracteres) e partida
 * ANTES destes caracteres, e so quando nao ha outro jeito: "beatriz.fontes"
 * + ".carvalho@exemplo.com.br". O separador no comeco da linha seguinte avisa
 * que o endereco continua (a regra do Manual de Chicago para URLs); um ponto
 * no FIM da linha seria lido como fim de frase, e um hifen inventado, como
 * parte do endereco. Pedaco sem separador que ainda nao caiba e partido por
 * caractere.
 */
const SEPARADORES_DE_QUEBRA = new Set(["@", ".", "/", "_", "-"]);

/**
 * Palavras que nao terminam uma linha quando o que vem depois e um NUMERO:
 * vao junto com ele, como com um espaco inseparavel. "R$" no fim de uma linha
 * e "1.500,00" no comeco da outra e o tipo de quebra que, num contrato, faz
 * alguem reler o valor duas vezes; "Cláusula" / "7." e "§" / "2º", idem. Antes
 * de palavra ("a cláusula prevalece") a quebra e livre.
 *
 * O espaco colado nao estica na justificacao -- como o espaco inseparavel do
 * Word --, o que ainda aproxima o "R$" do valor, que e onde ele deve estar.
 *
 * "nº" fica de fora de proposito: "sob o nº" no fim da linha le bem, e colado
 * ao CPF formaria um bloco de ~105 pt impossivel de encaixar sem buraco.
 */
const COLADAS_ANTES_DE_NUMERO = new Set([
  "R$",
  "§",
  "art.",
  "arts.",
  "Cláusula",
  "Cláusulas",
  "cláusula",
  "cláusulas",
  "CPF:",
  "CNPJ:",
]);
/** "p. Fulano" (por Fulano), no documento do CONTRATANTE PJ: o "p." nunca fica sozinho. */
const COLADAS_SEMPRE = new Set(["p."]);

const RODAPE = 10;
/** Baseline do "Página X de Y", a partir do topo: 40 pt acima da borda de baixo. */
const BASE_RODAPE = ALTURA_PAGINA - 40;

// -------------------------------------------------------------- assinaturas --

const LARGURA_ASSINATURA = 200;
/**
 * O texto sob a linha (nome, documento) pode passar um pouco dela: ocupa a
 * meia coluna menos um respiro, para "p. Fulano, CPF: ..." caber numa linha
 * so sem encostar no texto da coluna vizinha.
 */
const LARGURA_TEXTO_ASSINATURA = LARGURA_UTIL / 2 - 8;
/** Espaco em branco acima da linha, onde a assinatura eletronica e estampada. */
const ESPACO_PARA_ASSINAR = 48;
/** O campo da plataforma: 40 pt de altura, a 8 pt da linha. */
const ALTURA_CAMPO_ASSINATURA = 40;
const TEXTO_ASSINATURA = 10;
const ENTRELINHA_ASSINATURA = TEXTO_ASSINATURA * 1.35;
const ESPACO_SOB_TRACO = 5;
const ESPACO_ENTRE_FILEIRAS = 28;
const ESPACO_ANTES_LOCAL_DATA = 24;
const ESPACO_ANTES_ASSINATURAS = 16;
const ESPESSURA_TRACO = 0.75;
/**
 * x de cada coluna do bloco de assinaturas: a linha de 200 pt centrada em
 * cada metade da area util, espelhando o titulo centrado do topo.
 */
const COLUNAS_ASSINATURA = [0, 1].map(
  (i) => MARGEM_LATERAL + i * (LARGURA_UTIL / 2) + (LARGURA_UTIL / 2 - LARGURA_ASSINATURA) / 2,
);

// ------------------------------------------------------------------ cores --

/** A tinta escura da marca. Em papel, o marrom quase preto le como preto. */
const TINTA = hexParaRgb("#20130A");

/**
 * Cinza do rodape: a mesma tinta a 65% sobre o branco, pela mesma conta do
 * `--muted-foreground` do site. Derivada, e nao um hex novo, para a pagina
 * continuar com uma cor so.
 */
const TINTA_SECUNDARIA = sobreBranco(TINTA, 0.65);

function sobreBranco(cor: RGB, opacidade: number): RGB {
  const canal = (c: number) => c * opacidade + (1 - opacidade);
  return rgb(canal(cor.red), canal(cor.green), canal(cor.blue));
}

const EPS = 0.01;

/** Numeros do operador com 3 casas: sub-milesimo de ponto e so ruido no arquivo. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ------------------------------------------------ diagramacao (pura) --

export type Peso = "regular" | "negrito";

/** Mede um texto (sem quebra de linha) num peso, no tamanho do paragrafo. */
export type Medidor = {
  /** Corpo do paragrafo, em pt. */
  tamanho: number;
  largura: (texto: string, peso: Peso) => number;
  /**
   * Quantos glifos o texto vira no PDF (uma ligadura "fi" e um glifo so). O
   * espacamento entre letras e aplicado por glifo; sem esta contagem exata a
   * linha passaria da margem direita. Ausente = sem espacamento entre letras.
   */
  glifos?: (texto: string, peso: Peso) => number;
};

/** Trecho de um peso so. Nao tem espaco dentro, salvo nas palavras coladas ("R$ 1.500,00"). */
export type Fragmento = { texto: string; peso: Peso };

export type Palavra = {
  fragmentos: Fragmento[];
  largura: number;
  /** Peso do espaco que a separa da anterior: o espaco do negrito e mais estreito. */
  pesoEspacoAntes: Peso;
  /**
   * Pedaco de uma palavra longa partida (ver SEPARADORES_DE_QUEBRA): continua
   * a anterior SEM espaco. Pode comecar linha; nunca e esticado na
   * justificacao.
   */
  continuacao?: boolean;
};

export type LinhaDiagramada = {
  palavras: Palavra[];
  /** Palavras + espacos naturais entre elas, sem justificacao. */
  larguraNatural: number;
  /** Quanto cada espaco ganha para a linha encostar na margem direita (0 = a esquerda). */
  extraPorEspaco: number;
  /** Quanto cada glifo ganha depois de si (o Tc do PDF), em pt. */
  espacamentoLetras: number;
  /** Deslocamento da linha em relacao a margem (item pendurado). */
  recuo: number;
  /** O "A." do item, desenhado na margem, so na primeira linha. */
  marcador: Palavra | null;
};

const textoDaPalavra = (p: Palavra) => p.fragmentos.map((f) => f.texto).join("");

/** Junta fragmentos vizinhos de mesmo peso: um trecho so para medir e para desenhar. */
function juntarFragmentos(fragmentos: readonly Fragmento[]): Fragmento[] {
  const juntos: Fragmento[] = [];
  for (const f of fragmentos) {
    if (!f.texto) continue;
    const anterior = juntos[juntos.length - 1];
    if (anterior && anterior.peso === f.peso) anterior.texto += f.texto;
    else juntos.push({ texto: f.texto, peso: f.peso });
  }
  return juntos;
}

function montarPalavra(fragmentos: readonly Fragmento[], pesoEspacoAntes: Peso, medidor: Medidor): Palavra {
  const juntos = juntarFragmentos(fragmentos);
  // A largura e a soma dos trechos medidos um a um, exatamente como serao
  // desenhados: medir a palavra inteira de uma vez contaria uma ligadura que
  // o desenho, trocando de fonte no meio, nao faz.
  const largura = juntos.reduce((soma, f) => soma + medidor.largura(f.texto, f.peso), 0);
  return { fragmentos: juntos, largura, pesoEspacoAntes };
}

/**
 * Parte o texto (ja dividido em trechos normais e negritos) em palavras.
 *
 * Cada trecho passa por `sanitizarPdf` aqui, antes de ser medido: o que nao
 * tem glifo na DM Sans (emoji, soft hyphen, zero-width) viraria um
 * quadradinho com largura no meio do contrato. Uma palavra pode atravessar
 * trechos -- "**7**." e UMA palavra, "7" em negrito e "." normal --, porque o
 * que separa palavras e o espaco, nao a troca de peso.
 */
export function palavrasDeTrechos(trechos: readonly TrechoMarcado[], medidor: Medidor): Palavra[] {
  const palavras: Palavra[] = [];
  let atual: Fragmento[] = [];
  let pesoEspaco: Peso = "regular";

  const fechar = () => {
    if (atual.length) palavras.push(montarPalavra(atual, pesoEspaco, medidor));
    atual = [];
  };

  for (const trecho of trechos) {
    const peso: Peso = trecho.negrito ? "negrito" : "regular";
    for (const parte of sanitizarPdf(trecho.texto).split(/( +)/)) {
      if (!parte) continue;
      if (parte.startsWith(" ")) {
        fechar();
        pesoEspaco = peso;
      } else {
        atual.push({ texto: parte, peso });
      }
    }
  }
  fechar();

  return colarInseparaveis(palavras, medidor);
}

/** O paragrafo como vem do documento, com `**negrito**`. Lanca `MarcacaoInvalidaError` em `**` sem par. */
export function palavrasDoTexto(texto: string, medidor: Medidor): Palavra[] {
  return palavrasDeTrechos(parseNegrito(texto), medidor);
}

/** "R$" + "1.500,00" viram uma palavra so, com o espaco dentro (que nao estica). Ver COLADAS_ANTES_DE_NUMERO. */
function colarInseparaveis(palavras: Palavra[], medidor: Medidor): Palavra[] {
  const saida: Palavra[] = [];
  for (const palavra of palavras) {
    const anterior = saida[saida.length - 1];
    const texto = anterior ? textoDaPalavra(anterior) : "";
    const cola =
      COLADAS_SEMPRE.has(texto) || (COLADAS_ANTES_DE_NUMERO.has(texto) && /^\d/.test(textoDaPalavra(palavra)));
    if (anterior && cola) {
      saida[saida.length - 1] = montarPalavra(
        [...anterior.fragmentos, { texto: " ", peso: palavra.pesoEspacoAntes }, ...palavra.fragmentos],
        anterior.pesoEspacoAntes,
        medidor,
      );
    } else {
      saida.push(palavra);
    }
  }
  return saida;
}

type Caractere = { c: string; peso: Peso };

function palavraDeCaracteres(
  caracteres: readonly Caractere[],
  pesoEspacoAntes: Peso,
  continuacao: boolean,
  medidor: Medidor,
): Palavra {
  const palavra = montarPalavra(
    caracteres.map(({ c, peso }) => ({ texto: c, peso })),
    pesoEspacoAntes,
    medidor,
  );
  return continuacao ? { ...palavra, continuacao } : palavra;
}

/**
 * Parte uma palavra maior que a linha em pedacos que cabem: antes de cada
 * separador e, no pedaco que ainda nao couber, por caractere. Os pedacos nao
 * decidem a quebra -- so dizem ONDE ela pode acontecer. Quem escolhe e a
 * quebra de linha, como para qualquer outra palavra.
 */
function partirPalavraLonga(palavra: Palavra, largura: number, medidor: Medidor): Palavra[] {
  const caracteres: Caractere[] = palavra.fragmentos.flatMap((f) =>
    Array.from(f.texto, (c) => ({ c, peso: f.peso })),
  );
  const cabe = (cs: readonly Caractere[]) =>
    palavraDeCaracteres(cs, "regular", false, medidor).largura <= largura + EPS;

  const trechos: Caractere[][] = [];
  for (const caractere of caracteres) {
    const atual = trechos[trechos.length - 1];
    if (!atual || (SEPARADORES_DE_QUEBRA.has(caractere.c) && atual.length > 0)) trechos.push([caractere]);
    else atual.push(caractere);
  }

  const pedacos: Caractere[][] = [];
  for (const trecho of trechos) {
    let resto = trecho;
    while (resto.length && !cabe(resto)) {
      let n = 1;
      while (n < resto.length && cabe(resto.slice(0, n + 1))) n++;
      pedacos.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    if (resto.length) pedacos.push(resto);
  }

  return pedacos.map((cs, i) => palavraDeCaracteres(cs, palavra.pesoEspacoAntes, i > 0, medidor));
}

function novaLinha(palavras: Palavra[], larguraNatural: number): LinhaDiagramada {
  return { palavras, larguraNatural, extraPorEspaco: 0, espacamentoLetras: 0, recuo: 0, marcador: null };
}

/** Largura do espaco antes de `p` numa linha em que ela nao e a primeira. */
function espacoAntesDe(p: Palavra, medidor: Medidor): number {
  return p.continuacao ? 0 : medidor.largura(" ", p.pesoEspacoAntes);
}

/** Espacos de verdade entre as palavras da linha: os que a justificacao estica. */
function vaosDaLinha(palavras: readonly Palavra[]): number {
  return palavras.slice(1).filter((p) => !p.continuacao).length;
}

function larguraDasPalavras(palavras: readonly Palavra[], medidor: Medidor): number {
  return palavras.reduce((soma, p, i) => soma + p.largura + (i > 0 ? espacoAntesDe(p, medidor) : 0), 0);
}

type Justificacao = {
  extraPorEspaco: number;
  espacamentoLetras: number;
  /** A sobra nao cabe nos tres degraus: a linha vai alinhada a esquerda. */
  aEsquerda: boolean;
};

const A_ESQUERDA: Justificacao = { extraPorEspaco: 0, espacamentoLetras: 0, aEsquerda: true };

/**
 * Como a sobra de uma linha que NAO e a ultima do paragrafo e distribuida:
 * espacos ate 2x, letras ate 2,5% do corpo, espacos ate 3x -- ou, se nem
 * assim, linha a esquerda (ver MAX_ESPACO_JUSTIFICADO).
 */
function justificacao(
  palavras: readonly Palavra[],
  larguraNatural: number,
  largura: number,
  medidor: Medidor,
): Justificacao {
  const vaos = vaosDaLinha(palavras);
  const sobra = largura - larguraNatural;
  if (sobra <= EPS) return { extraPorEspaco: 0, espacamentoLetras: 0, aEsquerda: false };
  // Palavra sozinha numa linha que nao e a ultima: esticar as letras dela ate
  // a margem chamaria mais atencao do que a linha curta.
  if (vaos === 0) return A_ESQUERDA;

  const espaco = medidor.largura(" ", "regular");
  let resto = sobra;

  let extra = Math.min(resto / vaos, (ESPACO_CONFORTAVEL - 1) * espaco);
  resto -= extra * vaos;

  let letras = 0;
  if (resto > EPS && medidor.glifos) {
    // Os espacos tambem sao glifos e tambem recebem o Tc; o do ultimo glifo
    // fica depois da margem, invisivel -- dai o "- 1".
    const glifos =
      vaos +
      palavras.reduce((soma, p) => soma + p.fragmentos.reduce((s, f) => s + medidor.glifos!(f.texto, f.peso), 0), 0);
    if (glifos > 1) {
      letras = Math.min(resto / (glifos - 1), MAX_ESPACAMENTO_LETRAS * medidor.tamanho);
      resto -= letras * (glifos - 1);
    }
  }

  extra += resto / vaos;
  if (extra > (MAX_ESPACO_JUSTIFICADO - 1) * espaco + EPS) return A_ESQUERDA;
  return { extraPorEspaco: extra, espacamentoLetras: letras, aEsquerda: false };
}

/**
 * Quanto uma linha "custa" na escolha das quebras. E a conta do TeX: a
 * folga relativa ao cubo (uma linha frouxa custa muito mais que duas um pouco
 * frouxas) mais uma constante por linha, tudo ao quadrado. Linha que vai
 * alinhada a esquerda custa o pior caso possivel, multiplicado pelo tamanho
 * do buraco: menos linhas assim vem primeiro e, entre duas escolhas com o
 * mesmo numero delas, a de buraco menor ganha de qualquer folga de linha
 * justificada.
 */
function demerito(palavras: readonly Palavra[], larguraNatural: number, largura: number, medidor: Medidor): number {
  const j = justificacao(palavras, larguraNatural, largura, medidor);
  const sobra = largura - larguraNatural;
  if (j.aEsquerda) return (10 + 10_000) ** 2 * (1 + sobra / largura);
  const folga = sobra / (Math.max(1, vaosDaLinha(palavras)) * medidor.largura(" ", "regular"));
  return (10 + Math.min(10_000, 100 * folga ** 3)) ** 2;
}

/**
 * Quebra otima (Knuth-Plass sem hifenizacao): entre todas as maneiras de
 * partir o paragrafo, a de menor demerito somado. A quebra gulosa ("cabe?
 * poe") decide cada linha sem olhar a seguinte, e e assim que uma linha fica
 * apertada e a de baixo com um buraco; esta distribui a folga pelo paragrafo.
 *
 * Supoe que toda palavra cabe numa linha (`quebrarEmLinhas` parte antes as
 * que nao cabem). Devolve o indice da primeira palavra de cada linha.
 */
function quebrasOtimas(palavras: readonly Palavra[], largura: number, medidor: Medidor): number[] {
  const n = palavras.length;
  const custo = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const inicioDaLinha = new Array<number>(n + 1).fill(0);
  custo[0] = 0;

  for (let fim = 1; fim <= n; fim++) {
    let natural = 0;
    for (let inicio = fim - 1; inicio >= 0; inicio--) {
      natural += palavras[inicio].largura + (inicio < fim - 1 ? espacoAntesDe(palavras[inicio + 1], medidor) : 0);
      if (natural > largura + EPS) break;
      // A ultima linha nao e justificada: qualquer tamanho serve, e ela custa
      // so a constante por linha.
      const d = fim === n ? 10 ** 2 : demerito(palavras.slice(inicio, fim), natural, largura, medidor);
      if (custo[inicio] + d < custo[fim]) {
        custo[fim] = custo[inicio] + d;
        inicioDaLinha[fim] = inicio;
      }
    }
  }

  const inicios: number[] = [];
  for (let fim = n; fim > 0; fim = inicioDaLinha[fim]) inicios.unshift(inicioDaLinha[fim]);
  return inicios;
}

/**
 * Quebra gulosa, para o texto que NAO e justificado (titulos, local e data,
 * assinaturas): cada linha leva o que couber. Sem justificacao nao ha folga a
 * distribuir, e a otima nao teria o que melhorar.
 */
function quebrasGulosas(palavras: readonly Palavra[], largura: number, medidor: Medidor): Palavra[][] {
  const linhas: Palavra[][] = [];
  let atual: Palavra[] = [];
  let ocupado = 0;
  for (const p of palavras) {
    const espaco = atual.length ? espacoAntesDe(p, medidor) : 0;
    if (atual.length && ocupado + espaco + p.largura > largura + EPS) {
      linhas.push(atual);
      atual = [];
      ocupado = 0;
    }
    ocupado += (atual.length ? espaco : 0) + p.largura;
    atual.push(p);
  }
  if (atual.length) linhas.push(atual);
  return linhas;
}

/**
 * Quebra as palavras em linhas de ate `largura` e, se `justificar`, calcula
 * como cada linha encosta na margem direita -- menos a ultima, que num
 * paragrafo justificado sempre fica a esquerda.
 */
export function quebrarEmLinhas(
  palavras: readonly Palavra[],
  largura: number,
  medidor: Medidor,
  justificar: boolean,
): LinhaDiagramada[] {
  const cabiveis = palavras.flatMap((p) => (p.largura <= largura + EPS ? [p] : partirPalavraLonga(p, largura, medidor)));
  const grupos = justificar
    ? quebrasOtimas(cabiveis, largura, medidor).map((inicio, i, inicios) =>
        cabiveis.slice(inicio, inicios[i + 1] ?? cabiveis.length),
      )
    : quebrasGulosas(cabiveis, largura, medidor);

  const linhas = grupos.map((grupo) => novaLinha(grupo, larguraDasPalavras(grupo, medidor)));
  if (justificar) {
    linhas.slice(0, -1).forEach((linha) => {
      const j = justificacao(linha.palavras, linha.larguraNatural, largura, medidor);
      linha.extraPorEspaco = j.extraPorEspaco;
      linha.espacamentoLetras = j.espacamentoLetras;
    });
  }
  return linhas;
}

type OpcoesParagrafo = { justificar: boolean; itemPendurado: boolean };

/**
 * Um paragrafo em linhas. Com `itemPendurado`, um paragrafo que comeca com
 * "A." / "B." ... tem a letra na margem e o texto todo alinhado depois dela,
 * como numa lista -- as letras formam uma coluna e o olho acha o item sem ler.
 */
function diagramarParagrafo(
  palavras: readonly Palavra[],
  largura: number,
  medidor: Medidor,
  opcoes: OpcoesParagrafo,
): LinhaDiagramada[] {
  const [primeira, ...resto] = palavras;
  const ehItem =
    opcoes.itemPendurado &&
    primeira !== undefined &&
    resto.length > 0 &&
    /^[A-Z]\.$/.test(textoDaPalavra(primeira)) &&
    primeira.largura + medidor.largura(" ", "regular") <= RECUO_ITEM;

  if (!ehItem) return quebrarEmLinhas(palavras, largura, medidor, opcoes.justificar);

  const linhas = quebrarEmLinhas(resto, largura - RECUO_ITEM, medidor, opcoes.justificar);
  for (const linha of linhas) linha.recuo = RECUO_ITEM;
  linhas[0].marcador = primeira;
  return linhas;
}

/**
 * Quantas das `n` linhas de um paragrafo ficam nesta pagina, onde cabem
 * `cabem`. Controle de orfas e viuvas:
 *
 * - viuva: a ULTIMA linha nunca vai sozinha para o topo da pagina seguinte
 *   (desce mais uma junto);
 * - orfa: a PRIMEIRA linha nunca fica sozinha no pe da pagina (o paragrafo
 *   inteiro desce).
 *
 * No topo de uma pagina vazia nao ha para onde empurrar: fica o que couber.
 */
function linhasQueFicam(n: number, cabem: number, noTopo: boolean): number {
  if (cabem >= n) return n;
  let ficam = Math.max(0, cabem);
  if (ficam > 0 && n - ficam === 1) ficam -= 1;
  if (ficam === 1) ficam = 0;
  if (ficam === 0 && noTopo) ficam = Math.max(1, Math.min(n, cabem));
  return ficam;
}

// ------------------------------------------------------ texto resolvido --

type BlocoTexto = { trechos: TrechoMarcado[] };

type ConteudoResolvido = {
  titulo: string;
  partes: BlocoTexto[];
  preambulo: BlocoTexto;
  clausulas: { titulo: string; paragrafos: BlocoTexto[] }[];
  localData: BlocoTexto;
  assinaturas: Assinante[];
};

const RE_SOBRA = /\{\{|\}\}/;
const RE_NUMERO_PROPRIO = /\{\{\s*n\s*\}\}/;

/**
 * Parse do negrito com o lugar do erro na mensagem: "Cláusula 7: Há um ** sem
 * par..." diz a Mel onde procurar; o erro cru nao diz.
 */
function trechosDe(texto: string, onde: string): TrechoMarcado[] {
  if (RE_SOBRA.test(texto)) {
    throw new MarcacaoInvalidaError(
      `${onde}: sobrou uma marcação {{...}} sem resolver. Corrija o texto antes de gerar o PDF.`,
    );
  }
  try {
    return parseNegrito(texto);
  } catch (e) {
    if (e instanceof MarcacaoInvalidaError) throw new MarcacaoInvalidaError(`${onde}: ${e.message}`);
    throw e;
  }
}

/**
 * Resolve `{{n}}`/`{{ref:x}}` e o `**` de todo o documento ANTES de abrir o
 * PDF. Qualquer problema (remissao para clausula que nao existe, `**` sem
 * par, `{{` sobrando) lanca aqui, e nenhum byte e produzido: contrato
 * remetendo a "Cláusula {{ref:direitos}}" nao pode sair, nem como rascunho.
 */
function resolverConteudo(doc: DocumentoContrato): ConteudoResolvido {
  const mapa = numerarClausulas(doc.clausulas);

  // Fora das clausulas so `{{ref:x}}` faz sentido (o anuente remete a
  // "Dos direitos"). Um `{{n}}` ali nao tem numero para virar.
  const foraDeClausula = (texto: string, onde: string) => {
    if (RE_NUMERO_PROPRIO.test(texto)) {
      throw new MarcacaoInvalidaError(`${onde}: {{n}} só vale dentro de uma cláusula.`);
    }
    return trechosDe(resolverReferencias(texto, 0, mapa), onde);
  };

  return {
    titulo: textoSemMarcacao(doc.titulo).trim().toLocaleUpperCase("pt-BR"),
    partes: doc.partes.map((parte) => ({
      trechos: foraDeClausula(`**${parte.rotulo}:** ${parte.texto.trim()}`, `Qualificação (${parte.rotulo})`),
    })),
    preambulo: { trechos: foraDeClausula(doc.preambulo, "Preâmbulo") },
    clausulas: doc.clausulas.map((clausula, i) => {
      const numero = i + 1;
      const onde = `Cláusula ${numero}`;
      return {
        // Titulo sempre em caixa alta: clausula acrescentada no editor
        // ("Da cessão") sai com a mesma cara das do modelo.
        titulo: `CLÁUSULA ${numero} - ${textoSemMarcacao(clausula.titulo).trim().toLocaleUpperCase("pt-BR")}`,
        paragrafos: clausula.paragrafos
          .filter((p) => p.trim())
          .map((p) => ({ trechos: trechosDe(resolverReferencias(p, numero, mapa), onde) })),
      };
    }),
    localData: { trechos: foraDeClausula(doc.localData, "Local e data") },
    assinaturas: doc.assinaturas,
  };
}

// ------------------------------------------------------------ comandos --

type Peca = { texto: string; peso: Peso; ajusteDepois: number };

type Comando =
  | { tipo: "texto"; x: number; base: number; tamanho: number; cor: RGB; letras: number; pecas: Peca[] }
  | { tipo: "traco"; x: number; y: number; largura: number };

/**
 * A linha como sequencia de trechos para o TJ: cada espaco leva, logo depois
 * dele, o extra da justificacao. Trechos vizinhos de mesmo peso sem ajuste
 * entre eles viram um so.
 */
function pecasDaLinha(palavras: readonly Palavra[], extraPorEspaco: number): Peca[] {
  const pecas: Peca[] = [];
  const pendurar = (texto: string, peso: Peso, ajusteDepois: number) => {
    const anterior = pecas[pecas.length - 1];
    if (anterior && anterior.peso === peso && anterior.ajusteDepois === 0) {
      anterior.texto += texto;
      anterior.ajusteDepois = ajusteDepois;
    } else {
      pecas.push({ texto, peso, ajusteDepois });
    }
  };
  palavras.forEach((palavra, i) => {
    if (i > 0 && !palavra.continuacao) pendurar(" ", palavra.pesoEspacoAntes, extraPorEspaco);
    for (const f of palavra.fragmentos) pendurar(f.texto, f.peso, 0);
  });
  return pecas;
}

type Alinhamento = "justificado" | "esquerda" | "centro";

type Estilo = {
  tamanho: number;
  entrelinha: number;
  alinhamento: Alinhamento;
  cor: RGB;
  /** Coluna do bloco: margem esquerda e largura. */
  x: number;
  largura: number;
};

const ESTILO_CORPO: Estilo = {
  tamanho: CORPO,
  entrelinha: ENTRELINHA,
  alinhamento: "justificado",
  cor: TINTA,
  x: MARGEM_LATERAL,
  largura: LARGURA_UTIL,
};
const ESTILO_TITULO_CLAUSULA: Estilo = { ...ESTILO_CORPO, alinhamento: "esquerda" };
const ESTILO_LOCAL_DATA: Estilo = { ...ESTILO_CORPO, alinhamento: "esquerda" };
const ESTILO_TITULO_DOCUMENTO: Estilo = {
  ...ESTILO_CORPO,
  tamanho: TITULO_DOCUMENTO,
  entrelinha: ENTRELINHA_TITULO_DOCUMENTO,
  alinhamento: "centro",
};
const ESTILO_ASSINATURA: Estilo = {
  tamanho: TEXTO_ASSINATURA,
  entrelinha: ENTRELINHA_ASSINATURA,
  alinhamento: "centro",
  cor: TINTA,
  x: 0, // cada assinante tem a sua coluna
  largura: LARGURA_TEXTO_ASSINATURA,
};

type FontesPorPeso = Record<Peso, PDFFont>;

function criarMedidor(fontes: FontesPorPeso, tamanho: number): Medidor {
  const larguras = new Map<string, number>();
  const glifos = new Map<string, number>();
  const bytesPorGlifo = new Map<Peso, number>();
  return {
    tamanho,
    largura(texto, peso) {
      const chave = `${peso}|${texto}`;
      let largura = larguras.get(chave);
      if (largura === undefined) {
        largura = fontes[peso].widthOfTextAtSize(texto, tamanho);
        larguras.set(chave, largura);
      }
      return largura;
    },
    // Conta pelo que o pdf-lib de fato codifica, e nao pelos caracteres: a
    // DM Sans troca "fi" e "fl" por um glifo so. A fonte embutida usa 2 bytes
    // por glifo; a do fallback (Helvetica), 1. Codificar aqui so antecipa o
    // registro no subset de glifos que serao desenhados de qualquer jeito.
    glifos(texto, peso) {
      const chave = `${peso}|${texto}`;
      let n = glifos.get(chave);
      if (n === undefined) {
        const fonte = fontes[peso];
        let porGlifo = bytesPorGlifo.get(peso);
        if (porGlifo === undefined) {
          porGlifo = fonte.encodeText(" ").asBytes().length;
          bytesPorGlifo.set(peso, porGlifo);
        }
        n = fonte.encodeText(texto).asBytes().length / porGlifo;
        glifos.set(chave, n);
      }
      return n;
    },
  };
}

type AssinanteDiagramado = { assinante: Assinante; linhas: LinhaDiagramada[] };

// ---------------------------------------------------------- paginacao --

type ClausulaDiagramada = { titulo: LinhaDiagramada[]; paragrafos: LinhaDiagramada[][] };

class Diagramador {
  readonly paginas: Comando[][] = [[]];
  readonly posicoes: PosicaoAssinatura[] = [];
  /** Topo da proxima linha, a partir do topo da pagina. */
  y = MARGEM_TOPO;
  private readonly medidores = new Map<number, Medidor>();

  constructor(private readonly fontes: FontesPorPeso) {}

  private medidor(tamanho: number): Medidor {
    let medidor = this.medidores.get(tamanho);
    if (!medidor) {
      medidor = criarMedidor(this.fontes, tamanho);
      this.medidores.set(tamanho, medidor);
    }
    return medidor;
  }

  linhas(bloco: BlocoTexto, estilo: Estilo, itemPendurado = false): LinhaDiagramada[] {
    const medidor = this.medidor(estilo.tamanho);
    return diagramarParagrafo(palavrasDeTrechos(bloco.trechos, medidor), estilo.largura, medidor, {
      justificar: estilo.alinhamento === "justificado",
      itemPendurado,
    });
  }

  /**
   * Rotulo em negrito, nome e documento, cada um centrado sob a linha. O
   * documento do CONTRATANTE PJ ("CNPJ: ... — p. Fulano, CPF: ...") e partido
   * no travessao: cada documento na sua linha, em vez de um travessao solto
   * comecando a segunda.
   */
  assinante(assinante: Assinante): AssinanteDiagramado {
    const medidor = this.medidor(TEXTO_ASSINATURA);
    const blocos: TrechoMarcado[][] = [
      [{ texto: assinante.rotulo, negrito: true }],
      [{ texto: assinante.nome, negrito: false }],
      ...assinante.documento.split(/\s+[–—]\s+/).map((parte) => [{ texto: parte, negrito: false }]),
    ];
    const linhas = blocos.flatMap((trechos) =>
      quebrarEmLinhas(palavrasDeTrechos(trechos, medidor), LARGURA_TEXTO_ASSINATURA, medidor, false),
    );
    return { assinante, linhas };
  }

  get noTopo(): boolean {
    return this.y <= MARGEM_TOPO + EPS;
  }

  novaPagina(): void {
    this.paginas.push([]);
    this.y = MARGEM_TOPO;
  }

  private desenhar(comando: Comando): void {
    this.paginas[this.paginas.length - 1].push(comando);
  }

  /**
   * Baseline de uma linha a partir do topo da caixa dela: a altura da fonte
   * (ascendente + descendente) centrada na entrelinha. Medida na fonte que
   * de fato foi carregada, para o fallback tambem sair centrado.
   */
  private base(estilo: Estilo): number {
    const fonte = this.fontes.regular;
    const altura = fonte.heightAtSize(estilo.tamanho);
    const ascendente = fonte.heightAtSize(estilo.tamanho, { descender: false });
    return (estilo.entrelinha - altura) / 2 + ascendente;
  }

  private desenharLinha(linha: LinhaDiagramada, estilo: Estilo, xColuna = estilo.x): void {
    const base = this.y + this.base(estilo);
    const x =
      estilo.alinhamento === "centro"
        ? xColuna + (estilo.largura - linha.larguraNatural) / 2
        : xColuna + linha.recuo;
    const comum = { base, tamanho: estilo.tamanho, cor: estilo.cor };
    if (linha.marcador) {
      this.desenhar({ tipo: "texto", x: xColuna, ...comum, letras: 0, pecas: pecasDaLinha([linha.marcador], 0) });
    }
    this.desenhar({
      tipo: "texto",
      x,
      ...comum,
      letras: linha.espacamentoLetras,
      pecas: pecasDaLinha(linha.palavras, linha.extraPorEspaco),
    });
  }

  /** Quantas linhas de `entrelinha` cabem da altura `y` ate o limite de baixo. */
  private cabemAPartirDe(y: number, entrelinha: number): number {
    return Math.floor((LIMITE_BASE - y + EPS) / entrelinha);
  }

  /**
   * Coloca as linhas de um bloco. `espacoAntes` some no topo da pagina (espaco
   * de paragrafo no alto da folha so empurra o texto para baixo). Quando o
   * bloco nao cabe inteiro, `linhasQueFicam` decide onde partir.
   */
  colocar(linhas: readonly LinhaDiagramada[], estilo: Estilo, espacoAntes: number): void {
    let resto = linhas;
    let antes = espacoAntes;
    while (resto.length) {
      const inicio = this.noTopo ? this.y : this.y + antes;
      const ficam = linhasQueFicam(resto.length, this.cabemAPartirDe(inicio, estilo.entrelinha), this.noTopo);
      if (ficam === 0) {
        this.novaPagina();
        continue;
      }
      this.y = inicio;
      for (const linha of resto.slice(0, ficam)) {
        this.desenharLinha(linha, estilo);
        this.y += estilo.entrelinha;
      }
      resto = resto.slice(ficam);
      if (resto.length) {
        this.novaPagina();
        antes = 0;
      }
    }
  }

  /** Altura de uma clausula inteira, sem o espaco antes do titulo. */
  alturaClausula(clausula: ClausulaDiagramada): number {
    const corpo =
      clausula.paragrafos.reduce((soma, p) => soma + p.length * ENTRELINHA, 0) +
      Math.max(0, clausula.paragrafos.length - 1) * ESPACO_PARAGRAFO;
    return (
      clausula.titulo.length * ENTRELINHA + (clausula.paragrafos.length ? ESPACO_DEPOIS_TITULO_CLAUSULA + corpo : 0)
    );
  }

  /**
   * Titulo de clausula nunca fica sozinho no pe da pagina: se depois dele nao
   * couber o comeco do primeiro paragrafo (pela mesma regra de orfas que o
   * paragrafo seguiria), o titulo desce junto.
   */
  colocarClausula(clausula: ClausulaDiagramada): void {
    if (!this.noTopo) {
      const fimTitulo = this.y + ESPACO_ANTES_CLAUSULA + clausula.titulo.length * ENTRELINHA;
      const inicioCorpo = fimTitulo + ESPACO_DEPOIS_TITULO_CLAUSULA;
      const [primeiro] = clausula.paragrafos;
      const ficam = primeiro
        ? linhasQueFicam(primeiro.length, this.cabemAPartirDe(inicioCorpo, ENTRELINHA), false)
        : 1;
      if (fimTitulo > LIMITE_BASE + EPS || ficam === 0) this.novaPagina();
    }
    this.colocar(clausula.titulo, ESTILO_TITULO_CLAUSULA, ESPACO_ANTES_CLAUSULA);
    clausula.paragrafos.forEach((paragrafo, i) =>
      this.colocar(paragrafo, ESTILO_CORPO, i === 0 ? ESPACO_DEPOIS_TITULO_CLAUSULA : ESPACO_PARAGRAFO),
    );
  }

  private alturaFileira(fileira: readonly AssinanteDiagramado[]): number {
    const linhas = Math.max(0, ...fileira.map((a) => a.linhas.length));
    return ESPACO_PARA_ASSINAR + ESPACO_SOB_TRACO + linhas * ENTRELINHA_ASSINATURA;
  }

  /** "Local e data" + todas as fileiras de assinatura: o bloco que nunca se parte. */
  alturaFechamento(localData: readonly LinhaDiagramada[], fileiras: readonly AssinanteDiagramado[][]): number {
    return (
      ESPACO_ANTES_LOCAL_DATA +
      localData.length * ENTRELINHA +
      ESPACO_ANTES_ASSINATURAS +
      fileiras.reduce((soma, f) => soma + this.alturaFileira(f), 0) +
      Math.max(0, fileiras.length - 1) * ESPACO_ENTRE_FILEIRAS
    );
  }

  /**
   * Chamado antes da ULTIMA clausula. Se ela e o fechamento nao cabem juntos
   * no que resta da pagina, a clausula ja comeca na seguinte.
   *
   * Motivo: a pagina de assinaturas nao deve ser so assinaturas. Uma folha
   * com as linhas de assinatura e nenhuma clausula poderia ser grampeada em
   * qualquer outro documento; com o foro em cima dela ("E, por estarem assim
   * justos e contratados, assinam..."), fica presa a este. Se a clausula e o
   * fechamento nao cabem nem numa pagina vazia, vale so a regra do bloco.
   */
  manterComFechamento(ultima: ClausulaDiagramada, alturaFechamento: number): void {
    const junto = this.alturaClausula(ultima) + alturaFechamento;
    if (!this.noTopo && junto <= ALTURA_UTIL && this.y + ESPACO_ANTES_CLAUSULA + junto > LIMITE_BASE + EPS) {
      this.novaPagina();
    }
  }

  /**
   * "Local e data" e as assinaturas, em duas colunas (CONTRATANTE |
   * CONTRATADA) e o ANUENTE numa segunda fileira, a esquerda. O bloco inteiro
   * pula de pagina se nao couber: assinatura separada do "Local e data" -- ou
   * uma parte numa folha e a outra na seguinte -- e o tipo de coisa que
   * alguem questiona depois.
   */
  colocarFechamento(localData: readonly LinhaDiagramada[], fileiras: readonly AssinanteDiagramado[][]): void {
    if (!this.noTopo && this.y + this.alturaFechamento(localData, fileiras) > LIMITE_BASE + EPS) {
      this.novaPagina();
    }
    this.colocar(localData, ESTILO_LOCAL_DATA, ESPACO_ANTES_LOCAL_DATA);

    let topoFileira = this.y + ESPACO_ANTES_ASSINATURAS;
    fileiras.forEach((fileira, i) => {
      if (i > 0) topoFileira += ESPACO_ENTRE_FILEIRAS;
      const yTraco = topoFileira + ESPACO_PARA_ASSINAR;
      fileira.forEach(({ assinante, linhas }, coluna) => {
        const x = COLUNAS_ASSINATURA[coluna];
        this.posicoes.push({
          papel: assinante.papel,
          pagina: this.paginas.length,
          x: r3(x),
          // O campo da plataforma ocupa o alto da area em branco acima da
          // linha, e termina 8 pt antes dela: a assinatura "pousa" na linha
          // sem atravessa-la.
          yTopo: r3(topoFileira),
          largura: LARGURA_ASSINATURA,
          altura: ALTURA_CAMPO_ASSINATURA,
        });
        this.desenhar({ tipo: "traco", x, y: yTraco, largura: LARGURA_ASSINATURA });
        this.y = yTraco + ESPACO_SOB_TRACO;
        // Centrado no meio da LINHA, mesmo quando o texto e mais largo que ela.
        const xTexto = x + (LARGURA_ASSINATURA - LARGURA_TEXTO_ASSINATURA) / 2;
        for (const linha of linhas) {
          this.desenharLinha(linha, ESTILO_ASSINATURA, xTexto);
          this.y += ENTRELINHA_ASSINATURA;
        }
      });
      topoFileira += this.alturaFileira(fileira);
    });
    this.y = topoFileira;
  }
}

/** Assinantes de dois em dois: a ordem do documento (CONTRATANTE, CONTRATADA, ANUENTE) vira as fileiras. */
function emFileiras<T>(itens: readonly T[]): T[][] {
  const fileiras: T[][] = [];
  for (let i = 0; i < itens.length; i += 2) fileiras.push(itens.slice(i, i + 2));
  return fileiras;
}

function diagramar(
  conteudo: ConteudoResolvido,
  fontes: FontesPorPeso,
): { paginas: Comando[][]; posicoes: PosicaoAssinatura[] } {
  const d = new Diagramador(fontes);

  // Tudo e quebrado em linhas ANTES de paginar: as decisoes de pagina
  // (titulo que desce com o paragrafo, ultima clausula que desce com as
  // assinaturas) precisam saber a altura do que vem depois.
  const titulo = d.linhas({ trechos: [{ texto: conteudo.titulo, negrito: true }] }, ESTILO_TITULO_DOCUMENTO);
  const partes = conteudo.partes.map((parte) => d.linhas(parte, ESTILO_CORPO));
  const preambulo = d.linhas(conteudo.preambulo, ESTILO_CORPO);
  const clausulas: ClausulaDiagramada[] = conteudo.clausulas.map((clausula) => ({
    titulo: d.linhas({ trechos: [{ texto: clausula.titulo, negrito: true }] }, ESTILO_TITULO_CLAUSULA),
    paragrafos: clausula.paragrafos.map((p) => d.linhas(p, ESTILO_CORPO, true)).filter((linhas) => linhas.length),
  }));
  const localData = d.linhas(conteudo.localData, ESTILO_LOCAL_DATA);
  const fileiras = emFileiras(conteudo.assinaturas.map((a) => d.assinante(a)));

  d.colocar(titulo, ESTILO_TITULO_DOCUMENTO, 0);
  partes.forEach((parte, i) =>
    d.colocar(parte, ESTILO_CORPO, i === 0 ? ESPACO_DEPOIS_TITULO_DOCUMENTO : ESPACO_PARAGRAFO),
  );
  d.colocar(preambulo, ESTILO_CORPO, ESPACO_PARAGRAFO);

  const alturaFechamento = d.alturaFechamento(localData, fileiras);
  clausulas.forEach((clausula, i) => {
    if (i === clausulas.length - 1) d.manterComFechamento(clausula, alturaFechamento);
    d.colocarClausula(clausula);
  });
  d.colocarFechamento(localData, fileiras);

  return { paginas: d.paginas, posicoes: d.posicoes };
}

// ------------------------------------------------------------- desenho --

type ChavesDeFonte = Record<Peso, PDFName>;

/**
 * Converte um comando (origem no TOPO) em operadores do PDF (origem na BASE):
 * y_pdf = ALTURA_PAGINA - y_topo. E o unico lugar em que essa conta existe.
 */
function desenharComando(page: PDFPage, chaves: ChavesDeFonte, fontes: FontesPorPeso, comando: Comando): void {
  if (comando.tipo === "traco") {
    const y = ALTURA_PAGINA - comando.y;
    page.drawLine({
      start: { x: comando.x, y },
      end: { x: comando.x + comando.largura, y },
      thickness: ESPESSURA_TRACO,
      color: TINTA,
    });
    return;
  }

  const operadores: PDFOperator[] = [
    pushGraphicsState(),
    setFillingColor(comando.cor),
    beginText(),
    setTextMatrix(1, 0, 0, 1, r3(comando.x), r3(ALTURA_PAGINA - comando.base)),
  ];
  // Tc vale para todo glifo, inclusive na fonte embutida (ao contrario do Tw).
  // Fica dentro do q/Q: a linha seguinte comeca sem ele.
  if (comando.letras) operadores.push(setCharacterSpacing(r3(comando.letras)));
  let peso: Peso | null = null;
  let arranjo: PDFArray | null = null;
  const mostrar = () => {
    if (arranjo) operadores.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [arranjo]));
    arranjo = null;
  };

  for (const peca of comando.pecas) {
    if (peca.peso !== peso) {
      mostrar();
      operadores.push(setFontAndSize(chaves[peca.peso], comando.tamanho));
      peso = peca.peso;
    }
    arranjo ??= PDFArray.withContext(page.doc.context);
    // encodeText tambem registra os glifos no subset da fonte: todo texto
    // desenhado PRECISA passar por aqui, senao o glifo nao vai para o PDF.
    arranjo.push(fontes[peca.peso].encodeText(peca.texto));
    // No TJ, numero NEGATIVO afasta o proximo trecho, em milesimos do corpo.
    if (peca.ajusteDepois) arranjo.push(PDFNumber.of(r3((-peca.ajusteDepois * 1000) / comando.tamanho)));
  }
  mostrar();

  operadores.push(endText(), popGraphicsState());
  page.pushOperators(...operadores);
}

// ---------------------------------------------------------------- API --

export type ContratoRenderizado = {
  bytes: Uint8Array;
  paginas: number;
  /**
   * Onde estampar a assinatura de cada parte, na ordem de `doc.assinaturas`.
   * Em pontos, origem no canto SUPERIOR esquerdo, pagina a partir de 1 --
   * o formato "X -Y" da iLoveAPI sai direto daqui.
   */
  posicoes: PosicaoAssinatura[];
  /** true quando a DM Sans faltou e o PDF saiu em Helvetica. O painel avisa a Mel. */
  usouFallbackDeFonte: boolean;
};

const METADADOS = {
  titulo: "Contrato de prestação de serviços de storymaker",
  autor: "Mel Simão | Storymaker",
  sistema: "Sistema Mel",
} as const;

/**
 * Renderiza o contrato.
 *
 * Lanca, sem produzir PDF, quando o texto nao resolve: `ReferenciaInvalidaError`
 * (remissao para clausula que nao existe) e `MarcacaoInvalidaError` (`**` sem
 * par, `{{` sobrando, `{{n}}` fora de clausula). A rota valida o documento
 * antes (`validarDocumento`); isto e a ultima rede, para um contrato com
 * "Cláusula {{ref:direitos}}" nunca chegar a ninguem.
 *
 * `opcoes.agora` fixa a data dos metadados (testes e verificacao offline).
 */
export async function renderizarContrato(
  doc: DocumentoContrato,
  opcoes: { agora?: Date } = {},
): Promise<ContratoRenderizado> {
  const conteudo = resolverConteudo(doc);

  const pdfDoc = await PDFDocument.create();
  const carregadas = await carregarFontes(pdfDoc, ["DMSans-Regular", "DMSans-Bold"]);
  const fontes: FontesPorPeso = {
    regular: carregadas.obter("DMSans-Regular"),
    negrito: carregadas.obter("DMSans-Bold"),
  };

  const { paginas, posicoes } = diagramar(conteudo, fontes);
  const medidorRodape = criarMedidor(fontes, RODAPE);

  paginas.forEach((comandos, i) => {
    const page = pdfDoc.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
    // Uma chave de recurso por fonte por pagina. O drawText do pdf-lib cria
    // uma chave nova a cada troca de fonte -- num texto que alterna negrito,
    // centenas de entradas apontando para as mesmas duas fontes.
    const chaves: ChavesDeFonte = {
      regular: page.node.newFontDictionary(fontes.regular.name, fontes.regular.ref),
      negrito: page.node.newFontDictionary(fontes.negrito.name, fontes.negrito.ref),
    };
    for (const comando of comandos) desenharComando(page, chaves, fontes, comando);

    const rodape = `Página ${i + 1} de ${paginas.length}`;
    desenharComando(page, chaves, fontes, {
      tipo: "texto",
      x: (LARGURA_PAGINA - medidorRodape.largura(rodape, "regular")) / 2,
      base: BASE_RODAPE,
      tamanho: RODAPE,
      cor: TINTA_SECUNDARIA,
      letras: 0,
      pecas: [{ texto: rodape, peso: "regular", ajusteDepois: 0 }],
    });
  });

  const agora = opcoes.agora ?? new Date();
  pdfDoc.setTitle(METADADOS.titulo, { showInWindowTitleBar: true });
  pdfDoc.setAuthor(METADADOS.autor);
  pdfDoc.setCreator(METADADOS.sistema);
  pdfDoc.setProducer(METADADOS.sistema);
  pdfDoc.setCreationDate(agora);
  pdfDoc.setModificationDate(agora);
  pdfDoc.setLanguage("pt-BR");
  // A versao do modelo de clausulas vai junto do arquivo: e o que diz, anos
  // depois, de qual texto-base um contrato assinado saiu.
  pdfDoc.setKeywords([`modelo ${doc.versaoModelo}`]);

  // Sem object streams: PDF 1.7 simples, que qualquer leitor (e a plataforma
  // de assinatura) abre.
  const bytes = await pdfDoc.save({ useObjectStreams: false });

  return { bytes, paginas: paginas.length, posicoes, usouFallbackDeFonte: carregadas.usouFallback };
}
