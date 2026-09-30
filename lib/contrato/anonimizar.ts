// Troca os dados pessoais do contrato por marcadores antes de o texto ir para
// a IA, e desfaz o que a IA devolve.
//
// Decisao 3 do SPEC: a IA nunca recebe CPF, CNPJ, endereco residencial,
// e-mail, telefone nem o nome de quem contrata, do anuente ou do homenageado.
// Para redigir uma clausula ou revisar um contrato, ela nao precisa saber quem
// e a pessoa -- precisa saber o PAPEL. O endereco do LOCAL do evento (um
// salao de festas) pode ir, porque nao e dado de ninguem.
//
// Tres camadas, porque o texto que vai para a IA nao e so o que o sistema
// escreveu -- as observacoes da Mel trazem conversa colada do cliente, do
// jeito que ele digitou:
//
// 1. Varredura GENERICA, que nao depende de `dados`: qualquer e-mail, CPF,
//    CNPJ ou telefone brasileiro vira marcador, inclusive o do pai que paga e
//    nao e parte do contrato. Os digitos valem colados em letra ("CPF123...")
//    e com ate tres separadores entre os grupos ("123. 456. 789 - 09").
// 2. Os dados de `dados` comparados SEM acento e SEM caixa ("Joao", "ANA
//    PAULA", "Rua das Acacias"), trocando no original pela posicao. Endereco
//    tambem pelo nucleo do logradouro ("R. das Acácias, 120"), pelo bairro
//    ("Jd. Primavera") e pelo CEP.
// 3. Cada palavra dos nomes das pessoas, sozinha. Aqui mora o unico caso em
//    que a caixa importa: "Dias" e sobrenome, "dias úteis" esta em toda
//    clausula. A forma com inicial maiuscula (ou toda em maiusculas) e sempre
//    trocada; a minuscula so quando a palavra nao e comum (PALAVRAS_COMUNS) --
//    "a ana pediu" perde o nome, "5 (cinco) dias úteis" nao.
//
// Protegidos, porque NAO sao dado pessoal e precisam chegar inteiros: a
// qualificacao da Mel (senao o sobrenome de uma cliente "Simão" apagaria o nome
// dela) e os LOCAIS do evento que sao espaco publico ("Chácara Santa Maria
// Rosa" nao pode virar "Chácara Santa [CONTRATANTE] [CONTRATANTE]" so porque a
// noiva se chama Maria Rosa). Local que tem dado pessoal (a casa da noiva, com
// o endereco dela) nao e protegido: passa pela troca como o resto.
//
// Na duvida, este modulo prefere tirar demais: a IA ler "[CONTRATANTE]" onde
// havia uma palavra comum custa pouco; um CPF escapar custa o que a decisao 3
// existe para evitar.
//
// Puro e sem "server-only" (so texto), mas quem o usa e o servidor.

import { CONTRATADA } from "@/lib/contrato/contratada";
import type { Clausula, DadosContrato, DocumentoContrato, Endereco, Vencimento } from "@/lib/contrato/tipos";
import { duracaoCurta, formatarPercentual, formatarReais } from "@/lib/contrato/extenso";
import { limparCnpj, somenteDigitos, validarCnpj, validarCpf } from "@/lib/contrato/documento";
import { enderecoPorExtenso } from "@/lib/contrato/texto";
import { calcularParcelas, valorSinal } from "@/lib/contrato/pagamento";
import { ehEventoDeMenor } from "@/lib/contrato/regras";
import { dataPorExtenso, LOCAL_DATA } from "@/lib/contrato/clausulas";
import { escopoEfetivo, totalContrato, type ContextoMontagem } from "@/lib/contrato/montar";
import { ehClausulaDoModelo, normalizarComMapa, textoCorrido } from "@/lib/contrato/validar";
import { horaBr } from "@/lib/pdf/formatadores";

export const MARCADORES = {
  contratante: "[CONTRATANTE]",
  representante: "[REPRESENTANTE]",
  anuente: "[ANUENTE]",
  homenageado: "[HOMENAGEADO]",
  cpf: "[CPF]",
  cnpj: "[CNPJ]",
  email: "[EMAIL]",
  telefone: "[TELEFONE]",
  endereco: "[ENDERECO_CONTRATANTE]",
} as const;

// ------------------------------------------------------------ vocabulario --

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "d", "del", "la"]);

/**
 * Palavras que sao nome ou sobrenome E palavra comum do portugues (ou do
 * vocabulario de evento e de empresa). Com inicial maiuscula continuam sendo
 * trocadas; em minuscula, nao: "dias úteis", "de forma clara", "no vale",
 * "decoração com flores" e "eventos corporativos" precisam chegar inteiros a
 * IA, senao o contrato que ela revisa vira "5 (cinco) [CONTRATANTE] úteis".
 * Sem acento e em minusculas, como o texto normalizado.
 */
const PALAVRAS_COMUNS = new Set(
  (
    // Nomes e sobrenomes que sao palavra comum NO TEXTO DE UM CONTRATO OU DE
    // UMA OBSERVACAO. "Silva", "Oliveira" e "Pereira" ficam de fora de
    // proposito: em minuscula, sao quase sempre o sobrenome mesmo.
    "dias rosa rosas campos costa costas santos santo santa flores flor ramos reis rei leite franco branco " +
    "guerra cruz monte montes vale serra rios rio mar neves fontes fonte passos torres torre paz luz sol ceu " +
    "clara claro vitoria gloria graca aurora estrela perola violeta esperanca socorro dores piedade conceicao " +
    "assuncao nascimento natal salvador domingos bela belo serena sereno celeste alegre alegria feliz nobre justo " +
    "porto mata leal moreno preto pardo novo nova velho bom mel ida margarida jasmim dalia iris lirio amor amada " +
    "amado anjo cristal diamante rubi jade safira esmeralda marina clemente prudente constante aparecida penha " +
    "guia rosario lapa real fortuna vida sorte " +
    // vocabulario de evento, de local e de empresa (homenageado de evento corporativo)
    "eventos evento solucoes solucao servicos servico comercio industria grupo empresa ltda cia companhia " +
    "associacao instituto fundacao clube buffet espaco festa festas casa centro studio estudio agencia marketing " +
    "digital tecnologia consultoria comunicacao producoes producao brasil nacional internacional global sul norte " +
    "leste oeste sao nossa senhora jardim vila parque igreja salao sitio chacara fazenda hotel restaurante noiva " +
    "noivo noivos casamento aniversario debutante convencao lancamento anual vendas conferencia congresso feira " +
    "expo escola colegio universidade faculdade hospital clinica academia loja lojas moda beleza saude educacao " +
    "arte artes design foto fotografia video filmes som decoracao cerimonial assessoria gastronomia " +
    // vocabulario do proprio contrato
    "local data prazo horas conta valor sinal equipe pacote principal premium luxo time basico cerimonia recepcao " +
    "making stories reels storymaker cobertura entrega"
  ).split(" "),
);

/** Tipos de logradouro e de bairro, com as abreviacoes de quem digita correndo. */
const TIPOS_ENDERECO: readonly string[][] = [
  ["rua", "r"],
  ["avenida", "av", "avda"],
  ["alameda", "al"],
  ["estrada", "estr", "est"],
  ["rodovia", "rod"],
  ["travessa", "tv", "trav"],
  ["praca", "pca", "pc"],
  ["largo", "lgo", "lg"],
  ["viela"],
  ["via"],
  ["ladeira", "lad"],
  ["servidao", "serv"],
  ["passagem", "psg"],
  ["marginal"],
  ["beco"],
  ["viaduto"],
  ["parque", "pq", "pque"],
  ["condominio", "cond"],
  ["conjunto", "cj", "conj"],
  ["residencial", "res"],
  ["loteamento", "lot"],
  ["chacara", "ch"],
  ["sitio"],
  ["fazenda", "faz"],
  ["quadra", "qd"],
  ["setor", "st"],
  ["vila", "vl"],
  ["jardim", "jd", "jrd"],
  ["nucleo"],
  ["recanto", "rec"],
  ["bosque"],
  ["colonia"],
  ["distrito", "dist"],
];

/** Bairro que e so isso nao identifica ninguem, e trocar "centro" apagaria meio texto. */
const BAIRROS_GENERICOS = new Set(["centro", "zona rural", "zona urbana", "zona sul", "zona norte", "zona leste", "zona oeste", "distrito industrial"]);

const NUMERAIS = new Set(
  "um uma dois duas tres quatro cinco seis sete oito nove dez onze doze treze catorze quatorze quinze dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta sessenta setenta oitenta noventa cem mil".split(
    " ",
  ),
);

// --------------------------------------------------------------- padroes --

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sem acento, minusculo, espaco colapsado: a forma em que os dados sao comparados. */
function normalizado(s: string): string {
  return normalizarComMapa(s ?? "").texto.replace(/\s+/g, " ").trim();
}

/** Regex (fonte) de um literal JA normalizado, com qualquer espaco entre as palavras. */
function literalFlexivel(norm: string): string {
  return norm.split(" ").map(escaparRegex).join("\\s+");
}

const ANTES = "(?<![\\p{L}\\p{N}])";
const DEPOIS = "(?![\\p{L}\\p{N}])";
/** Ate tres separadores entre dois grupos de digitos: "123. 456. 789 - 09". */
const SEP = "[\\s().\\-/]{0,3}";

/**
 * Os caracteres do documento com ate 3 separadores entre cada um. Borda so
 * de DIGITO: "CPF12345678909" e "CPF nº12345678909" tem letra colada, e letra
 * colada nao pode proteger o CPF de ser trocado.
 */
function porDigitos(chars: string, flags = "gu"): RegExp {
  const corpo = [...chars].map(escaparRegex).join(SEP);
  const antes = /^\d/.test(chars) ? "(?<!\\d)" : ANTES;
  const depois = /\d$/.test(chars) ? "(?!\\d)" : DEPOIS;
  return new RegExp(`${antes}${corpo}${depois}`, flags);
}

type Categoria = "nome" | "e-mail" | "CPF" | "CNPJ" | "telefone" | "endereço" | "CEP";

type Troca = {
  /** Global. Roda sobre o texto NORMALIZADO quando `normalizado`; senao, sobre o original. */
  re: RegExp;
  normalizado: boolean;
  por: string;
  categoria: Categoria;
  /** Recebe o trecho ORIGINAL achado; `false` deixa como esta. */
  aceitar?: (trecho: string) => boolean;
  /**
   * Achar isto num LOCAL nao o torna particular. E o bairro: "Barão Geraldo"
   * e o bairro da noiva e tambem o de metade dos saloes de Campinas.
   */
  naoTornaParticular?: boolean;
};

const noOriginal = (re: RegExp, por: string, categoria: Categoria, aceitar?: Troca["aceitar"]): Troca => ({
  re,
  normalizado: false,
  por,
  categoria,
  aceitar,
});
const noNormalizado = (fonte: string, por: string, categoria: Categoria, aceitar?: Troca["aceitar"]): Troca => ({
  re: new RegExp(fonte, "gu"),
  normalizado: true,
  por,
  categoria,
  aceitar,
});

/**
 * Aplica as trocas em ordem. O texto normalizado so e recalculado depois de
 * uma troca que mudou alguma coisa: sao dezenas de padroes sobre um contrato
 * de ~25 mil caracteres. `aoTrocar` recebe cada troca feita -- e assim que a
 * rede de seguranca sabe O QUE sobrou (a categoria), sem saber o valor.
 */
function aplicarTrocas(texto: string, trocas: readonly Troca[], aoTrocar?: (troca: Troca) => void): string {
  let t = texto;
  let n: ReturnType<typeof normalizarComMapa> | null = null;
  for (const troca of trocas) {
    if (troca.normalizado && n === null) n = normalizarComMapa(t);
    const alvo = troca.normalizado ? n!.texto : t;
    let saida = "";
    let ultimo = 0;
    let trocou = false;
    for (const m of alvo.matchAll(troca.re)) {
      if (m[0].length === 0) continue;
      const ini = troca.normalizado ? n!.inicio[m.index] : m.index;
      const fim = troca.normalizado ? n!.fim[m.index + m[0].length - 1] : m.index + m[0].length;
      if (ini < ultimo) continue;
      if (troca.aceitar && !troca.aceitar(t.slice(ini, fim))) continue;
      saida += t.slice(ultimo, ini) + troca.por;
      ultimo = fim;
      trocou = true;
    }
    if (trocou) {
      t = saida + t.slice(ultimo);
      n = null;
      aoTrocar?.(troca);
    }
  }
  return t;
}

// ---------------------------------------------------- varredura generica --

const RE_EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const RE_CNPJ = new RegExp(`(?<!\\d)\\d{2}${SEP}\\d{3}${SEP}\\d{3}${SEP}\\d{4}${SEP}\\d{2}(?!\\d)`, "g");
/** CNPJ alfanumerico (IN RFB 2.229/2024): so vale com digito verificador certo, senao casaria palavras. */
const RE_CNPJ_ALFA = /(?<![\p{L}\p{N}])[A-Za-z0-9]{2}[.\-/]?[A-Za-z0-9]{3}[.\-/]?[A-Za-z0-9]{3}[.\-/]?[A-Za-z0-9]{4}[.\-/]?\d{2}(?![\p{L}\p{N}])/gu;
const RE_CPF = new RegExp(`(?<!\\d)\\d{3}${SEP}\\d{3}${SEP}\\d{3}${SEP}\\d{2}(?!\\d)`, "g");
/** Telefone com DDD, com ou sem +55: "(19) 99876-5432", "+55 19 3232-1010", "19998765432". */
const RE_TELEFONE =
  /(?<!\d)(?:\+\s?)?(?:55[\s.-]{0,3})?(?:\(\s?\d{2}\s?\)|\d{2})[\s.-]{0,3}(?:9[\s.-]?)?\d{4}[\s.-]{0,3}\d{4}(?!\d)/g;

/**
 * Onze digitos seguidos sao CPF ou celular com DDD. Com digito verificador de
 * CPF, e CPF; sem ele e com cara de celular ("19998765432"), fica para o
 * padrao de telefone. Formatado como CPF ("123.456.789-00"), e CPF mesmo com o
 * digito errado: pode ser um CPF digitado errado, e continua sendo de alguem.
 */
function pareceCpf(trecho: string): boolean {
  if (!/^\d{11}$/.test(trecho)) return true;
  return validarCpf(trecho) || !/^\d{2}9\d{8}$/.test(trecho);
}

const TROCAS_GENERICAS = {
  email: noOriginal(RE_EMAIL, MARCADORES.email, "e-mail"),
  cnpj: [
    noOriginal(RE_CNPJ, MARCADORES.cnpj, "CNPJ"),
    noOriginal(RE_CNPJ_ALFA, MARCADORES.cnpj, "CNPJ", (t) => /[A-Za-z]/.test(t) && validarCnpj(t)),
  ],
  cpf: noOriginal(RE_CPF, MARCADORES.cpf, "CPF", pareceCpf),
  telefone: noOriginal(RE_TELEFONE, MARCADORES.telefone, "telefone"),
};

// --------------------------------------------------------------- endereco --

const PARTICULAS_ENDERECO = "(?:(?:de|da|do|das|dos)\\s+)?";

/** "rua das acacias" -> tipo ["rua","r"], nucleo "acacias" (sem o tipo e sem a particula). */
function partesDoLogradouro(texto: string): { tipos: readonly string[] | null; nucleo: string[] } {
  const palavras = normalizado(texto)
    .split(/[\s.,]+/)
    .filter(Boolean);
  const tipos = TIPOS_ENDERECO.find((grupo) => grupo.includes(palavras[0] ?? "")) ?? null;
  const resto = tipos ? palavras.slice(1) : palavras;
  let i = 0;
  while (i < resto.length - 1 && PARTICULAS.has(resto[i])) i++;
  return { tipos, nucleo: resto.slice(i) };
}

/** Nucleo que identifica sozinho: nao e numeral, nem palavra comum, nem curto demais. */
function nucleoDistinto(nucleo: readonly string[]): boolean {
  const fortes = nucleo.filter((p) => p.length >= 4 && !PARTICULAS.has(p) && !NUMERAIS.has(p) && !PALAVRAS_COMUNS.has(p));
  if (nucleo.length === 1) return fortes.length === 1 && nucleo[0].length >= 5;
  return fortes.length >= 1;
}

/** Os pedacos do endereco que identificam a casa mesmo fora da qualificacao. */
function trocasDoEndereco(e: Endereco): Troca[] {
  const trocas: Troca[] = [];
  const por = MARCADORES.endereco;

  // Logradouro: com o tipo em qualquer forma ("R. das Acácias"), ou o nucleo
  // seguido do numero ("Acacias 120"), ou o nucleo sozinho quando identifica.
  const { tipos, nucleo } = partesDoLogradouro(e.logradouro);
  if (nucleo.length > 0) {
    const nucleoRe = nucleo.map(escaparRegex).join("[\\s.,]+");
    const numero = somenteDigitos(e.numero);
    const numeroRe = numero ? `[\\s,]*(?:(?:n[º°o]?|numero)\\.?\\s*)?${numero}(?!\\d)` : null;
    const fecho = numeroRe ? `(?:${numeroRe}|${DEPOIS})` : DEPOIS;
    if (tipos) {
      const tipoRe = `(?:${tipos.map(escaparRegex).join("|")})\\.?\\s*`;
      trocas.push(noNormalizado(`${ANTES}${tipoRe}${PARTICULAS_ENDERECO}${nucleoRe}${fecho}`, por, "endereço"));
    }
    if (numeroRe) trocas.push(noNormalizado(`${ANTES}${PARTICULAS_ENDERECO}${nucleoRe}${numeroRe}`, por, "endereço"));
    if (nucleoDistinto(nucleo)) trocas.push(noNormalizado(`${ANTES}${PARTICULAS_ENDERECO}${nucleoRe}${DEPOIS}`, por, "endereço"));
  }

  // Bairro: inteiro ou com o tipo abreviado ("Jd. Primavera"). O nucleo
  // sozinho ("Primavera") nao: quase sempre e palavra comum.
  const bairro = partesDoLogradouro(e.bairro);
  const bairroNorm = normalizado(e.bairro);
  if (bairro.nucleo.length > 0 && !BAIRROS_GENERICOS.has(bairroNorm)) {
    const nucleoRe = bairro.nucleo.map(escaparRegex).join("[\\s.,]+");
    let fonte: string | null = null;
    if (bairro.tipos) {
      const tipoRe = `(?:${bairro.tipos.map(escaparRegex).join("|")})\\.?\\s*`;
      fonte = `${ANTES}${tipoRe}${PARTICULAS_ENDERECO}${nucleoRe}${DEPOIS}`;
    } else if (nucleoDistinto(bairro.nucleo)) {
      fonte = `${ANTES}${literalFlexivel(bairroNorm)}${DEPOIS}`;
    }
    if (fonte) trocas.push({ ...noNormalizado(fonte, por, "endereço"), naoTornaParticular: true });
  }
  return trocas;
}

// ------------------------------------------------------------------ nomes --

type Pessoa = { nome: string; marcador: string };

function pessoasDoContrato(dados: DadosContrato): Pessoa[] {
  const c = dados.contratante;
  return [
    { nome: c.pf.nome, marcador: MARCADORES.contratante },
    { nome: c.pj.representante.nome, marcador: MARCADORES.representante },
    { nome: dados.anuente.nome, marcador: MARCADORES.anuente },
    { nome: dados.evento.homenageado, marcador: MARCADORES.homenageado },
  ];
}

/** Palavras de um nome que valem ser trocadas sozinhas: 3+ letras, fora as particulas. Normalizadas. */
function palavrasDoNome(nome: string): string[] {
  return normalizado(nome)
    .split(/[^\p{L}]+/u)
    .filter((p) => p.length >= 3 && !PARTICULAS.has(p));
}

/** Toda palavra de nome de pessoa do contrato, normalizada. */
function todasAsPalavrasDeNome(dados: DadosContrato): Set<string> {
  return new Set(pessoasDoContrato(dados).flatMap((p) => palavrasDoNome(p.nome)));
}

/**
 * Inicial maiuscula ou tudo maiusculo: e nome ("Dias", "ROCHA", "Joao").
 * Minuscula: so e nome se a palavra nao for comum ("ana", "rocha").
 */
function ehUsoDeNome(palavra: string): (trecho: string) => boolean {
  const comum = PALAVRAS_COMUNS.has(palavra);
  return (trecho) => !comum || /^\p{Lu}/u.test(trecho);
}

function trocasDeNomes(dados: DadosContrato, comPalavrasSoltas: boolean): Troca[] {
  const trocas: Troca[] = [];

  // Nomes inteiros (e a razao social), do mais longo para o mais curto, para
  // "Ana Paula Rocha" ser trocado antes de "Ana e João".
  const inteiros = [
    ...pessoasDoContrato(dados),
    { nome: dados.contratante.pj.razaoSocial, marcador: MARCADORES.contratante },
  ]
    .map((p) => ({ norm: normalizado(p.nome), marcador: p.marcador }))
    .filter((p) => p.norm.length >= 3)
    .sort((a, b) => b.norm.length - a.norm.length);
  for (const p of inteiros) trocas.push(noNormalizado(`${ANTES}${literalFlexivel(p.norm)}${DEPOIS}`, p.marcador, "nome"));
  if (!comPalavrasSoltas) return trocas;

  // Cada palavra dos nomes das PESSOAS (nao da razao social: "Eventos",
  // "Produções" sao palavras comuns). A primeira pessoa que a registra decide
  // o marcador: "Ana" da noiva e do casal "Ana e João" vira [CONTRATANTE].
  const palavras = new Map<string, string>();
  for (const p of pessoasDoContrato(dados)) {
    for (const palavra of palavrasDoNome(p.nome)) if (!palavras.has(palavra)) palavras.set(palavra, p.marcador);
  }
  const ordenadas = [...palavras].sort((x, y) => y[0].length - x[0].length);
  for (const [palavra, marcador] of ordenadas) {
    trocas.push(noNormalizado(`${ANTES}${escaparRegex(palavra)}${DEPOIS}`, marcador, "nome", ehUsoDeNome(palavra)));
  }

  // Duas palavras do mesmo nome, na ordem do nome, lado a lado: "clara rosa"
  // de "Clara Dias Rosa" e nome mesmo em minuscula, quando cada palavra
  // sozinha seria comum. Vira DOIS marcadores, como a troca palavra a palavra:
  // marcador repetido e o que denuncia um nome de lugar trocado por engano.
  for (const p of pessoasDoContrato(dados)) {
    const palavrasDaPessoa = palavrasDoNome(p.nome);
    for (let i = 0; i < palavrasDaPessoa.length; i++) {
      for (let j = i + 1; j < palavrasDaPessoa.length; j++) {
        const [x, y] = [palavrasDaPessoa[i], palavrasDaPessoa[j]];
        if (!PALAVRAS_COMUNS.has(x) && !PALAVRAS_COMUNS.has(y)) continue; // a troca de cada palavra ja resolve
        const fonte = `${ANTES}${escaparRegex(x)}\\s+${PARTICULAS_ENDERECO}${escaparRegex(y)}${DEPOIS}`;
        trocas.push(noNormalizado(fonte, `${p.marcador} ${p.marcador}`, "nome"));
      }
    }
  }

  // Palavra comum colada no marcador da mesma pessoa tambem e nome: "maria
  // rosa" -> "[CONTRATANTE] rosa" -> "[CONTRATANTE] [CONTRATANTE]". Repete ate
  // parar, para "[C] rosa flores" ir inteiro.
  const vizinhas: Troca[] = [];
  for (const [palavra, marcador] of ordenadas) {
    if (!PALAVRAS_COMUNS.has(palavra)) continue;
    const m = escaparRegex(normalizado(marcador));
    const junto = `\\s+${PARTICULAS_ENDERECO}`;
    vizinhas.push(noNormalizado(`(?<=${m}${junto})${escaparRegex(palavra)}${DEPOIS}`, marcador, "nome"));
    vizinhas.push(noNormalizado(`${ANTES}${escaparRegex(palavra)}(?=${junto}${m})`, marcador, "nome"));
  }
  for (let i = 0; i < 6; i++) trocas.push(...vizinhas);
  return trocas;
}

// ----------------------------------------------------------- todas as trocas --

/** Telefone: com DDD (e sem o 55 do pais) e tambem so o numero local. */
function trocasDeTelefone(telefone: string): Troca[] {
  let d = somenteDigitos(telefone);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 8) return [];
  const trocas: Troca[] = [noOriginal(porDigitos(d), MARCADORES.telefone, "telefone")];
  if (d.length >= 10) trocas.push(noOriginal(porDigitos(d.slice(2)), MARCADORES.telefone, "telefone"));
  return trocas;
}

/**
 * Todas as trocas, na ordem em que precisam acontecer: e-mail primeiro (ele
 * tem pedaco de nome: "ana.rocha@..."), endereco inteiro antes dos digitos
 * (senao o CEP sai sozinho e o resto do endereco fica em pedacos), documentos,
 * telefone, pedacos do endereco, e os nomes por ultimo.
 *
 * `comPalavrasSoltas: false` e a troca RESTRITA -- tudo menos as palavras
 * soltas dos nomes. E com ela que se decide se um local e publico.
 */
function trocasDosDados(dados: DadosContrato, comPalavrasSoltas = true): Troca[] {
  const c = dados.contratante;
  const pf = c.pf;
  const pj = c.pj;
  const rep = pj.representante;
  const a = dados.anuente;
  const trocas: Troca[] = [];

  trocas.push(TROCAS_GENERICAS.email);
  for (const email of [pf.email, rep.email, a.email]) {
    const e = normalizado(email);
    if (e) trocas.push(noNormalizado(`${ANTES}${escaparRegex(e)}${DEPOIS}`, MARCADORES.email, "e-mail"));
  }

  for (const e of [pf.endereco, pj.endereco]) {
    for (const inteiro of [enderecoPorExtenso(e), enderecoPorExtenso({ ...e, cep: "" })]) {
      const norm = normalizado(inteiro);
      if (norm.length >= 6) trocas.push(noNormalizado(`${ANTES}${literalFlexivel(norm)}${DEPOIS}`, MARCADORES.endereco, "endereço"));
    }
  }

  // Documentos e telefones: a varredura generica primeiro (pega o "+55" e a
  // pontuacao inteira), e depois os de `dados` digito a digito, para o que a
  // generica nao reconhece ("1234567890 9", o celular sem DDD).
  trocas.push(...TROCAS_GENERICAS.cnpj);
  const cnpj = limparCnpj(pj.cnpj);
  if (cnpj.length >= 12) trocas.push(noOriginal(porDigitos(cnpj, "giu"), MARCADORES.cnpj, "CNPJ"));

  trocas.push(TROCAS_GENERICAS.cpf);
  for (const cpf of [pf.cpf, rep.cpf, a.cpf]) {
    const d = somenteDigitos(cpf);
    if (d.length >= 9) trocas.push(noOriginal(porDigitos(d), MARCADORES.cpf, "CPF"));
  }

  trocas.push(TROCAS_GENERICAS.telefone);
  for (const tel of [pf.telefone, rep.telefone]) trocas.push(...trocasDeTelefone(tel));

  for (const cep of [pf.endereco.cep, pj.endereco.cep]) {
    const d = somenteDigitos(cep);
    if (d.length === 8) trocas.push(noOriginal(porDigitos(d), MARCADORES.endereco, "CEP"));
  }

  for (const e of [pf.endereco, pj.endereco]) trocas.push(...trocasDoEndereco(e));

  trocas.push(...trocasDeNomes(dados, comPalavrasSoltas));
  return trocas;
}

// ------------------------------------------------------------- protegidos --

/** "Chácara Santa Maria Rosa." -> "Chácara Santa Maria Rosa", como a clausula do local escreve. */
function limparLocal(s: string): string {
  return (s ?? "")
    .replace(/\*{2,}/g, "")
    .replace(/\{\{|\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.;,:]+$/, "");
}

const MORADIA = "(?:casa|residencia|apartamento|apto|ap|sitio|chacara|fazenda|condominio|predio|edificio|lar)";

/**
 * Locais do evento, do making of e do ensaio que sao espaco PUBLICO e vao
 * inteiros para a IA. Nao e publico -- e passa pela troca como qualquer texto
 * -- o local em que a troca restrita acha dado pessoal (o endereco da noiva,
 * um nome completo, um telefone) ou que diz de quem e a casa ("casa da Ana").
 *
 * Do local publico vale tambem o NOME sozinho (o trecho antes da primeira
 * virgula), que e como a Mel o cita nas observacoes: "chegar na Chácara Santa
 * Maria Rosa às 16h". So quando o nome tem alguma palavra que nao e de pessoa
 * -- um local chamado so "Maria Rosa" protegeria o nome da noiva em todo texto.
 */
function locaisPublicos(dados: DadosContrato): string[] {
  const ev = dados.evento;
  // `?? ""`: contrato salvo antes dos campos do ensaio, lido sem o schema.
  const ensaio = ev.ensaioLocal ?? "";
  const restritas = trocasDosDados(dados, false);
  const nomes = todasAsPalavrasDeNome(dados);
  const moradia = nomes.size
    ? new RegExp(`${ANTES}${MORADIA}\\s+d[aeo]s?\\s+(?:${[...nomes].map(escaparRegex).join("|")})${DEPOIS}`, "u")
    : null;

  const publicos: string[] = [];
  for (const bruto of [...ev.locais.map((l) => l.endereco), ev.makingOfLocal, ensaio]) {
    const local = limparLocal(bruto);
    if (local.length < 4 || publicos.includes(local)) continue;
    let temDado = false;
    aplicarTrocas(local, restritas, (troca) => {
      if (!troca.naoTornaParticular) temDado = true;
    });
    if (temDado || moradia?.test(normalizado(local))) continue;
    publicos.push(local);

    const nome = local.split(",")[0].trim();
    const palavras = normalizado(nome).split(/[^\p{L}]+/u).filter((p) => p.length >= 3);
    const temPalavraDeLugar = palavras.some((p) => !PARTICULAS.has(p) && !nomes.has(p));
    if (nome !== local && palavras.length >= 2 && temPalavraDeLugar && !publicos.includes(nome)) publicos.push(nome);
  }
  return publicos;
}

/** O que nunca e trocado, como regex do texto ORIGINAL (qualquer espaco entre as palavras). Mais longo primeiro. */
function trechosProtegidos(dados: DadosContrato): RegExp[] {
  const trechos = [
    CONTRATADA.qualificacao,
    CONTRATADA.nome,
    CONTRATADA.cnpjFormatado,
    LOCAL_DATA,
    `Comarca de ${CONTRATADA.foroPJ}`,
    ...locaisPublicos(dados),
  ].sort((a, b) => b.length - a.length);
  return trechos.map((t) => new RegExp(t.trim().split(/\s+/).map(escaparRegex).join("\\s+"), "gu"));
}

/**
 * Sentinela de uso privado (U+E100...): nenhum padrao deste modulo casa com
 * ela -- nao e letra, nem digito, nem separador --, entao o trecho protegido
 * atravessa a troca intacto e volta no fim.
 */
const sentinela = (i: number) => `\uF8FF${String.fromCharCode(0xe100 + i)}\uF8FF`;

/** Troca o texto de `dados`, deixando os trechos protegidos intactos. */
function anonimizarProtegendo(texto: string, dados: DadosContrato): string {
  const guardados: string[] = [];
  let t = texto ?? "";
  for (const re of trechosProtegidos(dados)) {
    t = t.replace(re, (achado) => {
      guardados.push(achado);
      return sentinela(guardados.length - 1);
    });
  }
  t = aplicarTrocas(t, trocasDosDados(dados));
  return t.replace(/\uF8FF([\uE100-\uEFFF])\uF8FF/g, (_, c: string) => guardados[c.charCodeAt(0) - 0xe100] ?? "");
}

// ------------------------------------------------------------- anonimizar --

/**
 * Troca os dados pessoais de QUALQUER texto (observacoes da Mel, resumo) por
 * marcadores. As observacoes podem trazer conversa colada do cliente, com
 * nome, telefone e CPF -- dele ou de terceiros: passam por aqui antes de ir
 * para a IA.
 */
export function anonimizarTexto(texto: string, dados: DadosContrato): string {
  return anonimizarProtegendo(texto, dados);
}

export type OpcoesAnonimizar = {
  /**
   * Acrescenta a ORIGEM de cada clausula ao cabecalho: "(origem: padrão
   * aprovado)", "(origem: redigida pela IA)", "(origem: editada no painel)".
   * Padrao: sim. Sem isso a revisao nao sabe o que e modelo aprovado e aponta
   * o mesmo "problema" do texto fixo em todo contrato, escondendo o que muda
   * de um cliente para outro.
   */
  marcarOrigem?: boolean;
};

type OrigemMarcada = "padrao" | "ia" | "editada" | "acrescentada";

const ROTULO_ORIGEM: Record<OrigemMarcada, string> = {
  padrao: " (origem: padrão aprovado)",
  ia: " (origem: redigida pela IA)",
  editada: " (origem: editada no painel)",
  acrescentada: " (origem: acrescentada no painel)",
};
const SENTINELA_ORIGEM: Record<OrigemMarcada, string> = {
  padrao: "\uE001",
  ia: "\uE002",
  editada: "\uE003",
  acrescentada: "\uE004",
};

function origemMarcada(c: Clausula): OrigemMarcada {
  if (c.origem === "editada" && !ehClausulaDoModelo(c.id)) return "acrescentada";
  return c.origem;
}

/**
 * O contrato inteiro em texto corrido (clausulas numeradas, paragrafos com a
 * numeracao resolvida e o `**` do negrito), com os dados pessoais trocados
 * por marcadores e, no cabecalho de cada clausula, a origem dela.
 *
 * A origem entra por sentinela e so vira texto DEPOIS da troca: "editada no
 * painel" nao pode passar pela troca de nomes (uma cliente chamada "Mel"...).
 */
export function anonimizar(documento: DocumentoContrato, dados: DadosContrato, opcoes: OpcoesAnonimizar = {}): string {
  const marcar = opcoes.marcarOrigem ?? true;
  const corrido = textoCorrido(documento, {
    marcaDoCabecalho: marcar ? (c) => SENTINELA_ORIGEM[origemMarcada(c)] : undefined,
  });
  let texto = anonimizarProtegendo(corrido, dados);
  if (marcar) {
    for (const origem of Object.keys(SENTINELA_ORIGEM) as OrigemMarcada[]) {
      texto = texto.split(SENTINELA_ORIGEM[origem]).join(ROTULO_ORIGEM[origem]);
    }
  }
  return texto;
}

// ----------------------------------------------------------- desanonimizar --

/** "de" + "[CONTRATANTE]" = "da CONTRATANTE", preservando a maiuscula. */
const CONTRACOES: Record<string, string> = { de: "da", em: "na", por: "pela" };

function capitalizar(p: string): string {
  return p.replace(/^(\p{Ll})/u, (l: string) => l.toLocaleUpperCase("pt-BR"));
}

function mesmaCaixa(modelo: string, palavra: string): string {
  return /^\p{Lu}/u.test(modelo) ? capitalizar(palavra) : palavra;
}

/** "[CONTRATANTE] [CONTRATANTE]": um nome (quase sempre de local) coincidiu com o de alguem do contrato. */
const RE_MARCADORES_REPETIDOS = /(\[[A-Z_]{2,40}\])(?:\s+\1)+/g;

/**
 * Desfaz o que a IA escreveu com marcador:
 *
 * - `[HOMENAGEADO]` volta a ser o nome ("Maria Eduarda");
 * - `[CONTRATANTE]` vira o PAPEL, "a CONTRATANTE" (o contrato sempre se
 *   refere a quem contrata pelo papel), com a contracao certa: "de
 *   [CONTRATANTE]" -> "da CONTRATANTE", "por [CONTRATANTE]" -> "pela
 *   CONTRATANTE", e sem artigo dobrado quando a IA ja o escreveu ("a
 *   [CONTRATANTE]", "à [CONTRATANTE]");
 * - marcador REPETIDO ("Chácara Santa [CONTRATANTE] [CONTRATANTE]") fica
 *   como esta: era um nome de lugar que coincidiu com o de alguem, e virar
 *   "Chácara Santa a CONTRATANTE a CONTRATANTE" esconderia o erro. Como
 *   marcador, a validacao do texto da IA acusa e a Mel escreve o nome certo;
 * - qualquer outro marcador fica como esta, e a validacao acusa (um "[CPF]"
 *   no contrato e um dado que nao voltou).
 */
export function desanonimizar(texto: string, dados: DadosContrato): string {
  const repetidos: string[] = [];
  let t = (texto ?? "").replace(RE_MARCADORES_REPETIDOS, (achado) => {
    repetidos.push(achado);
    return sentinela(repetidos.length - 1);
  });

  const homenageado = dados.evento.homenageado.replace(/\s+/g, " ").trim();
  if (homenageado) t = t.split(MARCADORES.homenageado).join(homenageado);

  // preposicao solta antes do marcador: contrai
  t = t.replace(/(^|[^\p{L}])(de|em|por)\s+\[CONTRATANTE\]/giu, (_, antes: string, prep: string) => {
    return `${antes}${mesmaCaixa(prep, CONTRACOES[prep.toLocaleLowerCase("pt-BR")])} CONTRATANTE`;
  });
  // artigo (ou contracao) ja escrito: so o papel
  t = t.replace(/(^|[^\p{L}])(a|à|da|na|pela|para a|com a)\s+\[CONTRATANTE\]/giu, (_, antes: string, art: string) => {
    return `${antes}${art} CONTRATANTE`;
  });
  // o resto: "a CONTRATANTE", com maiuscula no comeco de frase
  t = t.replace(/\[CONTRATANTE\]/g, (_, posicao: number, todo: string) => {
    const comecoDeFrase = /(^|[.!?:]\s+|\n\s*)$/.test(todo.slice(0, posicao));
    return comecoDeFrase ? "A CONTRATANTE" : "a CONTRATANTE";
  });

  return t.replace(/\uF8FF([\uE100-\uEFFF])\uF8FF/g, (_, c: string) => repetidos[c.charCodeAt(0) - 0xe100] ?? "");
}

// ------------------------------------------------------------------ resumo --

function vencimentoResumido(v: Vencimento): string {
  switch (v.tipo) {
    case "assinatura":
      return "na assinatura";
    case "data":
      return `vencimento em ${dataPorExtenso(v.data) || "(data não informada)"}`;
    case "dias_antes":
      return `até ${v.dias} dias antes do evento`;
    case "pago":
      return `já pago em ${dataPorExtenso(v.data) || "(data não informada)"}`;
  }
}

const NOME_CATEGORIA = {
  casamento: "casamento",
  debutante: "festa de 15 anos (debutante)",
  aniversario: "aniversário",
  corporativo: "evento corporativo",
} as const;

/**
 * Os dados estruturados do contrato em texto curto, SEM dado pessoal, para a
 * IA conferir o texto contra eles. Valores em R$ podem ir (nao sao dado
 * pessoal); locais do evento tambem (sao espacos de festa). Quem e a pessoa,
 * nao: aparece so o papel, e o homenageado como [HOMENAGEADO].
 *
 * Passa por `anonimizarTexto` no fim, por garantia: uma descricao de
 * adicional digitada com o nome da noiva nao pode vazar por aqui.
 */
export function resumoParaIa(dados: DadosContrato, ctx: ContextoMontagem): string {
  const s = dados.servico;
  const e = escopoEfetivo(s, ctx.templateId);
  const ep = s.escopo;
  const ev = dados.evento;
  const total = totalContrato(s);
  const menor = ehEventoDeMenor(ctx.categoria, ctx.idadeHomenageado ?? (ctx.categoria === "debutante" ? 15 : null));
  const linhas: string[] = [];

  linhas.push(`Categoria do evento: ${NOME_CATEGORIA[ctx.categoria]} (arte da proposta: ${ctx.templateId})`);
  if (ctx.categoria === "corporativo" && ev.tipoEvento.trim()) linhas.push(`Tipo do evento: ${ev.tipoEvento.trim()}`);
  linhas.push(`Pessoa homenageada: ${MARCADORES.homenageado}`);
  linhas.push(
    menor
      ? `Evento de menor de idade: sim (idade: ${ctx.idadeHomenageado ?? (ctx.categoria === "debutante" ? 15 : "não informada")})`
      : "Evento de menor de idade: não",
  );
  linhas.push(
    `Quem contrata: ${dados.contratante.tipo === "pj" ? "pessoa jurídica (empresa), representada por [REPRESENTANTE]" : "pessoa física"}`,
  );
  if (menor && dados.contratante.vinculo.trim()) {
    linhas.push(`Vínculo de quem contrata com ${MARCADORES.homenageado}: ${dados.contratante.vinculo.trim()}`);
  }
  linhas.push(
    dados.anuente.ativo
      ? `Anuente (autoriza só a própria imagem): sim, papel no evento: ${dados.anuente.papel.trim() || "(não informado)"}`
      : "Anuente: não",
  );

  linhas.push(`Data do evento: ${dataPorExtenso(ev.data) || ev.data || "(não informada)"}`);
  linhas.push(`Início da cobertura: ${horaBr(ev.horarioInicio) || "(não informado)"}`);
  const locais = ev.locais.filter((l) => l.rotulo.trim() || l.endereco.trim());
  if (locais.length === 0) linhas.push("Locais: (nenhum informado)");
  for (const l of locais) linhas.push(`${l.rotulo.trim() || "Local"}: ${l.endereco.trim()}`);
  if (e.minutosMakingOf > 0) {
    linhas.push(`Local do making of: ${ev.makingOfLocal.trim() || "A DEFINIR"}`);
    linhas.push(`Início do making of: ${horaBr(ev.makingOfHorario) || "A DEFINIR"}`);
  }
  if (e.minutosEnsaio > 0) {
    // `?? ""`: contrato salvo antes dos campos do ensaio, lido sem o schema.
    linhas.push(`Data do ensaio: ${dataPorExtenso(ev.ensaioData ?? "") || "A DEFINIR"}`);
    linhas.push(`Local do ensaio: ${(ev.ensaioLocal ?? "").trim() || "A DEFINIR"}`);
    linhas.push(`Início do ensaio: ${horaBr(ev.ensaioHorario ?? "") || "A DEFINIR"}`);
  }
  linhas.push(`Alimentação da equipe no evento: ${ev.alimentacao ? "sim" : "não"}`);

  linhas.push(`Tabela de preço: ${s.tabela}`);
  linhas.push(`Pacote: ${s.pacote.trim() || "(não escolhido)"}, valor do pacote ${formatarReais(s.valorPacote)}`);
  linhas.push(
    `Escopo do pacote: cobertura de ${duracaoCurta(ep.minutosCobertura)}` +
      (ep.abrangencia.trim() ? ` (${ep.abrangencia.trim()})` : "") +
      (ep.minutosMakingOf > 0 ? `, making of de ${duracaoCurta(ep.minutosMakingOf)}` : "") +
      (ep.minutosEnsaio > 0 ? `, ensaio de ${duracaoCurta(ep.minutosEnsaio)}` : ""),
  );
  // Auxiliar por hora, por menos tempo que a cobertura: a equipe NAO e de dois
  // o evento inteiro, e o revisor precisa saber disso para conferir o texto.
  const minutosAuxiliar = e.minutosAuxiliar;
  const equipe =
    e.storymakers >= 2
      ? `a CONTRATADA e ${e.storymakers - 1} storymaker(s) auxiliar(es) durante toda a cobertura`
      : minutosAuxiliar > 0
        ? `a CONTRATADA, com 1 storymaker auxiliar por ${duracaoCurta(minutosAuxiliar)}`
        : "só a CONTRATADA";
  linhas.push(
    `Escopo com os adicionais: cobertura de ${duracaoCurta(e.minutosCobertura)}` +
      (e.minutosMakingOf > 0 ? `, making of de ${duracaoCurta(e.minutosMakingOf)}` : ", sem making of") +
      (e.minutosEnsaio > 0 ? `, ensaio de ${duracaoCurta(e.minutosEnsaio)}` : "") +
      `; stories ilimitados: ${e.stories ? "sim" : "não"}; entrega em tempo real: ${e.tempoReal ? "sim" : "não"}; ` +
      `equipe: ${equipe}`,
  );
  linhas.push(
    `Reels do pacote: ${ep.reels.length}` +
      (ep.reels.length > 0 ? ` (${ep.reels.map((r) => r.trim() || "sem descrição").join("; ")}), de até ${ep.segundosReels} segundos cada` : ""),
  );
  if (ep.extras.some((x) => x.trim())) linhas.push(`Extras: ${ep.extras.filter((x) => x.trim()).join("; ")}`);
  linhas.push(
    `Prazos (dias úteis após o evento): ${e.tempoReal ? "stories publicados durante o evento" : `stories ${e.diasStories}`}, material bruto ${e.diasMaterial}, Reels ${e.diasReels}`,
  );

  if (s.adicionais.length === 0) linhas.push("Adicionais: nenhum");
  else {
    linhas.push("Adicionais:");
    for (const a of s.adicionais) {
      const duracao = a.tipo === "making_of" ? `, duração de ${duracaoCurta(a.minutos)}` : "";
      linhas.push(
        `- ${a.descricao.trim() || "(sem descrição)"}: ${a.quantidade} × ${formatarReais(a.valorUnitario)} = ${formatarReais(a.quantidade * a.valorUnitario)}${duracao}`,
      );
    }
  }
  if (s.desconto > 0) linhas.push(`Desconto: ${formatarReais(s.desconto)}`);
  linhas.push(`Valor total do contrato: ${formatarReais(total)}`);

  const p = dados.pagamento;
  if (p.modo === "quitado") {
    linhas.push(
      `Pagamento: já quitado em ${dataPorExtenso(p.quitadoEm) || "(data não informada)"}; ` +
        `sinal: ${formatarPercentual(p.percentualSinalQuitado)} = ${formatarReais(valorSinal(total, p))}`,
    );
  } else {
    linhas.push("Pagamento em parcelas:");
    calcularParcelas(total, p.parcelas).forEach((pc, i) => {
      linhas.push(
        `- ${String.fromCharCode(65 + i)}: ${formatarPercentual(pc.percentual)} = ${formatarReais(pc.valor)}` +
          `${pc.sinal ? ", sinal" : ""}, ${vencimentoResumido(pc.vencimento)}`,
      );
    });
    linhas.push(`Sinal (soma das parcelas de sinal): ${formatarReais(valorSinal(total, p))}`);
  }
  linhas.push(
    `Foro: ${dados.contratante.tipo === "pj" ? `Comarca de ${CONTRATADA.foroPJ}` : "comarca do domicílio da CONTRATANTE"}`,
  );

  return anonimizarTexto(linhas.join("\n"), dados);
}

// ------------------------------------------------------- rede de seguranca --

/**
 * Rede de seguranca para quem manda texto a IA: que dado pessoal ainda
 * aparece em `texto`? Lista vazia = nada escapou. Devolve a CATEGORIA
 * ("nome", "e-mail", "CPF", "CNPJ", "telefone", "endereço", "CEP"), nunca o
 * valor: o resultado vai para log e para a tela.
 *
 * Confere com a MESMA regua da troca -- as palavras de nome sem acento e sem
 * caixa, o nucleo do logradouro, o CEP, o telefone, e a varredura generica de
 * e-mail, CPF, CNPJ e telefone de qualquer pessoa --, fora dos trechos
 * protegidos (a qualificacao da Mel e os locais publicos). Se a troca foi
 * feita, nao sobra nada; se algum texto chegou aqui sem passar por ela, a IA
 * nao e chamada.
 */
export function dadosPessoaisNoTexto(texto: string, dados: DadosContrato): string[] {
  let t = texto ?? "";
  for (const re of trechosProtegidos(dados)) t = t.replace(re, "\n");
  const achados = new Set<Categoria>();
  aplicarTrocas(t, trocasDosDados(dados), (troca) => achados.add(troca.categoria));
  return [...achados];
}
