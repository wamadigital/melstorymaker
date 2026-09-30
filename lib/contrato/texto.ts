// Pecas de texto pt-BR que o contrato repete em todo canto: concordancia de
// genero, endereco por extenso, preposicao do logradouro, lista com "e" e a
// limpeza do texto que vai para o PDF.
//
// Puro e sem "server-only": o painel usa as mesmas funcoes para a previa.

import type { Endereco, Genero } from "@/lib/contrato/tipos";
import { formatarCep } from "@/lib/contrato/documento";

// ------------------------------------------------------------ concordancia --

/**
 * Escolhe a forma pelo genero de quem e qualificado: "inscrito"/"inscrita",
 * "domiciliado"/"domiciliada".
 *
 * O genero e campo EXPLICITO que a Mel escolhe (tipos.ts). Sem ele ("") a
 * montagem nem chega a rodar -- mas a previa do painel pode, e ai a saida e
 * "inscrito/inscrita": visivelmente pendente, nunca um masculino silencioso.
 * Chutar o masculino e exatamente o erro de concordancia que 4 dos 17
 * contratos antigos tinham.
 */
export function flexao(genero: Genero | "", masc: string, fem: string): string {
  if (genero === "feminino") return fem;
  if (genero === "masculino") return masc;
  return `${masc}/${fem}`;
}

/** Artigo definido: "o"/"a" (e "o/a" enquanto o genero nao foi escolhido). */
export function o_a(genero: Genero | ""): string {
  return flexao(genero, "o", "a");
}

/** "brasileira"/"brasileiro". So se digita nacionalidade para estrangeiro. */
export function nacionalidadePadrao(genero: Genero | ""): string {
  return flexao(genero, "brasileiro", "brasileira");
}

/** A nacionalidade que vai na qualificacao: a digitada, ou a padrao pelo genero. */
export function nacionalidadeDe(pessoa: { nacionalidade?: string; genero: Genero | "" }): string {
  const digitada = colapsarEspacos(pessoa.nacionalidade ?? "");
  return digitada || nacionalidadePadrao(pessoa.genero);
}

// ----------------------------------------------------------------- utilidades --

function colapsarEspacos(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Forma de comparar dois textos digitados por pessoas diferentes: sem acento,
 * sem caixa, sem pontuacao. "Espaço Villa-Toscana" e "espaco villa toscana"
 * sao o mesmo lugar; "Ana & João" e "ana joao" sao as mesmas pessoas.
 */
export function normalizarComparacao(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Sobe a primeira letra. Algumas descricoes do catalogo comecam em minuscula
 * porque sao desenhadas para o meio da frase ("despesas de locomoção..."); ao
 * abrir um item "A. ...", a montagem passa por aqui.
 */
export function primeiraMaiuscula(s: string): string {
  return (s ?? "").replace(/^(\s*)(\p{L})/u, (_, espaco: string, letra: string) => espaco + letra.toLocaleUpperCase("pt-BR"));
}

/** ["a", "b", "c"] -> "a, b e c". Itens vazios sao ignorados. */
export function listaPtBr(itens: readonly string[]): string {
  const limpos = itens.map(colapsarEspacos).filter(Boolean);
  if (limpos.length <= 1) return limpos[0] ?? "";
  return `${limpos.slice(0, -1).join(", ")} e ${limpos[limpos.length - 1]}`;
}

// ----------------------------------------------------------------- endereco --

/** Tira espaco sobrando e virgula/ponto-e-virgula nas pontas (o que gera ", ," na juncao). */
function parteDeEndereco(s: string, manterPontoFinal: boolean): string {
  let t = colapsarEspacos(s).replace(/^[\s,;.]+/, "").replace(/[\s,;]+$/, "");
  // Ponto final so sobrevive no complemento, onde costuma ser abreviacao ("Apto.").
  if (!manterPontoFinal) t = t.replace(/\.+$/, "").trim();
  return t;
}

/**
 * Endereco em uma linha, como vai na qualificacao:
 *
 *   "Rua das Acácias, 120, Apto. 12, Jardim Primavera, Campinas/SP, CEP 13000-000"
 *
 * - numero vazio vira "s/n" (e "sn", "S/N", "s/nº" viram "s/n");
 * - "nº 28" vira "28" -- a virgula depois do logradouro ja diz que e numero;
 * - UF em maiuscula, e sem repetir quando a cidade veio como "Campinas - SP";
 * - nunca virgula dupla nem espaco sobrando, mesmo com partes vazias.
 */
export function enderecoPorExtenso(e: Endereco): string {
  const logradouro = parteDeEndereco(e.logradouro, false);

  let numero = parteDeEndereco(e.numero, false).replace(/^n[º°o]?\.?\s*(?=\d)/i, "");
  if (/^s\.?\s*\/?\s*n\.?\s*[º°o]?$/i.test(numero)) numero = "s/n";
  if (!numero && logradouro) numero = "s/n";

  const uf = parteDeEndereco(e.uf, false).toUpperCase();
  let cidade = parteDeEndereco(e.cidade, false);
  if (uf && cidade) {
    const ufRepetida = new RegExp(`[\\s/,-]+${uf.replace(/[^A-Z]/g, "")}$`, "i");
    cidade = cidade.replace(ufRepetida, "").trim();
  }
  const cidadeUf = cidade && uf ? `${cidade}/${uf}` : cidade || uf;

  const partes = [logradouro, numero, parteDeEndereco(e.complemento, true), parteDeEndereco(e.bairro, false), cidadeUf];
  let texto = partes.filter(Boolean).join(", ");

  const cep = parteDeEndereco(e.cep, false);
  if (cep) texto += `${texto ? ", " : ""}CEP ${formatarCep(cep)}`;
  return texto;
}

// Tipos de logradouro pelo genero da palavra. Com abreviacao, sem ponto.
const LOGRADOURO_FEMININO = new Set([
  "rua",
  "r",
  "avenida",
  "av",
  "alameda",
  "al",
  "estrada",
  "estr",
  "rodovia",
  "rod",
  "travessa",
  "tv",
  "trav",
  "praca",
  "pca",
  "via",
  "chacara",
  "fazenda",
  "ladeira",
  "viela",
  "servidao",
  "marginal",
  "passagem",
]);
const LOGRADOURO_MASCULINO = new Set([
  "largo",
  "lgo",
  "parque",
  "pq",
  "beco",
  "condominio",
  "cond",
  "sitio",
  "conjunto",
  "cj",
  "residencial",
  "loteamento",
  "lot",
  "nucleo",
  "viaduto",
]);

/**
 * "residente e domiciliada NA Rua...", "NO Condomínio...", e "EM" quando a
 * primeira palavra nao e um tipo de logradouro conhecido -- "em" e correto com
 * qualquer coisa, entao e o que sobra quando nao da para saber.
 */
export function preposicaoLogradouro(logradouro: string): "na" | "no" | "em" {
  const primeira = normalizarComparacao((logradouro ?? "").replace(/\./g, " ")).split(" ")[0] ?? "";
  if (LOGRADOURO_FEMININO.has(primeira)) return "na";
  if (LOGRADOURO_MASCULINO.has(primeira)) return "no";
  return "em";
}


// ------------------------------------------------------------ texto do PDF --
//
// Os caracteres daqui vao por CODEPOINT numerico, nunca literais: metade deles
// e invisivel (NBSP, zero-width, separador de linha), e um U+2028 literal
// dentro de uma regex quebra o proprio arquivo.

const cp = (n: number) => String.fromCodePoint(n);

/**
 * Codepoints que o PDF desenha: Latin-1 imprimivel mais a pontuacao
 * tipografica que a DM Sans tem (conferido glifo a glifo na Regular e na Bold).
 */
const PERMITIDOS_ALEM_DO_LATIN1 = new Set([
  0x201c, // aspas duplas de abertura
  0x201d, // aspas duplas de fechamento
  0x2018, // aspas simples de abertura
  0x2019, // aspas simples de fechamento / apostrofo
  0x2013, // meia-risca
  0x2014, // travessao
  0x2026, // reticencias
  0x2022, // marcador
  0x20ac, // euro
]);

function permitidoNoPdf(codigo: number): boolean {
  return (
    (codigo >= 0x20 && codigo <= 0x7e) ||
    (codigo >= 0xa1 && codigo <= 0xff && codigo !== 0xad) ||
    PERMITIDOS_ALEM_DO_LATIN1.has(codigo)
  );
}

/**
 * Tudo que e "espaco" para quem le: tab, quebras, NBSP e os espacos Unicode.
 * Vira um espaco comum.
 */
function ehEspaco(codigo: number): boolean {
  return (
    (codigo >= 0x09 && codigo <= 0x0d) || // tab, LF, VT, FF, CR
    codigo === 0xa0 || // NBSP
    codigo === 0x1680 ||
    (codigo >= 0x2000 && codigo <= 0x200a) || // espacos tipograficos
    codigo === 0x2028 || // separador de linha
    codigo === 0x2029 || // separador de paragrafo
    codigo === 0x202f || // NBSP estreito
    codigo === 0x205f ||
    codigo === 0x3000
  );
}

/**
 * Troca por equivalente o que tem equivalente obvio. O resto que nao for
 * permitido cai no fallback por decomposicao ("ő" -> "o") ou some.
 */
const EQUIVALENTES = new Map<number, string>([
  [0x2010, "-"], // hifen tipografico (a DM Sans nao tem)
  [0x2011, "-"], // hifen inseparavel (idem)
  [0x2012, cp(0x2013)], // figure dash -> meia-risca
  [0x2212, "-"], // sinal de menos
  [0x2015, cp(0x2014)], // barra horizontal -> travessao
  [0x201a, cp(0x2018)], // aspa simples baixa
  [0x201b, cp(0x2018)],
  [0x201e, cp(0x201c)], // aspa dupla baixa
  [0x201f, cp(0x201c)],
  [0x2032, "'"], // prime
  [0x2033, '"'], // double prime
  [0x02bc, cp(0x2019)], // apostrofo de letra modificadora (D'Avila em alguns teclados)
  [0x2044, "/"],
  [0x2215, "/"],
  // Letras sem decomposicao canonica: o fallback por NFKD nao as alcanca.
  [0x0152, "OE"],
  [0x0153, "oe"],
  [0x0141, "L"],
  [0x0142, "l"],
  [0x0110, "D"],
  [0x0111, "d"],
  [0x0126, "H"],
  [0x0127, "h"],
  [0x0131, "i"],
]);

/**
 * Deixa o texto desenhavel pela DM Sans do PDF.
 *
 * Por que precisa: embutida via fontkit, a fonte NAO lanca erro em caractere
 * sem glifo -- ele vira ".notdef", um quadradinho com largura, no meio do
 * contrato. Emoji num nome colado do WhatsApp, soft hyphen vindo de copiar e
 * colar de PDF, zero-width joiner de teclado de celular: tudo isso ja chega
 * nos dados da Mel.
 *
 * O que faz, nesta ordem:
 *  1. NFC (um "á" decomposto vira o "á" do Latin-1);
 *  2. tab, quebra de linha, NBSP e demais espacos Unicode viram espaco;
 *  3. mantem Latin-1 imprimivel e as aspas curvas, meia-risca, travessao,
 *     reticencias, marcador e euro;
 *  4. troca por equivalente o que tem (hifen tipografico, aspas baixas, Ł);
 *  5. o resto tenta a forma decomposta sem acento ("ő" -> "o", "ﬁ" -> "fi");
 *  6. o que ainda sobrar (emoji, controle, zero-width, soft hyphen) some;
 *  7. espacos repetidos viram um so.
 *
 * NAO apara as pontas de proposito: pode ser aplicado a um trecho do meio da
 * linha (um run de negrito), e aparar ali colaria as palavras vizinhas.
 */
export function sanitizarPdf(texto: string): string {
  let saida = "";
  for (const ch of String(texto ?? "").normalize("NFC")) {
    const codigo = ch.codePointAt(0) ?? 0;
    if (ehEspaco(codigo)) {
      saida += " ";
      continue;
    }
    if (permitidoNoPdf(codigo)) {
      saida += ch;
      continue;
    }
    const equivalente = EQUIVALENTES.get(codigo);
    if (equivalente !== undefined) {
      saida += equivalente;
      continue;
    }
    const decomposto = ch.normalize("NFKD").replace(/\p{M}/gu, "");
    if (decomposto && [...decomposto].every((c) => permitidoNoPdf(c.codePointAt(0) ?? 0))) {
      saida += decomposto;
    }
  }
  return saida.replace(/ {2,}/g, " ");
}
