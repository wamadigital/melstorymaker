// Validacao do documento do contrato e do texto que a IA redige, e a leitura
// "resolvida" (numeros no lugar de `{{n}}`/`{{ref:x}}`) que o editor, a IA e o
// PDF usam.
//
// O parser da marcacao mora em `marcacao.ts` e e so REEXPORTADO daqui: o PDF,
// o editor e a validacao precisam ler `**` e `{{ref:x}}` exatamente do mesmo
// jeito, e dois parsers acabariam discordando num canto.
//
// Puro e sem "server-only": o editor do painel valida enquanto a Mel digita.

import {
  CLAUSULAS_OBRIGATORIAS,
  IDS_CLAUSULA,
  type Assinante,
  type Clausula,
  type DadosContrato,
  type DocumentoContrato,
  type IdClausula,
  type Parte,
} from "@/lib/contrato/tipos";
import {
  idsRepetidos,
  negritoBalanceado,
  numerarClausulas,
  placeholdersRestantes,
  referenciasDoTexto,
  resolverReferencias,
  textoSemMarcacao,
} from "@/lib/contrato/marcacao";
import { cabecalhoClausula, TITULOS_CLAUSULA } from "@/lib/contrato/clausulas";

export {
  idsRepetidos,
  MarcacaoInvalidaError,
  negritoBalanceado,
  numerarClausulas,
  parseNegrito,
  placeholdersRestantes,
  ReferenciaInvalidaError,
  referenciasDoTexto,
  resolverReferencias,
  textoSemMarcacao,
  type TrechoMarcado,
} from "@/lib/contrato/marcacao";

// --------------------------------------------------------- texto resolvido --

export type ClausulaResolvida = {
  id: string;
  /** 1, 2, 3... na ordem do documento. */
  numero: number;
  titulo: string;
  /** "CLÁUSULA 7 - DO PAGAMENTO" */
  cabecalho: string;
  /** Com os numeros no lugar de `{{n}}`/`{{ref:x}}`. O `**` do negrito CONTINUA (o PDF e a previa o aplicam). */
  paragrafos: string[];
  origem: Clausula["origem"];
  problemas: string[];
};

export type TextoResolvido = {
  versaoModelo: string;
  titulo: string;
  partes: Parte[];
  preambulo: string;
  clausulas: ClausulaResolvida[];
  localData: string;
  assinaturas: Assinante[];
};

/**
 * O documento com a numeracao aplicada: `{{n}}` vira o numero da clausula e
 * `{{ref:x}}` o numero da clausula x -- inclusive nas partes (o ANUENTE remete
 * a clausula dos direitos). O negrito (`**`) fica: quem desenha e quem aplica.
 *
 * E a entrada certa para o PDF e para a previa do editor. Lanca
 * `ReferenciaInvalidaError` se uma remissao aponta para clausula que nao
 * existe -- chame `validarDocumento` antes para mostrar a lista de problemas
 * em vez de uma excecao.
 */
export function textoResolvido(doc: DocumentoContrato): TextoResolvido {
  const mapa = numerarClausulas(doc.clausulas);
  // Fora das clausulas nao ha "esta clausula": `{{n}}` ali e acusado por validarDocumento.
  const foraDeClausula = (t: string) => resolverReferencias(t, 0, mapa);

  return {
    versaoModelo: doc.versaoModelo,
    titulo: doc.titulo,
    partes: doc.partes.map((p) => ({ rotulo: p.rotulo, texto: foraDeClausula(p.texto) })),
    preambulo: foraDeClausula(doc.preambulo),
    clausulas: doc.clausulas.map((c, i) => ({
      id: c.id,
      numero: i + 1,
      titulo: c.titulo,
      cabecalho: cabecalhoClausula(i + 1, c.titulo),
      paragrafos: c.paragrafos.map((p) => resolverReferencias(p, i + 1, mapa)),
      origem: c.origem,
      problemas: [...c.problemas],
    })),
    localData: foraDeClausula(doc.localData),
    assinaturas: doc.assinaturas.map((a) => ({ ...a })),
  };
}

export type OpcoesTextoCorrido = {
  /** Ids de clausula que ficam de fora (a numeracao das outras NAO muda). */
  semClausulas?: readonly string[];
  /** Mantem os `**` (padrao: sim -- a IA ve onde o contrato poe o destaque). */
  comNegrito?: boolean;
  /**
   * Texto acrescentado ao fim do cabecalho de cada clausula ("CLÁUSULA 7 -
   * DO PAGAMENTO<marca>"). E por aqui que a entrada da IA diz de onde veio
   * cada clausula (modelo, IA, editada) -- ver `anonimizar`.
   */
  marcaDoCabecalho?: (clausula: Clausula) => string;
};

/**
 * O contrato em texto corrido, como se le: titulo, partes, preambulo,
 * "CLÁUSULA N - TÍTULO" e paragrafos, local e data, e as assinaturas (sem
 * e-mail, que nao e impresso). E a base do texto anonimizado da IA e da
 * conferencia dos numeros que a IA escreve.
 *
 * Remissao quebrada nao lanca aqui: o paragrafo sai como esta, com o
 * `{{ref:x}}` visivel (a validacao do documento e que acusa).
 */
export function textoCorrido(doc: DocumentoContrato, opcoes: OpcoesTextoCorrido = {}): string {
  const fora = new Set(opcoes.semClausulas ?? []);
  const negrito = opcoes.comNegrito ?? true;
  const mapa = numerarClausulas(doc.clausulas);
  const resolver = (t: string, n: number) => {
    let r: string;
    try {
      r = resolverReferencias(t, n, mapa);
    } catch {
      r = t;
    }
    return negrito ? r : textoSemMarcacao(r);
  };

  const blocos: string[] = [doc.titulo];
  for (const p of doc.partes) blocos.push(`${p.rotulo}: ${resolver(p.texto, 0)}`);
  blocos.push(resolver(doc.preambulo, 0));
  doc.clausulas.forEach((c, i) => {
    if (fora.has(c.id)) return;
    const cabecalho = cabecalhoClausula(i + 1, c.titulo) + (opcoes.marcaDoCabecalho?.(c) ?? "");
    blocos.push([cabecalho, ...c.paragrafos.map((p) => resolver(p, i + 1))].join("\n"));
  });
  blocos.push(resolver(doc.localData, 0));
  blocos.push(doc.assinaturas.map((a) => `${a.rotulo}: ${a.nome}, ${a.documento}`).join("\n"));
  return blocos.join("\n\n");
}

// --------------------------------------------------------- validar documento --

function nomeDaClausula(c: Pick<Clausula, "id" | "titulo">): string {
  const titulo = (c.titulo ?? "").trim() || TITULOS_CLAUSULA[c.id as IdClausula] || c.id;
  return `“${titulo}”`;
}

/** Os problemas de marcacao de um texto (partes, preambulo, paragrafos). */
function problemasDoTexto(
  texto: string,
  onde: string,
  ids: ReadonlySet<string>,
  dentroDeClausula: boolean,
): string[] {
  const problemas: string[] = [];
  if (!negritoBalanceado(texto)) {
    problemas.push(`${onde}: há um ** sem par (todo trecho em negrito precisa abrir e fechar com **).`);
  }
  for (const id of referenciasDoTexto(texto)) {
    if (!ids.has(id)) {
      const titulo = TITULOS_CLAUSULA[id as IdClausula];
      problemas.push(
        `${onde}: remete à cláusula ${titulo ? `“${titulo}”` : `“${id}”`}, que não está no contrato ({{ref:${id}}}).`,
      );
    }
  }
  for (const resto of placeholdersRestantes(texto)) {
    problemas.push(`${onde}: marcação que sobrou no texto: ${resto}`);
  }
  if (!dentroDeClausula && /\{\{\s*n\s*\}\}/.test(texto)) {
    problemas.push(`${onde}: {{n}} só vale dentro de uma cláusula.`);
  }
  return problemas;
}

/**
 * Tudo que impede o documento de virar PDF, em frases para a Mel. Lista
 * vazia = documento valido.
 *
 * Confere: titulo; CONTRATANTE e CONTRATADA nas partes e nas assinaturas;
 * clausulas obrigatorias presentes; ids unicos; clausula com titulo e texto;
 * `**` balanceado; remissoes que resolvem; nenhuma marcacao sobrando
 * (`{{chave}}`, `{{` solto, `[CONTRATANTE]` que a IA deixou).
 *
 * NAO confere os `problemas` das clausulas da IA: esses ja estao na propria
 * clausula, e a rota do PDF os checa a parte.
 */
export function validarDocumento(doc: DocumentoContrato): string[] {
  const problemas: string[] = [];

  if (!(doc.titulo ?? "").trim()) problemas.push("O contrato está sem título.");

  const rotulos = new Set(doc.partes.map((p) => p.rotulo));
  if (!rotulos.has("CONTRATANTE")) problemas.push("Falta a qualificação da CONTRATANTE.");
  if (!rotulos.has("CONTRATADA")) problemas.push("Falta a qualificação da CONTRATADA.");
  const papeis = new Set(doc.assinaturas.map((a) => a.papel));
  if (!papeis.has("contratante")) problemas.push("Falta a assinatura da CONTRATANTE.");
  if (!papeis.has("contratada")) problemas.push("Falta a assinatura da CONTRATADA.");

  const ids = new Set(doc.clausulas.map((c) => c.id));
  for (const id of CLAUSULAS_OBRIGATORIAS) {
    if (!ids.has(id)) problemas.push(`Falta a cláusula obrigatória “${TITULOS_CLAUSULA[id]}”.`);
  }
  for (const id of idsRepetidos(doc.clausulas)) {
    const titulo = TITULOS_CLAUSULA[id as IdClausula];
    problemas.push(`A cláusula ${titulo ? `“${titulo}”` : `“${id}”`} aparece mais de uma vez.`);
  }

  doc.partes.forEach((p) => {
    if (!p.texto.trim()) problemas.push(`A qualificação da ${p.rotulo} está vazia.`);
    problemas.push(...problemasDoTexto(p.texto, `Qualificação da ${p.rotulo}`, ids, false));
  });
  problemas.push(...problemasDoTexto(doc.preambulo, "Preâmbulo", ids, false));
  problemas.push(...problemasDoTexto(doc.localData, "Local e data", ids, false));

  doc.clausulas.forEach((c, i) => {
    const onde = `Cláusula ${i + 1} (${nomeDaClausula(c)})`;
    if (!c.titulo.trim()) problemas.push(`A cláusula ${i + 1} está sem título.`);
    if (c.paragrafos.every((p) => !p.trim())) problemas.push(`${onde}: está sem texto.`);
    c.paragrafos.forEach((p) => problemas.push(...problemasDoTexto(p, onde, ids, true)));
  });

  return problemas;
}

// ---------------------------------------------------------- normalizacao --

export type TextoNormalizado = {
  /** Sem acento (NFD sem as marcas) e minusculo. Pontuacao, digitos e espacos ficam. */
  texto: string;
  /** Para cada unidade de `texto`: onde comeca e onde termina, no original, o caractere de que ela veio. */
  inicio: number[];
  fim: number[];
};

/**
 * O texto sem acento e em minusculas, com o MAPA de volta para o original.
 *
 * Existe para comparar "Joao" com "João" e "ACÁCIAS" com "Acacias" sem perder
 * a posicao: quem acha um trecho no texto normalizado troca (ou cita) o trecho
 * do ORIGINAL, com a grafia que a pessoa escreveu. Mora aqui, e nao em
 * `anonimizar.ts`, porque a validacao do texto da IA tambem cita o trecho
 * original, e `anonimizar.ts` ja depende deste modulo.
 */
export function normalizarComMapa(original: string): TextoNormalizado {
  const s = original ?? "";
  let texto = "";
  const inicio: number[] = [];
  const fim: number[] = [];
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    const tam = cp > 0xffff ? 2 : 1;
    let n: string;
    if (cp < 0x80) n = cp >= 65 && cp <= 90 ? String.fromCharCode(cp + 32) : s[i];
    else n = String.fromCodePoint(cp).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
    // Marca de acento solta (texto que ja veio em NFD): gruda no caractere
    // anterior, para uma troca que termina nele nao deixar o til orfao.
    if (n === "" && fim.length > 0) fim[fim.length - 1] = i + tam;
    for (let k = 0; k < n.length; k++) {
      texto += n[k];
      inicio.push(i);
      fim.push(i + tam);
    }
    i += tam;
  }
  return { texto, inicio, fim };
}

// --------------------------------------------------------- texto da IA --

/** No maximo 8 paragrafos na clausula de condicoes especiais. */
export const MAXIMO_PARAGRAFOS_IA = 8;
/** E cada um com ate 1.500 caracteres. */
export const MAXIMO_CARACTERES_PARAGRAFO_IA = 1500;

const MOTIVO_RESPONSABILIDADE =
  "Tirar ou reduzir a responsabilidade da CONTRATADA por falha no serviço é nulo pelo CDC (arts. 25 e 51, I), e uma cláusula nula ainda enfraquece o resto do contrato.";
const MOTIVO_DEVOLUCAO =
  "Negar devolução que a lei garante, ou fazer a CONTRATANTE perder mais do que o sinal, é nulo (CDC art. 51, II e IV; CC arts. 413 e 420). O destino do sinal e dos demais valores já está na cláusula da desistência.";
const MOTIVO_ENCARGO =
  "Multa e juros não fazem parte do contrato-padrão: cobrar encargo é decisão da Mel sobre a política de cobrança, fora das condições especiais.";
const MOTIVO_RESCISAO =
  "Encerrar o contrato sem aviso ao consumidor é abusivo (CDC art. 51, IV, e art. 54, § 2º).";
const MOTIVO_UNILATERAL =
  "Mudar preço ou conteúdo do serviço pela vontade de uma parte só é nulo (CDC art. 51, X, XI e XIII).";

/**
 * O que a clausula da IA nao pode ter, lido sem acento e sem caixa. Cada um
 * vira PROBLEMA -- e clausula da IA com problema bloqueia o PDF ate a Mel
 * editar --, com o motivo em uma frase, porque a Mel precisa saber se tira o
 * trecho ou se reescreve.
 *
 * Por que a lista e larga: a clausula termina com "prevalecem sobre as demais
 * disposicoes deste contrato naquilo que expressamente modificarem". Um
 * "perderá os valores pagos" que escapasse aqui passaria a valer POR CIMA da
 * clausula da desistencia. Falso positivo custa uma edicao da Mel; falso
 * negativo vai para o contrato assinado.
 *
 * So roda sobre o texto que a IA redigiu (`montarContrato` tira o paragrafo
 * unico que o sistema acrescenta), entao nada aqui precisa conviver com o
 * texto do modelo.
 */
const TRECHOS_VEDADOS: { re: RegExp; rotulo: string; motivo: string }[] = [
  { re: /\bnao se responsabiliza/, rotulo: "não se responsabiliza", motivo: MOTIVO_RESPONSABILIDADE },
  { re: /\bnao (?:sera|serao) responsave/, rotulo: "não será responsável", motivo: MOTIVO_RESPONSABILIDADE },
  { re: /\b(?:exim[eia]\w*|exoner\w*)/, rotulo: "exime / exonera", motivo: MOTIVO_RESPONSABILIDADE },
  {
    // "isenta de cobrança" favorece a CONTRATANTE e passa; o que se barra e
    // isentar de responsabilidade, de dever ou de devolver.
    re: /\bisent[ao]s?(?:-se)?\s+(?:\S+\s+){0,3}?(?:responsab|obrigac|dever|culpa|dano|indeniz|ressarc|devoluc|reembols|restitu)/,
    rotulo: "isenta de responsabilidade",
    motivo: MOTIVO_RESPONSABILIDADE,
  },
  { re: /\bnao (?:sera|serao) (?:devolvid|reembolsad|restituid)/, rotulo: "não será devolvido", motivo: MOTIVO_DEVOLUCAO },
  { re: /\bnao havera (?:qualquer )?(?:devoluc|reembols|restituic)/, rotulo: "não haverá devolução", motivo: MOTIVO_DEVOLUCAO },
  { re: /\bsem direito a (?:qualquer )?(?:reembols|devoluc|restituic)/, rotulo: "sem direito a reembolso", motivo: MOTIVO_DEVOLUCAO },
  { re: /\bperder(?:a|ao)\b/, rotulo: "perderá", motivo: MOTIVO_DEVOLUCAO },
  { re: /\bperda (?:d[aeo]s? )?(?:valor|quantia|montante|pagamento|sinal)/, rotulo: "perda dos valores", motivo: MOTIVO_DEVOLUCAO },
  { re: /\bmultas?\b|\bclausula penal\b/, rotulo: "multa", motivo: MOTIVO_ENCARGO },
  { re: /\bjuros\b/, rotulo: "juros", motivo: MOTIVO_ENCARGO },
  { re: /\bde pleno direito\b/, rotulo: "de pleno direito", motivo: MOTIVO_RESCISAO },
  {
    re: /\bindependentemente de (?:qualquer )?(?:previa? )?(?:aviso|notificac|interpelac|comunicac)/,
    rotulo: "independentemente de notificação",
    motivo: MOTIVO_RESCISAO,
  },
  {
    re: /\bem nenhuma hipotese\b/,
    rotulo: "em nenhuma hipótese",
    motivo:
      "Frase absoluta costuma afastar um direito que a lei garante. Se a ideia era proteger a CONTRATANTE (não filmar ou não publicar alguém, por exemplo), diga só o combinado: “a CONTRATADA não publicará…”.",
  },
  {
    re: /\bforo\b|\bcomarca\b/,
    rotulo: "foro",
    motivo:
      "O foro já está na cláusula do foro (domicílio da CONTRATANTE, ou Monte Mor/SP para empresa); outro aqui deixaria o contrato com duas regras.",
  },
  {
    re: /\breajust/,
    rotulo: "reajuste",
    motivo: "O preço é o deste contrato; reajuste decidido por uma das partes é nulo (CDC art. 51, X).",
  },
  {
    re: /\brenuncia/,
    rotulo: "renúncia",
    motivo: "O consumidor não pode renunciar a direito que a lei lhe garante (CDC art. 51, I).",
  },
  { re: /\barbitra(?:gem|l)\b|\barbitro\b/, rotulo: "arbitragem", motivo: "Arbitragem imposta ao consumidor é nula (CDC art. 51, VII)." },
  {
    re: /\bonus da prova\b/,
    rotulo: "ônus da prova",
    motivo: "Inverter o ônus da prova contra a CONTRATANTE é nulo (CDC art. 51, VI).",
  },
  { re: /\ba criterio exclusivo da contratada\b/, rotulo: "a critério exclusivo da CONTRATADA", motivo: MOTIVO_UNILATERAL },
  { re: /\bunilateral/, rotulo: "unilateralmente", motivo: MOTIVO_UNILATERAL },
];

function semAcento(s: string): string {
  return normalizarComMapa(s).texto.replace(/\s+/g, " ");
}

// ------------------------------------------------------ numeros citados --
//
// "Todo numero precisa ter origem" com uma lista de numeros soltos nao
// segurava nada: 1 a 16 estavam em todo contrato (cabecalhos "CLÁUSULA N" e
// itens "7.1."), e 10, 30 e 70 tambem (prazos e percentuais). "Multa de 10%"
// passava porque existia um "10 dias". Agora o numero vale COM a unidade --
// "10%" so tem origem se algum lugar diz 10% --, o extenso conta ("trezentos
// reais" e um numero), a data e conferida como data, e a referencia nao tem
// cabecalho nem numeracao de item.

type Unidade = "R$" | "%" | "dias" | "horas" | "meses";

type Citacao =
  | { tipo: "numero"; valor: number; unidade: Unidade | null; escrito: string }
  | { tipo: "data"; dia: number; mes: number; ano: number | null; escrito: string };

const VALOR_DA_PALAVRA: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezassete: 17,
  dezoito: 18,
  dezenove: 19,
  dezanove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};
const MULTIPLICADORES: Record<string, number> = { mil: 1000, milhao: 1_000_000, milhoes: 1_000_000 };

/** "mil e quinhentos" -> 1500. `null` se alguma palavra nao e numeral. */
function valorPorExtenso(palavras: readonly string[]): number | null {
  let total = 0;
  let grupo = 0;
  let viu = false;
  for (const p of palavras) {
    if (p === "e") continue;
    const multiplicador = MULTIPLICADORES[p];
    if (multiplicador !== undefined) {
      total += (grupo || 1) * multiplicador;
      grupo = 0;
      viu = true;
      continue;
    }
    const v = VALOR_DA_PALAVRA[p];
    if (v === undefined) return null;
    grupo += v;
    viu = true;
  }
  return viu ? total + grupo : null;
}

const PALAVRA_NUMERAL = [...Object.keys(VALOR_DA_PALAVRA), ...Object.keys(MULTIPLICADORES)]
  .sort((a, b) => b.length - a.length)
  .join("|");
const SEQUENCIA_EXTENSO = `(?:${PALAVRA_NUMERAL})(?:\\s+(?:e\\s+)?(?:${PALAVRA_NUMERAL}))*`;
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?`;
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** A unidade logo depois do numero, ja no texto normalizado. */
const UNIDADE = String.raw`(reais|real|centavos?|por\s+cento|dias?|horas?|minutos?|meses|mes)(?![\p{L}\p{N}])`;
/** Parenteses so com letras: o extenso de "2 (duas)". Digito dentro nunca e engolido. */
const PARENTESE = String.raw`\s*\(([\p{L}\s,]{1,160})\)`;

/** "1.500,00" / "1500" -> 1500; "387,50" -> 387.5. */
function numeroCanonico(token: string): number {
  return Number(token.replace(/\./g, "").replace(",", "."));
}

function chave(valor: number): string {
  return String(Math.round(valor * 1000) / 1000);
}

/** Unidade da palavra que veio depois do numero; o valor ja convertido (minutos viram horas). */
function aplicarUnidade(valor: number, palavra: string | undefined): { valor: number; unidade: Unidade | null } {
  const u = (palavra ?? "").replace(/\s+/g, " ");
  if (!u) return { valor, unidade: null };
  if (u === "reais" || u === "real") return { valor, unidade: "R$" };
  if (u.startsWith("centavo")) return { valor: valor / 100, unidade: "R$" };
  if (u === "por cento") return { valor, unidade: "%" };
  if (u.startsWith("dia")) return { valor, unidade: "dias" };
  if (u.startsWith("hora")) return { valor, unidade: "horas" };
  if (u.startsWith("minuto")) return { valor: valor / 60, unidade: "horas" };
  return { valor, unidade: "meses" };
}

/**
 * O valor do extenso entre parenteses ("mil e quinhentos reais", "trinta por
 * cento", "duas"), sem a unidade. `null` quando o parentese nao e so um
 * numero por extenso -- ai ele nao e engolido e as palavras dele sao lidas
 * como texto comum.
 */
function valorDoParentese(conteudo: string): number | null {
  const palavras = conteudo.split(/[^\p{L}]+/u).filter(Boolean);
  const reais = palavras.findIndex((p) => p === "reais" || p === "real");
  if (reais >= 0) {
    const inteiro = reais === 0 ? 0 : valorPorExtenso(palavras.slice(0, reais));
    if (inteiro === null) return null;
    const resto = palavras.slice(reais + 1);
    if (resto.length === 0) return inteiro;
    if (resto.at(-1)?.startsWith("centavo")) {
      const centavos = valorPorExtenso(resto.slice(0, -1));
      return centavos === null ? null : inteiro + centavos / 100;
    }
    return null;
  }
  const semUnidade = palavras.filter(
    (p) => !/^(por|cento|dias?|uteis|corridos|horas?|minutos?|meses|mes|segundos?|anos?)$/.test(p),
  );
  return valorPorExtenso(semUnidade);
}

/**
 * Tudo que o texto afirma como numero: valores, percentuais, prazos, horas e
 * datas -- em digitos ou por extenso. Tambem devolve os "2 (tres)": digito e
 * extenso que nao batem, erro que a Mel nao ve lendo rapido.
 */
function citacoesDoTexto(texto: string): { citacoes: Citacao[]; divergentes: string[] } {
  const n = normalizarComMapa(texto);
  let t = n.texto;
  const achadas: { posicao: number; citacao: Citacao }[] = [];
  const divergentes: string[] = [];
  const original = (ini: number, fim: number) => (texto ?? "").slice(n.inicio[ini], n.fim[fim - 1]).trim();
  const consumir = (ini: number, fim: number) => {
    t = t.slice(0, ini) + " ".repeat(fim - ini) + t.slice(fim);
  };
  const numero = (posicao: number, valor: number, unidade: Unidade | null, escrito: string) =>
    achadas.push({ posicao, citacao: { tipo: "numero", valor, unidade, escrito } });

  // 1. Datas por extenso: "23 de janeiro de 2027", "1º de março".
  const reDataExtenso = new RegExp(
    `(?<![\\p{L}\\p{N}])(\\d{1,2}|primeiro)(?:º|o)?\\s+de\\s+(${MESES.join("|")})(?:\\s+de\\s+(\\d{4}))?(?![\\p{L}\\p{N}])`,
    "gu",
  );
  for (const m of [...t.matchAll(reDataExtenso)]) {
    const dia = m[1] === "primeiro" ? 1 : Number(m[1]);
    const fim = m.index + m[0].length;
    achadas.push({
      posicao: m.index,
      citacao: { tipo: "data", dia, mes: MESES.indexOf(m[2]) + 1, ano: m[3] ? Number(m[3]) : null, escrito: original(m.index, fim) },
    });
    consumir(m.index, fim);
  }

  // 2. Datas numericas: "10/03/2027", "10/12".
  for (const m of [...t.matchAll(/(?<![\d/.,])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g)]) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    const ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null;
    const fim = m.index + m[0].length;
    achadas.push({ posicao: m.index, citacao: { tipo: "data", dia, mes, ano, escrito: original(m.index, fim) } });
    consumir(m.index, fim);
  }

  // 3. Horas: "16h", "20h30", "2h".
  for (const m of [...t.matchAll(/(?<![\p{L}\p{N}.,])(\d{1,2})\s?h(?:\s?(\d{2})(?:\s?min)?)?(?![\p{L}\p{N}])/gu)]) {
    const fim = m.index + m[0].length;
    numero(m.index, Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0), "horas", original(m.index, fim));
    consumir(m.index, fim);
  }

  // 4. Digitos: "R$ 1.500,00 (mil e quinhentos reais)", "30% (trinta por cento)",
  //    "2 (duas) horas", "45 dias", "1500".
  const reDigitos = new RegExp(
    `(r\\$\\s*)?(?<![\\p{L}\\p{N}.,])(${NUM})(\\s*%)?(?:${PARENTESE})?(?:\\s*${UNIDADE})?`,
    "gu",
  );
  for (const m of [...t.matchAll(reDigitos)]) {
    const [inteiro, cifrao, digitos, porcento, parentese, unidadeDepois] = m;
    const valorDigitos = numeroCanonico(digitos);
    // Onde cada pedaco termina, relativo ao comeco do match.
    const fimDigitos = (cifrao ?? "").length + digitos.length + (porcento ?? "").length;
    let fim = unidadeDepois ? inteiro.length : fimDigitos;
    let unidadeTexto: string | undefined = unidadeDepois;

    if (parentese !== undefined) {
      const extenso = valorDoParentese(parentese);
      if (extenso === null) {
        // Parentese que nao e extenso ("10 (conforme combinado) dias"): nao
        // e engolido -- as palavras dele sao lidas depois, como texto -- e a
        // unidade que vem depois dele nao e deste numero.
        fim = fimDigitos;
        unidadeTexto = undefined;
      } else {
        if (!unidadeDepois) fim = inteiro.indexOf(")") + 1;
        if (chave(extenso) !== chave(valorDigitos)) divergentes.push(original(m.index, m.index + inteiro.indexOf(")") + 1));
      }
    }

    let unidade: Unidade | null;
    let valor = valorDigitos;
    if (cifrao) unidade = "R$";
    else if (porcento) unidade = "%";
    else ({ valor, unidade } = aplicarUnidade(valorDigitos, unidadeTexto));

    numero(m.index, valor, unidade, original(m.index, m.index + fim));
    consumir(m.index, m.index + fim);
  }

  // 5. Por extenso, sem digito: "trezentos reais", "dez por cento",
  //    "quarenta e cinco dias", "mil e quinhentos reais e cinquenta centavos".
  const reExtenso = new RegExp(
    `(?<![\\p{L}\\p{N}])(${SEQUENCIA_EXTENSO})(?![\\p{L}\\p{N}])(?:\\s+${UNIDADE})?(?:\\s+e\\s+(${SEQUENCIA_EXTENSO})\\s+centavos?(?![\\p{L}\\p{N}]))?`,
    "gu",
  );
  for (const m of [...t.matchAll(reExtenso)]) {
    const [inteiro, sequencia, unidadeDepois, centavos] = m;
    const palavras = sequencia.split(/\s+/);
    // "um" e "uma" sozinhos, sem unidade, sao artigo ("uma cobertura").
    if (palavras.length === 1 && (palavras[0] === "um" || palavras[0] === "uma") && !unidadeDepois) continue;
    const base = valorPorExtenso(palavras);
    if (base === null) continue;
    const comUnidade = aplicarUnidade(base, unidadeDepois);
    const unidade = comUnidade.unidade;
    let valor = comUnidade.valor;
    if (centavos && unidade === "R$") valor += (valorPorExtenso(centavos.split(/\s+/)) ?? 0) / 100;
    const fim = m.index + inteiro.length;
    numero(m.index, valor, unidade, original(m.index, fim));
    consumir(m.index, fim);
  }

  // 6. Qualquer digito que sobrou ("3x", "CPF12345"): numero sem unidade.
  for (const m of t.matchAll(new RegExp(NUM, "g"))) {
    numero(m.index, numeroCanonico(m[0]), null, original(m.index, m.index + m[0].length));
  }

  achadas.sort((a, b) => a.posicao - b.posicao);
  return { citacoes: achadas.map((a) => a.citacao), divergentes };
}

type Referencia = {
  /** "R$:1500", "%:30", "dias:10" */
  comUnidade: Set<string>;
  /** Qualquer numero, com ou sem unidade: serve ao numero que a IA escreveu sem unidade. */
  qualquer: Set<string>;
  /** Numero sem unidade nas OBSERVACOES: a Mel anota "fechei em 380" sem o R$. */
  soltoNasObservacoes: Set<string>;
  /** "2027-01-23". */
  datas: Set<string>;
  /** "01-23", de toda data da referencia, com ou sem ano. */
  diasMeses: Set<string>;
  /** "01-23" das datas SEM ano ("pagou dia 10/03", nas observacoes). */
  diasMesesSemAno: Set<string>;
  /** Os anos que aparecem na referencia (o do evento, o do vencimento). */
  anos: Set<number>;
};

function anotarReferencia(ref: Referencia, citacoes: readonly Citacao[], dasObservacoes: boolean): void {
  for (const c of citacoes) {
    if (c.tipo === "data") {
      const mmdd = `${String(c.mes).padStart(2, "0")}-${String(c.dia).padStart(2, "0")}`;
      ref.diasMeses.add(mmdd);
      if (c.ano !== null) {
        ref.datas.add(`${c.ano}-${mmdd}`);
        ref.anos.add(c.ano);
      } else {
        ref.diasMesesSemAno.add(mmdd);
      }
      // "de 2027" solto, ou o dia citado sozinho, tambem tem origem.
      ref.qualquer.add(chave(c.dia));
      if (c.ano !== null) ref.qualquer.add(chave(c.ano));
      continue;
    }
    ref.qualquer.add(chave(c.valor));
    if (c.unidade) ref.comUnidade.add(`${c.unidade}:${chave(c.valor)}`);
    else if (dasObservacoes) ref.soltoNasObservacoes.add(chave(c.valor));
  }
}

/**
 * O contrato como referencia de numeros: partes, preambulo e paragrafos, SEM
 * os cabecalhos "CLÁUSULA N" e sem a numeracao dos itens ("{{n}}.1.") e das
 * remissoes ("Cláusula {{ref:x}}"). Numeracao nao e conteudo -- e era ela que
 * fazia qualquer numero de 1 a 16 "ter origem".
 */
function textoDeReferencia(documento: DocumentoContrato, semClausulas: ReadonlySet<string>): string {
  const semNumeracao = (t: string) =>
    textoSemMarcacao((t ?? "").replace(/\{\{\s*(?:n|ref:[^{}]*)\s*\}\}(?:\.\d+)*\.?/g, " "));
  const blocos = [...documento.partes.map((p) => p.texto), documento.preambulo];
  for (const c of documento.clausulas) if (!semClausulas.has(c.id)) blocos.push(...c.paragrafos);
  blocos.push(documento.localData, ...documento.assinaturas.map((a) => `${a.nome}, ${a.documento}`));
  return blocos.map(semNumeracao).join("\n");
}

/** Os numeros dos dados que a Mel preencheu, cada um com a sua unidade. */
function citacoesDosDados(dados: DadosContrato): Citacao[] {
  const c: Citacao[] = [];
  const num = (valor: number, unidade: Unidade | null) => c.push({ tipo: "numero", valor, unidade, escrito: "" });
  const data = (iso: string | undefined) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
    if (m) c.push({ tipo: "data", ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]), escrito: "" });
  };
  const hora = (hhmm: string | undefined) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
    if (m) num(Number(m[1]) + Number(m[2]) / 60, "horas");
  };

  const s = dados.servico;
  const e = s.escopo;
  num(s.valorPacote / 100, "R$");
  num(s.desconto / 100, "R$");
  for (const a of s.adicionais) {
    num(a.valorUnitario / 100, "R$");
    num((a.quantidade * a.valorUnitario) / 100, "R$");
    num(a.quantidade, null);
    if (a.minutos > 0) {
      num(a.minutos / 60, "horas");
      num((a.minutos * a.quantidade) / 60, "horas");
    }
    if (a.tipo === "hora_adicional") num(a.quantidade, "horas");
  }
  for (const minutos of [e.minutosCobertura, e.minutosMakingOf, e.minutosEnsaio]) if (minutos > 0) num(minutos / 60, "horas");
  for (const dias of [e.diasStories, e.diasMaterial, e.diasReels]) num(dias, "dias");
  num(e.segundosReels, null);
  num(e.storymakers, null);
  num(e.reels.length, null);

  const p = dados.pagamento;
  num(p.percentualSinalQuitado, "%");
  data(p.quitadoEm);
  for (const parcela of p.parcelas) {
    num(parcela.percentual, "%");
    const v = parcela.vencimento;
    if (v.tipo === "dias_antes") num(v.dias, "dias");
    if (v.tipo === "data" || v.tipo === "pago") data(v.data);
  }

  const ev = dados.evento as DadosContrato["evento"] & { ensaioData?: string; ensaioHorario?: string };
  data(ev.data);
  data(ev.ensaioData);
  hora(ev.horarioInicio);
  hora(ev.makingOfHorario);
  hora(ev.ensaioHorario);
  return c;
}

function descreverCitacao(c: Citacao): string {
  return `“${c.escrito}”`;
}

function temOrigem(c: Citacao, ref: Referencia): boolean {
  if (c.tipo === "data") {
    const mmdd = `${String(c.mes).padStart(2, "0")}-${String(c.dia).padStart(2, "0")}`;
    if (c.ano === null) return ref.diasMeses.has(mmdd);
    // A Mel anotou "10/03" e a IA escreveu "10 de março de 2027", como o
    // prompt pede: vale se o ano e um dos que o contrato ja usa.
    return ref.datas.has(`${c.ano}-${mmdd}`) || (ref.diasMesesSemAno.has(mmdd) && ref.anos.has(c.ano));
  }
  const k = chave(c.valor);
  if (c.unidade === null) return ref.qualquer.has(k);
  return ref.comUnidade.has(`${c.unidade}:${k}`) || ref.soltoNasObservacoes.has(k);
}

/** Marcador repetido ("[CONTRATANTE] [CONTRATANTE]"): um nome coincidiu com o de alguem do contrato. */
const RE_MARCADOR_REPETIDO = /(\[[A-Z_]{2,40}\])(?:\s+\1)+/g;
/** O mesmo, depois de `desanonimizar`: "Chácara Santa a CONTRATANTE a CONTRATANTE". */
const RE_PAPEL_REPETIDO = /\bCONTRATANTE,?\s+(?:(?:a|à|da|na|pela|para a|com a)\s+)?CONTRATANTE\b/;

/**
 * Problemas do texto que a IA redigiu para "Das condições especiais", em
 * frases para a Mel. Lista vazia = pode entrar no contrato.
 *
 * 1. Todo numero -- valor, percentual, prazo, hora, data, em digitos OU por
 *    extenso -- precisa ter origem: no restante do contrato (sem cabecalhos
 *    nem numeracao), nos dados que a Mel preencheu ou nas observacoes dela. E
 *    com a MESMA unidade: "10%" nao se prova com um "10 dias". "R$ 1.500",
 *    "1500 reais" e "mil e quinhentos reais" sao o mesmo numero.
 * 2. Digito e extenso que nao batem ("3 (duas) horas").
 * 3. Nada de `{{` nem de marcador entre colchetes sobrando ("[CPF]"), nem
 *    marcador ou papel repetido ("a CONTRATANTE a CONTRATANTE").
 * 4. Nenhum trecho vedado (TRECHOS_VEDADOS), cada um com o motivo.
 * 5. `**` balanceado.
 * 6. No maximo 8 paragrafos, cada um com ate 1.500 caracteres.
 *
 * O contrato de referencia e o `documento` SEM a propria clausula de
 * condicoes especiais (e sem clausula de origem "ia"): se o numero so
 * existisse ali, ele se "provaria" sozinho.
 */
export function validarTextoIa(
  paragrafos: readonly string[],
  dados: DadosContrato,
  documento: DocumentoContrato,
  observacoes: string = dados.observacoes,
): string[] {
  const problemas: string[] = [];
  const textos = paragrafos.map((p) => (p ?? "").trim()).filter(Boolean);

  if (textos.length > MAXIMO_PARAGRAFOS_IA) {
    problemas.push(
      `A cláusula tem ${textos.length} parágrafos; o máximo é ${MAXIMO_PARAGRAFOS_IA}. Junte ou corte o que for repetido.`,
    );
  }
  textos.forEach((p, i) => {
    if (p.length > MAXIMO_CARACTERES_PARAGRAFO_IA) {
      problemas.push(
        `O parágrafo ${i + 1} tem ${p.length} caracteres; o máximo é ${MAXIMO_CARACTERES_PARAGRAFO_IA.toLocaleString("pt-BR")}. Divida-o.`,
      );
    }
  });

  const todo = textos.join("\n");

  // 1 e 2. numeros sem origem, e extenso que nao bate com o digito
  const semIa = new Set(
    documento.clausulas.filter((c) => c.id === "condicoes_especiais" || c.origem === "ia").map((c) => c.id),
  );
  const ref: Referencia = {
    comUnidade: new Set(),
    qualquer: new Set(),
    soltoNasObservacoes: new Set(),
    datas: new Set(),
    diasMeses: new Set(),
    diasMesesSemAno: new Set(),
    anos: new Set(),
  };
  anotarReferencia(ref, citacoesDoTexto(textoDeReferencia(documento, semIa)).citacoes, false);
  anotarReferencia(ref, citacoesDosDados(dados), false);
  anotarReferencia(ref, citacoesDoTexto(observacoes ?? "").citacoes, true);

  const { citacoes, divergentes } = citacoesDoTexto(todo);
  const semOrigem = [...new Set(citacoes.filter((c) => !temOrigem(c, ref)).map(descreverCitacao))];
  if (semOrigem.length > 0) {
    const lista = semOrigem.join(", ");
    const regra = "todo número e toda data precisam ter origem, e com a mesma unidade (“10%” não se prova com “10 dias”).";
    problemas.push(
      semOrigem.length === 1
        ? `O texto cita ${lista}, que não aparece no restante do contrato, nos dados preenchidos nem nas observações. Confira de onde veio: ${regra}`
        : `O texto cita ${lista}, que não aparecem no restante do contrato, nos dados preenchidos nem nas observações. Confira de onde vieram: ${regra}`,
    );
  }
  for (const d of [...new Set(divergentes)]) {
    problemas.push(`Em “${d}”, o número e o extenso entre parênteses não batem. Corrija um dos dois.`);
  }

  // 3. marcacao sobrando, marcador ou papel repetido
  const repetidos = [...new Set(todo.match(RE_MARCADOR_REPETIDO) ?? [])];
  if (repetidos.length > 0 || RE_PAPEL_REPETIDO.test(todo)) {
    problemas.push(
      `O texto repete ${repetidos.length > 0 ? repetidos.map((r) => `“${r}”`).join(", ") : "“a CONTRATANTE a CONTRATANTE”"}. ` +
        "Isso acontece quando o nome de um lugar ou de uma pessoa coincide com o de alguém do contrato e foi escondido da IA. Escreva o nome certo.",
    );
  }
  const semRepetidos = todo.replace(RE_MARCADOR_REPETIDO, " ");
  const chaves = semRepetidos.match(/\{\{[^{}]*\}\}|\{\{|\}\}/g) ?? [];
  const colchetes = semRepetidos.match(/\[[^\][]{1,60}\]/g) ?? [];
  const restos = [...new Set([...chaves, ...colchetes, ...placeholdersRestantes(semRepetidos)])];
  if (restos.length > 0) {
    problemas.push(`Sobrou marcação no texto: ${restos.join(", ")}. Troque pelo nome ou pelo papel (a CONTRATANTE).`);
  }

  // 4. trechos vedados
  const normalizado = semAcento(todo);
  for (const { re, rotulo, motivo } of TRECHOS_VEDADOS) {
    if (re.test(normalizado)) {
      problemas.push(`Trecho que não pode ficar no contrato: “${rotulo}”. ${motivo} Edite a cláusula e tire o trecho.`);
    }
  }

  // 5. negrito
  textos.forEach((p, i) => {
    if (!negritoBalanceado(p)) problemas.push(`O parágrafo ${i + 1} tem um ** sem par.`);
  });

  return problemas;
}

/** Ids do modelo, para quem precisa saber se uma clausula e do modelo ou da Mel ("livre-<n>"). */
export function ehClausulaDoModelo(id: string): id is IdClausula {
  return (IDS_CLAUSULA as readonly string[]).includes(id);
}
