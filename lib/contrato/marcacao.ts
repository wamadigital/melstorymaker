// A marcacao minima do texto do contrato: `{{n}}`, `{{ref:<id>}}` e `**negrito**`.
//
// Um modulo so para as tres, porque tres lugares precisam ler exatamente do
// mesmo jeito: o PDF (que desenha), o editor do painel (que mostra a previa) e
// a validacao (que recusa o que nao resolve). Se cada um tivesse o proprio
// parser, um `**` que o editor aceita poderia sair literal no PDF.
//
// Puro e sem "server-only".

/** Remissao `{{ref:x}}` para uma clausula que nao esta no documento. */
export class ReferenciaInvalidaError extends Error {
  constructor(readonly id: string) {
    super(`A remissão {{ref:${id}}} aponta para uma cláusula que não existe no contrato.`);
    this.name = "ReferenciaInvalidaError";
  }
}

/** `**` sem par: o PDF nao saberia onde o negrito termina. */
export class MarcacaoInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "MarcacaoInvalidaError";
  }
}

// Espaco dentro das chaves e tolerado ("{{ ref: direitos }}"): e o tipo de
// coisa que a Mel digita no editor, e recusar por isso seria implicancia.
const RE_NUMERO_PROPRIO = /\{\{\s*n\s*\}\}/g;
const RE_REFERENCIA = /\{\{\s*ref\s*:\s*([^{}\s]+)\s*\}\}/g;
const RE_CHAVES_COMPLETAS = /\{\{[^{}]*\}\}/g;
const RE_MARCADOR_RESOLVIVEL = /^\{\{\s*(?:n|ref\s*:\s*[^{}\s]+)\s*\}\}$/;
// "[CONTRATANTE]", "[ENDERECO_CONTRATANTE]": o formato dos placeholders da IA.
// Duas letras no minimo, para nao confundir com um "[A]" de enumeracao.
const RE_PLACEHOLDER_IA = /\[[A-ZÀ-Ý][A-ZÀ-Ý0-9_]+\]/g;

/**
 * Numero de cada clausula pelo id, na ordem do documento (1, 2, 3...).
 *
 * A numeracao nunca e digitada: e assim que um contrato antigo saiu com duas
 * "CLÁUSULA 13". Id repetido fica com a PRIMEIRA posicao -- quem acusa a
 * repeticao e a validacao do documento (`idsRepetidos`).
 */
export function numerarClausulas(clausulas: readonly { id: string }[]): Map<string, number> {
  const mapa = new Map<string, number>();
  clausulas.forEach((c, i) => {
    if (!mapa.has(c.id)) mapa.set(c.id, i + 1);
  });
  return mapa;
}

/** Ids que aparecem mais de uma vez, na ordem em que se repetem. */
export function idsRepetidos(clausulas: readonly { id: string }[]): string[] {
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  for (const { id } of clausulas) {
    if (vistos.has(id) && !repetidos.includes(id)) repetidos.push(id);
    vistos.add(id);
  }
  return repetidos;
}

/** Ids citados em `{{ref:...}}` no texto, sem repetir, na ordem em que aparecem. */
export function referenciasDoTexto(texto: string): string[] {
  const ids: string[] = [];
  for (const m of (texto ?? "").matchAll(RE_REFERENCIA)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/**
 * Troca `{{n}}` pelo numero desta clausula e `{{ref:x}}` pelo numero da
 * clausula x.
 *
 *   resolverReferencias("{{n}}.1. Ver Cláusula {{ref:direitos}}.", 13, mapa)
 *   -> "13.1. Ver Cláusula 10."
 *
 * Remissao para clausula ausente LANCA em vez de deixar o "{{ref:x}}" no
 * texto: melhor o PDF nao sair do que sair remetendo a uma clausula que nao
 * existe (se a Mel apagou "Dos direitos", "nos termos da Cláusula ?" nao e
 * contrato). Qualquer outro `{{...}}` fica como esta, para
 * `placeholdersRestantes` acusar.
 */
export function resolverReferencias(
  paragrafo: string,
  numeroDaClausula: number,
  mapaIds: ReadonlyMap<string, number>,
): string {
  return (paragrafo ?? "")
    .replace(RE_NUMERO_PROPRIO, String(numeroDaClausula))
    .replace(RE_REFERENCIA, (_, id: string) => {
      const numero = mapaIds.get(id);
      if (numero === undefined) throw new ReferenciaInvalidaError(id);
      return String(numero);
    });
}

/** Quantos `**` o texto tem, lidos da esquerda para a direita sem sobreposicao. */
function contarMarcadores(texto: string): number {
  return (texto ?? "").split("**").length - 1;
}

/** `**` em numero par: todo negrito aberto e fechado. */
export function negritoBalanceado(texto: string): boolean {
  return contarMarcadores(texto) % 2 === 0;
}

export type TrechoMarcado = { texto: string; negrito: boolean };

/**
 * Parte o paragrafo em trechos normais e em negrito. Cada `**` alterna.
 *
 *   "Texto **limitativo** e mais."
 *   -> [{ "Texto ", false }, { "limitativo", true }, { " e mais.", false }]
 *
 * Trecho vazio e descartado e trechos vizinhos de mesmo peso se juntam
 * ("a****b" e so "ab"). Os espacos das pontas de cada trecho sao mantidos: sao
 * eles que separam as palavras na linha do PDF.
 *
 * `**` sem par lanca `MarcacaoInvalidaError`: negrito no contrato e so para as
 * frases limitativas (CDC art. 54 §4º), e um negrito que "vaza" ate o fim do
 * paragrafo destacaria o que nao e limitativo.
 */
export function parseNegrito(texto: string): TrechoMarcado[] {
  const pedacos = (texto ?? "").split("**");
  if ((pedacos.length - 1) % 2 !== 0) {
    throw new MarcacaoInvalidaError("Há um ** sem par: todo trecho em negrito precisa abrir e fechar com **.");
  }

  const trechos: TrechoMarcado[] = [];
  pedacos.forEach((pedaco, i) => {
    if (!pedaco) return;
    const negrito = i % 2 === 1;
    const anterior = trechos[trechos.length - 1];
    if (anterior && anterior.negrito === negrito) anterior.texto += pedaco;
    else trechos.push({ texto: pedaco, negrito });
  });
  return trechos;
}

/** O texto como se le, sem os `**`. Para a IA, para comparacoes e para o texto corrido. */
export function textoSemMarcacao(texto: string): string {
  return (texto ?? "").split("**").join("");
}

/**
 * O que sobrou de marcacao que nao deveria estar no texto:
 *
 * - `{{...}}` que nao e `{{n}}` nem `{{ref:...}}` (chave de template esquecida);
 * - `{{` ou `}}` soltos (remissao digitada pela metade no editor);
 * - `[MAIUSCULAS_COM_UNDERSCORE]`, o formato dos placeholders da IA
 *   ("[CONTRATANTE]", "[CPF]") -- se um sobrou, o nome real nao voltou.
 *
 * Devolve cada ocorrencia uma vez, na ordem em que aparece. Lista vazia =
 * texto limpo.
 */
export function placeholdersRestantes(texto: string): string[] {
  const t = texto ?? "";
  const achados: string[] = [];
  const anotar = (s: string) => {
    if (!achados.includes(s)) achados.push(s);
  };

  for (const m of t.matchAll(RE_CHAVES_COMPLETAS)) {
    if (!RE_MARCADOR_RESOLVIVEL.test(m[0])) anotar(m[0]);
  }

  // Tirados os pares completos, qualquer "{{" ou "}}" que sobrar esta solto.
  // Anota com um pedaco do texto em volta, para a Mel achar onde esta.
  const semPares = t.replace(RE_CHAVES_COMPLETAS, " ");
  for (const m of semPares.matchAll(/\{\{[^\s{}]*|[^\s{}]*\}\}/g)) anotar(m[0]);

  for (const m of t.matchAll(RE_PLACEHOLDER_IA)) anotar(m[0]);

  return achados;
}
