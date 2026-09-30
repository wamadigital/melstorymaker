// Biblioteca de clausulas do contrato -- modelo "2026-09-30" (o de 29/09 com
// a revisao juridica e de portugues aplicada).
//
// Cada texto aqui e o texto juridico APROVADO (secao 4 do SPEC), transcrito
// com as variacoes que ele preve. Nada e redigido na hora: o que muda de um
// contrato para outro sao os DADOS (nome, horas, valores, parcelas), e as
// frases que os carregam sao sempre as mesmas, revisadas uma vez so. Foi
// redigindo cada contrato do zero que os antigos sairam com concordancia
// errada, virgula no meio do extenso e duas "CLÁUSULA 13".
//
// Quem decide QUAIS clausulas entram e em que ordem e `montar.ts`; aqui cada
// funcao recebe os fatos ja calculados (`BaseRedacao`: escopo efetivo, total,
// parcelas) e devolve a clausula pronta, ou `null` quando ela nao se aplica.
//
// Marcacao dos paragrafos (lida por `marcacao.ts`): `{{n}}` e o numero desta
// clausula, `{{ref:<id>}}` o numero de outra, `**...**` negrito. O negrito e
// SO das frases limitativas (CDC art. 54 §4º) -- negritar mais que isso
// anularia o destaque.
//
// Puro e sem "server-only": o painel mostra a previa com estas mesmas funcoes.

import type { Categoria } from "@/lib/form/types";
import { dataExtenso, horaBr } from "@/lib/pdf/formatadores";
import type {
  Adicional,
  Assinante,
  Clausula,
  DadosContrato,
  Escopo,
  EscopoEfetivo,
  IdClausula,
  Parte,
  Vencimento,
} from "@/lib/contrato/tipos";
import { ASSINANTE_CONTRATADA, CONTRATADA, PARTE_CONTRATADA } from "@/lib/contrato/contratada";
import { formatarCnpj, formatarCpf, normalizarEmail } from "@/lib/contrato/documento";
import {
  duracaoCurta,
  duracaoPorExtenso,
  percentualComExtenso,
  quantidadeComExtenso,
  segundosPorExtenso,
  valorComExtenso,
} from "@/lib/contrato/extenso";
import { PACOTE_PERSONALIZADO } from "@/lib/contrato/catalogo";
import { dataISOValida, type ParcelaCalculada } from "@/lib/contrato/pagamento";
import {
  enderecoPorExtenso,
  flexao,
  listaPtBr,
  nacionalidadePadrao,
  normalizarComparacao,
  preposicaoLogradouro,
  primeiraMaiuscula,
} from "@/lib/contrato/texto";

/**
 * Versao do modelo de clausulas. Vai para o documento e para a trilha: um PDF
 * sabe de que texto nasceu. Mudou o texto de uma clausula-padrao, muda a data
 * aqui -- um contrato montado com o modelo anterior continua dizendo qual era.
 */
export const VERSAO_MODELO = "2026-09-30";

export const TITULO_CONTRATO = "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE STORYMAKER";

export const PREAMBULO =
  "Pelo presente instrumento particular, as partes acima identificadas e qualificadas, doravante denominadas simplesmente CONTRATANTE e CONTRATADA, têm entre si justo e contratado o que segue, nos termos e condições abaixo:";

/**
 * Com ANUENTE, o preambulo nomeia as tres partes: sem isso, uma das tres
 * qualificadas ficava sem designacao, e o "justo e contratado" passava a
 * incluir quem nao contratou nada. A remissao e resolvida como as das partes
 * (validar.ts, pdf.ts e o editor resolvem `{{ref:}}` no preambulo).
 */
export const PREAMBULO_COM_ANUENTE =
  "Pelo presente instrumento particular, as partes acima identificadas e qualificadas, doravante denominadas simplesmente CONTRATANTE, CONTRATADA e ANUENTE, esta última interveniente apenas para os fins da Cláusula {{ref:direitos}}, têm entre si justo e contratado o que segue, nos termos e condições abaixo:";

/** "Campinas/SP, na data da última assinatura eletrônica registrada pela plataforma." */
export const LOCAL_DATA = `${CONTRATADA.cidadeAssinatura}, na data da última assinatura eletrônica registrada pela plataforma.`;

/**
 * Titulo de cada clausula do modelo, sem o "CLÁUSULA N - ". O painel usa a
 * mesma tabela para dizer "Falta a cláusula obrigatória ..." e para o link do
 * aviso ate a clausula.
 */
export const TITULOS_CLAUSULA: Record<IdClausula, string> = {
  objeto: "DO OBJETO DO CONTRATO",
  local: "DO LOCAL, DATA E HORÁRIO DO EVENTO",
  servicos: "DOS SERVIÇOS",
  adicionais: "DOS SERVIÇOS ADICIONAIS",
  prazos: "DOS PRAZOS",
  condicoes_tecnicas: "DAS CONDIÇÕES TÉCNICAS, OPERACIONAIS E PRAZOS",
  instagram: "DO ACESSO À CONTA DO INSTAGRAM",
  pagamento: "DO PAGAMENTO",
  entrega: "DA PLATAFORMA DE ENTREGA",
  armazenamento: "DO TEMPO DE ARMAZENAMENTO",
  direitos: "DOS DIREITOS AUTORAIS E AUTORIZAÇÃO DE IMAGEM",
  alimentacao: "DA ALIMENTAÇÃO",
  alteracoes: "DAS ALTERAÇÕES DO MATERIAL",
  desistencia: "DA DESISTÊNCIA OU ADIAMENTO DO EVENTO",
  equipe: "DA EQUIPE DE TRABALHO",
  condicoes_especiais: "DAS CONDIÇÕES ESPECIAIS",
  assinatura_eletronica: "DA ASSINATURA ELETRÔNICA",
  foro: "DO FORO",
};

/** "CLÁUSULA 7 - DO PAGAMENTO". Um lugar so, para o PDF e o texto corrido da IA dizerem o mesmo. */
export function cabecalhoClausula(numero: number, titulo: string): string {
  return `CLÁUSULA ${numero} - ${titulo}`;
}

/** Ultimo paragrafo da clausula de condicoes especiais, acrescentado pelo sistema (a IA nao o escreve). */
export const PARAGRAFO_UNICO_CONDICOES_ESPECIAIS =
  "Parágrafo único. As condições desta cláusula prevalecem sobre as demais disposições deste contrato apenas naquilo que expressamente modificarem, permanecendo inalteradas todas as demais cláusulas.";

/** Paragrafo dos dois making ofs feitos por uma profissional so (texto da Mel, contrato de dois making ofs). */
export const PARAGRAFO_MAKING_OFS_ALTERNADOS =
  "Considerando que as captações serão realizadas por um único profissional, fica ciente a CONTRATANTE de que os horários dos making ofs deverão ser organizados de forma alternada e compatível com o deslocamento entre os locais, impossibilitando a realização simultânea das coberturas.";

/** Descricao que fala de uma segunda pessoa na equipe ("storymaker auxiliar", "simultâneo ao da noiva"). */
const RE_SEGUNDA_PESSOA = /\b(storymaker|auxiliar|simultane)/;

/**
 * O adicional poe uma segunda pessoa na cobertura? Todo storymaker adicional
 * (inclusive o por hora), e o "Outro serviço" cuja descricao fala em
 * storymaker, auxiliar ou simultaneo -- e assim que a Mel vende a 2ª
 * storymaker so no making of do noivo, ja que o casamento nao tem storymaker
 * no catalogo.
 *
 * Com um adicional desses, o paragrafo dos making ofs "impossibilitando a
 * realização simultânea" contradiria o proprio adicional; a montagem tira o
 * paragrafo e pede a Mel para conferir a logistica.
 */
export function adicionalIndicaSegundaPessoa(a: Pick<Adicional, "id" | "tipo" | "descricao">): boolean {
  if (a.tipo === "storymaker") return true;
  const livre = a.tipo === "outro" || /^livre(-|$)/.test(a.id);
  return livre && RE_SEGUNDA_PESSOA.test(normalizarComparacao(a.descricao));
}

/**
 * Ha storymaker auxiliar so em PARTE da cobertura (adicional por hora, por
 * menos horas que a cobertura)? Ai o texto diz "por até N horas", nunca
 * "equipe composta pela CONTRATADA e 1 (um) storymaker auxiliar".
 */
export function auxiliarParcial(e: Pick<EscopoEfetivo, "storymakers" | "minutosAuxiliar">): boolean {
  return e.storymakers === 1 && e.minutosAuxiliar > 0;
}

// ------------------------------------------------------------ fatos --

/** Unidade de cobranca do adicional: por hora, por unidade, ou valor fechado (`null`). */
export type UnidadeAdicional = "hora" | "unidade" | null;

/** Adicional como a clausula o le: o dado salvo mais a unidade (que vem do catalogo). */
export type AdicionalRedacao = Adicional & { unidade: UnidadeAdicional };

/**
 * Tudo que as clausulas precisam, ja calculado por `montar.ts`. As clausulas
 * nao somam nem arredondam nada: recebem o total, as parcelas e o escopo
 * efetivo prontos, para que o numero escrito numa clausula seja sempre o
 * mesmo numero escrito na outra.
 */
export type BaseRedacao = {
  dados: DadosContrato;
  categoria: Categoria;
  /** Evento de menor (debutante; aniversario com menos de 18 anos ou sem idade). */
  menor: boolean;
  /**
   * Menor de 16 anos (ou idade desconhecida): absolutamente incapaz, a
   * CONTRATANTE o REPRESENTA na autorizacao de imagem. Entre 16 e 17 ele
   * mesmo autoriza, ASSISTIDO pela CONTRATANTE (CC arts. 3º, 4º e 1.690).
   */
  menorDe16: boolean;
  /** O anuente e a propria pessoa homenageada (aniversariante de 16-17 assistido). */
  anuenteEhHomenageado: boolean;
  /** Escopo do PACOTE, como a Mel confirmou -- e o que o objeto descreve. */
  escopoPacote: Escopo;
  /** Escopo com os adicionais somados (horas, making of, equipe, tempo real, horas do auxiliar). */
  escopo: EscopoEfetivo;
  adicionais: AdicionalRedacao[];
  /** Centavos. */
  total: number;
  parcelas: ParcelaCalculada[];
  /** Centavos. */
  sinal: number;
};

// ---------------------------------------------------------- utilidades --

/**
 * Valor digitado pronto para entrar numa frase: sem espaco sobrando e sem a
 * marcacao do proprio contrato. Um `**` ou `{{` num nome digitado viraria
 * negrito ou remissao no PDF.
 */
function limpo(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\*{2,}/g, "")
    .replace(/\{\{|\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tira o ponto (ou virgula) final de um trecho que vai para o meio de uma frase. */
function semPontoFinal(s: string): string {
  return s.replace(/[\s.;,:]+$/, "");
}

/** "Mãe" -> "mãe": vinculo, papel, cargo e nacionalidade entram no meio da frase. */
function minusculaInicial(s: string): string {
  return s.replace(/^(\p{Lu})(?=\p{Ll})/u, (letra: string) => letra.toLocaleLowerCase("pt-BR"));
}

/**
 * Data por extenso para o contrato: "23 de janeiro de 2027", e "1º de março
 * de 2027" no primeiro dia do mes -- o dia primeiro e ordinal na redacao
 * formal brasileira.
 */
export function dataPorExtenso(iso: string): string {
  return dataExtenso(iso).replace(/^1 de /, "1º de ");
}

/** "5 (cinco) dias úteis"; "1 (um) dia útil". */
function diasUteis(n: number): string {
  return `${quantidadeComExtenso(n)} ${n === 1 ? "dia útil" : "dias úteis"}`;
}

/** "10 (dez) dias"; "1 (um) dia". */
function diasCorridos(n: number): string {
  return `${quantidadeComExtenso(n)} ${n === 1 ? "dia" : "dias"}`;
}

/** Letra do item: A, B, C... (um unico padrao de subitem em todo o contrato). */
function letra(i: number): string {
  return String.fromCharCode(65 + i);
}

function comLetras(itens: readonly string[]): string[] {
  return itens.map((t, i) => `${letra(i)}. ${t}`);
}

function clausula(id: IdClausula, paragrafos: string[]): Clausula {
  return { id, titulo: TITULOS_CLAUSULA[id], paragrafos, origem: "padrao", problemas: [] };
}

/** Os Reels que o contrato promete ao todo: os do pacote mais os adicionais de Reels e de trend. */
export function quantidadeReels(b: Pick<BaseRedacao, "escopo" | "adicionais">): number {
  const extras = b.adicionais
    .filter((a) => a.tipo === "reels" || a.tipo === "trend")
    .reduce((s, a) => s + a.quantidade, 0);
  return b.escopo.reels.length + extras;
}

/**
 * Como cada Reels e descrito depois de "um"/"outro": "com o resumo do
 * evento", "exclusivo do making of", "do ensaio fotográfico".
 *
 * O catalogo guarda "resumo do evento" (substantivo); as outras descricoes ja
 * nascem como complemento ("do making of"). Descricao que a Mel digitou
 * comecando por artigo ("a entrada da debutante") ganha o "com".
 */
export function fraseDoReels(descricao: string): string {
  const d = semPontoFinal(limpo(descricao));
  if (!d) return "";
  const n = normalizarComparacao(d);
  if (n.startsWith("resumo")) return `com o ${d}`;
  if (/^(o|a|os|as) /.test(n)) return `com ${d}`;
  return d;
}

/**
 * "sendo um exclusivo do making of e outro com o resumo do evento". Vazio se
 * alguma descricao faltar: listar pela metade ("sendo um do making of e
 * outro") e pior que nao listar.
 */
function listaDosReels(descricoes: readonly string[]): string {
  const frases = descricoes.map(fraseDoReels);
  if (frases.length === 0 || frases.some((f) => !f)) return "";
  if (frases.length === 1) return frases[0];
  const itens = frases.map((f, i) => `${i === frases.length - 1 ? "outro" : "um"} ${f}`);
  return `sendo ${listaPtBr(itens)}`;
}

/** "1 (um) storymaker auxiliar" / "2 (dois) storymakers auxiliares". */
function auxiliares(k: number): string {
  return k === 1 ? "1 (um) storymaker auxiliar" : `${quantidadeComExtenso(k)} storymakers auxiliares`;
}

function descricaoDoEvento(b: BaseRedacao): string {
  const h = limpo(b.dados.evento.homenageado);
  switch (b.categoria) {
    case "casamento":
      return `do casamento de ${h}`;
    case "debutante":
      return `da festa de 15 (quinze) anos de ${h}`;
    case "aniversario":
      return `da festa de aniversário de ${h}`;
    case "corporativo": {
      // "da empresa X": sem artigo, "do evento corporativo de Vértice Soluções"
      // soava traduzido. Com o artigo ("da Vértice") o genero da razao social
      // teria de ser adivinhado; "da empresa" serve a qualquer nome.
      const tipo = limpo(b.dados.evento.tipoEvento).replace(/^["“”']+|["“”']+$/g, "").trim();
      return `do evento corporativo${tipo ? ` “${tipo}”` : ""} da empresa ${h}`;
    }
  }
}

// ---------------------------------------------------------------- partes --

/** Endereco com cada parte ja limpa, para a qualificacao. */
function enderecoLimpo(e: DadosContrato["contratante"]["pf"]["endereco"]) {
  return {
    logradouro: limpo(e.logradouro),
    numero: limpo(e.numero),
    complemento: limpo(e.complemento),
    bairro: limpo(e.bairro),
    cidade: limpo(e.cidade),
    uf: limpo(e.uf),
    cep: limpo(e.cep),
  };
}

function nacionalidadeDaPessoa(nacionalidade: string, genero: DadosContrato["contratante"]["pf"]["genero"]): string {
  const digitada = minusculaInicial(limpo(nacionalidade));
  return digitada || nacionalidadePadrao(genero);
}

/** Qualificacao da CONTRATANTE (pessoa fisica ou juridica), sem o rotulo. */
export function parteContratante(b: BaseRedacao): Parte {
  const c = b.dados.contratante;

  if (c.tipo === "pj") {
    const pj = c.pj;
    const rep = pj.representante;
    const endereco = enderecoLimpo(pj.endereco);
    const texto =
      `${limpo(pj.razaoSocial)}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${formatarCnpj(pj.cnpj)}, ` +
      `com sede ${preposicaoLogradouro(endereco.logradouro)} ${enderecoPorExtenso(endereco)}, ` +
      `neste ato representada por ${limpo(rep.nome)}, ${minusculaInicial(limpo(rep.cargo))}, ` +
      `${flexao(rep.genero, "inscrito", "inscrita")} no CPF sob o nº ${formatarCpf(rep.cpf)}, ` +
      `que declara possuir poderes para firmar o presente instrumento, com endereço eletrônico ${normalizarEmail(rep.email)}.`;
    return { rotulo: "CONTRATANTE", texto };
  }

  const pf = c.pf;
  const g = pf.genero;
  const endereco = enderecoLimpo(pf.endereco);
  let texto =
    `${limpo(pf.nome)}, ${nacionalidadeDaPessoa(pf.nacionalidade, g)}, ` +
    `${flexao(g, "inscrito", "inscrita")} no CPF sob o nº ${formatarCpf(pf.cpf)}, ` +
    `residente e ${flexao(g, "domiciliado", "domiciliada")} ${preposicaoLogradouro(endereco.logradouro)} ${enderecoPorExtenso(endereco)}, ` +
    `com endereço eletrônico ${normalizarEmail(pf.email)}, ` +
    "que declara ser maior de 18 (dezoito) anos e plenamente capaz para os atos da vida civil";
  if (b.menor) {
    texto +=
      `, e que contrata em nome próprio, na qualidade de ${minusculaInicial(limpo(c.vinculo))} de ` +
      `${limpo(b.dados.evento.homenageado)}, em cujo evento os serviços serão prestados`;
  }
  return { rotulo: "CONTRATANTE", texto: `${texto}.` };
}

/**
 * Empresa contratando evento de MENOR, com anuente que nao e o proprio
 * homenageado: o anuente e o responsavel legal do menor, e e ele quem
 * autoriza a imagem do menor -- a empresa nao pode (CC art. 20; ECA arts. 17
 * e 18). Sem isso, a imagem da crianca ia para o portfolio sem autorizacao
 * nenhuma, com a clausula dos menores dando a impressao contraria.
 */
export function anuenteResponsavelDoMenor(b: Pick<BaseRedacao, "dados" | "menor" | "anuenteEhHomenageado">): boolean {
  return b.dados.contratante.tipo === "pj" && b.menor && b.dados.anuente.ativo && !b.anuenteEhHomenageado;
}

/** Qualificacao do ANUENTE, ou `null` sem anuente. Remete a clausula dos direitos. */
export function parteAnuente(b: BaseRedacao): Parte | null {
  const a = b.dados.anuente;
  if (!a.ativo) return null;
  const oQueAutoriza = anuenteResponsavelDoMenor(b)
    ? `o uso de sua imagem e voz e da imagem e da voz de ${limpo(b.dados.evento.homenageado)}, de quem é responsável legal`
    : "o uso de sua imagem e voz";
  const texto =
    `${limpo(a.nome)}, ${nacionalidadePadrao(a.genero)}, ${flexao(a.genero, "inscrito", "inscrita")} no CPF sob o nº ${formatarCpf(a.cpf)}, ` +
    `com endereço eletrônico ${normalizarEmail(a.email)}, ${minusculaInicial(limpo(a.papel))} no evento, ` +
    `que intervém neste instrumento exclusivamente para autorizar ${oQueAutoriza}, nos termos da Cláusula {{ref:direitos}}.`;
  return { rotulo: "ANUENTE", texto };
}

/** Preambulo: com anuente, as tres partes nomeadas. */
export function preambuloDoContrato(b: Pick<BaseRedacao, "dados">): string {
  return b.dados.anuente.ativo ? PREAMBULO_COM_ANUENTE : PREAMBULO;
}

/** Ordem das partes: CONTRATANTE, CONTRATADA, ANUENTE (se houver). */
export function partesDoContrato(b: BaseRedacao): Parte[] {
  const partes: Parte[] = [parteContratante(b), { ...PARTE_CONTRATADA }];
  const anuente = parteAnuente(b);
  if (anuente) partes.push(anuente);
  return partes;
}

/** Bloco de assinaturas, na mesma ordem das partes. O e-mail e para a plataforma, nao e impresso. */
export function assinaturasDoContrato(b: BaseRedacao): Assinante[] {
  const c = b.dados.contratante;
  const contratante: Assinante =
    c.tipo === "pj"
      ? {
          papel: "contratante",
          rotulo: "CONTRATANTE",
          nome: limpo(c.pj.razaoSocial),
          documento: `CNPJ: ${formatarCnpj(c.pj.cnpj)} — p. ${limpo(c.pj.representante.nome)}, CPF: ${formatarCpf(c.pj.representante.cpf)}`,
          email: normalizarEmail(c.pj.representante.email),
        }
      : {
          papel: "contratante",
          rotulo: "CONTRATANTE",
          nome: limpo(c.pf.nome),
          documento: `CPF: ${formatarCpf(c.pf.cpf)}`,
          email: normalizarEmail(c.pf.email),
        };

  const assinaturas: Assinante[] = [contratante, { ...ASSINANTE_CONTRATADA }];
  const a = b.dados.anuente;
  if (a.ativo) {
    assinaturas.push({
      papel: "anuente",
      rotulo: "ANUENTE",
      nome: limpo(a.nome),
      documento: `CPF: ${formatarCpf(a.cpf)}`,
      email: normalizarEmail(a.email),
    });
  }
  return assinaturas;
}

// -------------------------------------------------------------- clausulas --

/** 1. DO OBJETO DO CONTRATO -- descreve o PACOTE; os adicionais vem por remissao. */
export function clausulaObjeto(b: BaseRedacao): Clausula {
  const e = b.escopoPacote;
  const pacote = limpo(b.dados.servico.pacote);
  const noPacote = pacote && pacote !== PACOTE_PERSONALIZADO ? `, no ${pacote}` : "";

  let p1 =
    `O presente contrato tem por objeto a prestação de serviços de storymaker${noPacote}, ` +
    `consistindo na cobertura ${descricaoDoEvento(b)}, pelo período de até ${duracaoPorExtenso(e.minutosCobertura)}`;

  const abrangencia = semPontoFinal(limpo(e.abrangencia));
  if (abrangencia) p1 += `, abrangendo ${abrangencia}`;

  if (e.minutosMakingOf > 0 && e.minutosEnsaio > 0) {
    p1 +=
      `, acrescido de até ${duracaoPorExtenso(e.minutosMakingOf)} de making of, ` +
      `e de até ${duracaoPorExtenso(e.minutosEnsaio)} de cobertura do ensaio fotográfico`;
  } else if (e.minutosMakingOf > 0) {
    p1 += `, acrescido de até ${duracaoPorExtenso(e.minutosMakingOf)} de making of`;
  } else if (e.minutosEnsaio > 0) {
    p1 += `, acrescido de até ${duracaoPorExtenso(e.minutosEnsaio)} de cobertura do ensaio fotográfico`;
  }

  if (e.stories) {
    p1 += ", através de registros em formato de stories ilimitados (Instagram)";
    if (e.minutosMakingOf > 0) p1 += ", incluindo stories do making of e dos melhores momentos do evento";
  }

  const n = e.reels.length;
  if (n > 0) {
    p1 += `, bem como a gravação e edição de ${quantidadeComExtenso(n)} Reels de até ${segundosPorExtenso(e.segundosReels)}`;
    if (n > 1) p1 += " cada";
    const lista = listaDosReels(e.reels);
    if (lista) p1 += `, ${lista}`;
  }

  const paragrafos = [`${p1}.`];

  if (b.escopo.storymakers >= 2) {
    paragrafos.push(`A cobertura será realizada por equipe composta pela CONTRATADA e ${auxiliares(b.escopo.storymakers - 1)}.`);
  } else if (auxiliarParcial(b.escopo)) {
    paragrafos.push(`A cobertura contará, por até ${duracaoPorExtenso(b.escopo.minutosAuxiliar)}, com 1 (um) storymaker auxiliar.`);
  }

  const extras = b.escopo.extras.map((x) => semPontoFinal(limpo(x))).filter(Boolean);
  if (extras.length > 0) paragrafos.push(`Inclui-se, ainda: ${listaPtBr(extras)}.`);

  if (b.adicionais.length === 1) {
    paragrafos.push("Integra também o objeto deste contrato o serviço adicional descrito na Cláusula {{ref:adicionais}}.");
  } else if (b.adicionais.length > 1) {
    paragrafos.push("Integram também o objeto deste contrato os serviços adicionais descritos na Cláusula {{ref:adicionais}}.");
  }

  return clausula("objeto", paragrafos);
}

const A_DEFINIR = "A DEFINIR, devendo ser informado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência";

/**
 * As linhas do ensaio fotografico na clausula 2 -- so com ensaio no escopo.
 *
 * O ensaio e em OUTRO dia, antes do evento. Sem data, a linha diz como ela
 * sera marcada: de comum acordo, antes do evento, sujeita a agenda da
 * CONTRATADA, com a CONTRATANTE agendando com 10 dias de antecedencia. O que
 * ficou sem data vai junto na mesma frase ("em data e local de comum
 * acordo"); com a data, local e inicio ganham linha propria, como no making of.
 * A duracao vai na linha do ensaio, e nao no "Tempo de serviço" do dia da
 * festa -- somada la, a cliente leria as horas de ensaio como horas no dia
 * do evento.
 */
export function linhasDoEnsaio(b: BaseRedacao): string[] {
  const e = b.escopo;
  if (e.minutosEnsaio <= 0) return [];
  const ev = b.dados.evento;
  const duracao = `com duração de até ${duracaoPorExtenso(e.minutosEnsaio)}`;
  const data = dataISOValida(ev.ensaioData) ? dataPorExtenso(ev.ensaioData.trim()) : "";
  const local = semPontoFinal(limpo(ev.ensaioLocal));
  const hora = horaBr(ev.ensaioHorario);

  if (!data) {
    const aDefinir = ["data", ...(hora ? [] : ["horário"]), ...(local ? [] : ["local"])];
    const sujeitos = aDefinir.length === 1 ? "sujeita" : "sujeitos";
    const linhas = [
      `Ensaio fotográfico: A DEFINIR, ${duracao}, em ${listaPtBr(aDefinir)} de comum acordo entre as partes, ` +
        `anterior à data do evento e ${sujeitos} à disponibilidade da CONTRATADA, ` +
        "devendo ser agendado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência",
    ];
    if (local) linhas.push(`Local do ensaio fotográfico: ${local}`);
    if (hora) linhas.push(`Início do ensaio fotográfico: ${hora}`);
    return linhas;
  }

  return [
    `Ensaio fotográfico: ${data}, ${duracao}`,
    `Local do ensaio fotográfico: ${local || A_DEFINIR}`,
    `Início do ensaio fotográfico: ${hora || A_DEFINIR}`,
  ];
}

/** 2. DO LOCAL, DATA E HORÁRIO DO EVENTO -- uma linha por paragrafo; ";" em todas, "." na ultima. */
export function clausulaLocal(b: BaseRedacao): Clausula {
  const ev = b.dados.evento;
  const e = b.escopo;
  const linhas: string[] = [
    `Data do evento: ${dataPorExtenso(ev.data)}`,
    `Início da cobertura do evento: ${horaBr(ev.horarioInicio)}`,
  ];

  for (const l of ev.locais) {
    const rotulo = semPontoFinal(limpo(l.rotulo));
    const endereco = semPontoFinal(limpo(l.endereco));
    if (!rotulo && !endereco) continue; // linha em branco que ficou no painel
    linhas.push(`${rotulo}: ${endereco}`);
  }

  if (e.minutosMakingOf > 0) {
    const local = semPontoFinal(limpo(ev.makingOfLocal));
    const hora = horaBr(ev.makingOfHorario);
    if (!local && !hora) {
      linhas.push(
        "Local e início do making of: A DEFINIR, devendo ser informados pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência",
      );
    } else {
      linhas.push(`Local do making of: ${local || A_DEFINIR}`);
      linhas.push(`Início do making of: ${hora || A_DEFINIR}`);
    }
  }

  linhas.push(...linhasDoEnsaio(b));

  // O tempo de servico e o do DIA DO EVENTO: o ensaio tem a duracao na
  // propria linha, porque acontece em outro dia.
  const partesDoTempo: string[] = [];
  if (e.minutosMakingOf > 0) partesDoTempo.push(`${duracaoCurta(e.minutosMakingOf)} de making of`);
  partesDoTempo.push(`${duracaoCurta(e.minutosCobertura)} de cobertura do evento`);

  // Com ensaio, o rotulo diz de que dia e o total: logo abaixo da linha do
  // ensaio, "Tempo de serviço" sozinho ainda se leria como o total geral.
  const rotuloTempo = e.minutosEnsaio > 0 ? "Tempo de serviço no dia do evento" : "Tempo de serviço";
  let tempo = `${rotuloTempo}: ${duracaoPorExtenso(e.minutosMakingOf + e.minutosCobertura)}`;
  if (partesDoTempo.length > 1) tempo += ` (${partesDoTempo.join(" + ")})`;
  linhas.push(tempo);

  return clausula(
    "local",
    linhas.map((l, i) => `${l}${i === linhas.length - 1 ? "." : ";"}`),
  );
}

/** 3. DOS SERVIÇOS -- itens A., B., C. conforme o que o escopo efetivo tem. */
export function clausulaServicos(b: BaseRedacao): Clausula {
  const e = b.escopo;
  const itens: string[] = [];

  if (e.stories) {
    const doQue = e.minutosMakingOf > 0 ? "do making of e do evento" : "do evento";
    itens.push(
      e.tempoReal
        ? `Realizar stories ilimitados ${doQue}, utilizando equipamento próprio, com captação, edição e publicação ao longo da cobertura, diretamente na conta do Instagram fornecida pela CONTRATANTE, durante o período contratado.`
        : // O prazo vem ANTES da conta: "na conta fornecida pela CONTRATANTE em
          // até 5 dias" deixava ler que era a conta que se fornecia em 5 dias.
          `Realizar stories ilimitados ${doQue}, utilizando equipamento próprio, com publicação, em até ${diasUteis(e.diasStories)} após o evento, diretamente na conta do Instagram fornecida pela CONTRATANTE.`,
    );
  }

  const n = e.reels.length;
  const duracao = segundosPorExtenso(e.segundosReels);
  if (n === 1) {
    const frase = fraseDoReels(e.reels[0]);
    itens.push(`Gravar e editar 1 (um) Reels/Vídeo${frase ? ` ${frase}` : ""}, com duração de até ${duracao}.`);
  } else if (n > 1) {
    const lista = listaDosReels(e.reels);
    itens.push(`Gravar e editar ${quantidadeComExtenso(n)} Reels, com duração de até ${duracao} cada${lista ? `, ${lista}` : ""}.`);
  }

  const k = e.storymakers - 1;
  if (k === 1) {
    itens.push(
      "Contar com 1 (um) storymaker auxiliar, que atuará em conjunto com a CONTRATADA durante a cobertura, seguindo as diretrizes por ela estabelecidas.",
    );
  } else if (k > 1) {
    itens.push(
      `Contar com ${auxiliares(k)}, que atuarão em conjunto com a CONTRATADA durante a cobertura, seguindo as diretrizes por ela estabelecidas.`,
    );
  } else if (auxiliarParcial(e)) {
    itens.push(
      `Contar, por até ${duracaoPorExtenso(e.minutosAuxiliar)}, com 1 (um) storymaker auxiliar, que atuará em conjunto com a CONTRATADA, seguindo as diretrizes por ela estabelecidas.`,
    );
  }

  for (const extra of e.extras.map((x) => semPontoFinal(limpo(x))).filter(Boolean)) {
    // "10 (dez) fotos Polaroid" se entrega; um espaco ("o cantinho das fotos") se disponibiliza.
    itens.push(/^\d/.test(extra) ? `Entregar ${extra}.` : `Disponibilizar ${extra}.`);
  }

  // `faltantes` ja recusa pacote sem entrega nenhuma; isto so evita uma
  // clausula vazia (o schema exige um paragrafo) se alguem chamar direto.
  if (itens.length === 0) itens.push("Prestar os serviços descritos na Cláusula {{ref:objeto}}.");

  return clausula("servicos", comLetras(itens));
}

/** Um adicional, sem a letra. Valor unitario e total sempre com o extenso. */
export function textoAdicional(a: AdicionalRedacao): string {
  const desc = semPontoFinal(limpo(a.descricao));
  const Desc = primeiraMaiuscula(desc);
  const q = a.quantidade;
  const total = a.valorUnitario * q;

  if (a.tipo === "making_of") {
    return `${Desc}, com duração de até ${duracaoPorExtenso(a.minutos)}, no valor de ${valorComExtenso(total)}.`;
  }

  const unidade = a.unidade;
  if (a.tipo === "hora_adicional" && normalizarComparacao(desc).startsWith("hora adicional")) {
    const singular = desc.replace(/^hora adicional/i, "hora adicional");
    if (q === 1) return `1 (uma) ${singular}, no valor de ${valorComExtenso(total)}.`;
    const plural = desc.replace(/^hora adicional/i, "horas adicionais");
    return `${quantidadeComExtenso(q, "feminino")} ${plural}, no valor de ${valorComExtenso(a.valorUnitario)} por hora, totalizando ${valorComExtenso(total)}.`;
  }

  if (unidade === "hora" || a.tipo === "hora_adicional") {
    if (q === 1) return `${Desc}: 1 (uma) hora, no valor de ${valorComExtenso(total)}.`;
    return `${Desc}: ${quantidadeComExtenso(q, "feminino")} horas, no valor de ${valorComExtenso(a.valorUnitario)} por hora, totalizando ${valorComExtenso(total)}.`;
  }

  if (q > 1) {
    // "2 (dois) Vídeo de trend" nao concorda; a quantidade vai em unidades.
    return `${Desc}: ${quantidadeComExtenso(q, "feminino")} unidades, no valor de ${valorComExtenso(a.valorUnitario)} por unidade, totalizando ${valorComExtenso(total)}.`;
  }

  return `${Desc}, no valor de ${valorComExtenso(total)}.`;
}

/** Quantos making ofs o contrato tem ao todo: o do pacote (se houver) e os adicionais. */
export function quantidadeMakingOfs(b: {
  escopoPacote: Pick<Escopo, "minutosMakingOf">;
  adicionais: readonly Pick<Adicional, "tipo" | "quantidade">[];
}): number {
  const doPacote = b.escopoPacote.minutosMakingOf > 0 ? 1 : 0;
  return doPacote + b.adicionais.filter((a) => a.tipo === "making_of").reduce((s, a) => s + a.quantidade, 0);
}

/**
 * Entra o paragrafo dos making ofs alternados? So com dois ou mais making
 * ofs, uma profissional so na cobertura inteira, e NENHUM adicional que
 * indique uma segunda pessoa: com um storymaker auxiliar (mesmo por hora) ou
 * um "Outro serviço" de auxiliar no making of, "impossibilitando a realização
 * simultânea" desmentiria o adicional logo acima.
 */
export function temMakingOfsAlternados(b: {
  escopoPacote: Pick<Escopo, "minutosMakingOf">;
  escopo: Pick<Escopo, "storymakers">;
  adicionais: readonly Pick<Adicional, "id" | "tipo" | "descricao" | "quantidade">[];
}): boolean {
  return quantidadeMakingOfs(b) >= 2 && b.escopo.storymakers === 1 && !b.adicionais.some(adicionalIndicaSegundaPessoa);
}

/** 4. DOS SERVIÇOS ADICIONAIS -- so existe com adicionais. */
export function clausulaAdicionais(b: BaseRedacao): Clausula | null {
  const n = b.adicionais.length;
  if (n === 0) return null;

  const paragrafos = [
    n === 1
      ? "Fica acordada a inclusão do seguinte serviço adicional à cobertura principal:"
      : "Fica acordada a inclusão dos seguintes serviços adicionais à cobertura principal:",
    ...comLetras(b.adicionais.map(textoAdicional)),
  ];

  if (temMakingOfsAlternados(b)) paragrafos.push(PARAGRAFO_MAKING_OFS_ALTERNADOS);

  paragrafos.push(
    n === 1
      ? "O serviço adicional integra o presente contrato para todos os fins, aplicando-se a ele as mesmas condições técnicas, operacionais e prazos aqui estabelecidos."
      : "Os serviços adicionais integram o presente contrato para todos os fins, aplicando-se a eles as mesmas condições técnicas, operacionais e prazos aqui estabelecidos.",
  );

  return clausula("adicionais", paragrafos);
}

/** 5a. DOS PRAZOS -- quando a entrega NAO e em tempo real. */
export function clausulaPrazos(b: BaseRedacao): Clausula {
  const e = b.escopo;
  const nReels = quantidadeReels(b);
  const oReels = nReels === 1 ? "o Reels" : "os Reels";
  const dm = e.diasMaterial;
  const dr = e.diasReels;
  const stories = e.stories
    ? `a cobertura completa dos stories no prazo de até ${diasUteis(e.diasStories)} após o evento`
    : "";

  let oQue: string;
  if (nReels === 0) {
    oQue = stories
      ? `${stories}, bem como todo o material bruto captado no prazo de até ${diasUteis(dm)}`
      : `todo o material bruto captado no prazo de até ${diasUteis(dm)} após o evento`;
  } else if (dm === dr) {
    oQue = stories
      ? `${stories}, bem como ${oReels} e todo o material bruto captado no prazo de até ${diasUteis(dm)}`
      : `${oReels} e todo o material bruto captado no prazo de até ${diasUteis(dm)} após o evento`;
  } else if (dm < dr) {
    oQue = stories
      ? `${stories}, todo o material bruto captado no prazo de até ${diasUteis(dm)} e ${oReels} em até ${diasUteis(dr)}`
      : `todo o material bruto captado no prazo de até ${diasUteis(dm)} após o evento e ${oReels} em até ${diasUteis(dr)}`;
  } else {
    // Material depois dos Reels: cada prazo com o seu numero, sem esconder o dos Reels no maior.
    oQue = stories
      ? `${stories}, ${oReels} no prazo de até ${diasUteis(dr)} e todo o material bruto captado em até ${diasUteis(dm)}`
      : `${oReels} no prazo de até ${diasUteis(dr)} após o evento e todo o material bruto captado em até ${diasUteis(dm)}`;
  }

  return clausula("prazos", [`A CONTRATADA compromete-se a entregar ${oQue}.`]);
}

/** 5b. DAS CONDIÇÕES TÉCNICAS, OPERACIONAIS E PRAZOS -- quando a entrega e em tempo real. */
export function clausulaCondicoesTecnicas(b: BaseRedacao): Clausula {
  const e = b.escopo;
  const nReels = quantidadeReels(b);
  const dm = e.diasMaterial;
  const dr = e.diasReels;

  let entrega: string;
  if (nReels === 0) {
    entrega = `A CONTRATADA compromete-se, ainda, a entregar o material bruto captado no prazo de até ${diasUteis(dm)} após a data do evento.`;
  } else {
    let oQue: string;
    if (nReels === 1 && e.reels.length === 1) {
      const frase = fraseDoReels(e.reels[0]);
      oQue = `o Reels/Vídeo${frase ? ` ${frase}` : ""}`;
    } else {
      oQue = nReels === 1 ? "o Reels" : "os Reels";
    }
    entrega =
      dm === dr
        ? `A CONTRATADA compromete-se, ainda, a entregar ${oQue}, bem como o material bruto captado, no prazo de até ${diasUteis(dr)} após a data do evento.`
        : `A CONTRATADA compromete-se, ainda, a entregar ${oQue} no prazo de até ${diasUteis(dr)} após a data do evento, e o material bruto captado em até ${diasUteis(dm)}.`;
  }

  return clausula("condicoes_tecnicas", [
    "A CONTRATANTE declara estar ciente de que a execução dos serviços depende da disponibilidade de conexão à internet no local do evento, sendo recomendada a disponibilização de acesso à rede Wi-Fi ou sinal adequado.",
    "A dinâmica da cobertura envolve fluxo contínuo de captação, edição e publicação de conteúdos ao longo do evento, podendo haver variações no tempo de postagem em razão de fatores técnicos, operacionais ou de conectividade.",
    "**Na hipótese de instabilidade ou ausência de conexão com a internet que inviabilize a publicação durante o evento, a CONTRATADA realizará a edição e postagem dos conteúdos em até 48 (quarenta e oito) horas após o evento.**",
    "A CONTRATANTE declara estar ciente, ainda, de que a finalização da cobertura poderá ocorrer após o encerramento do período presencial contratado, considerando o fluxo de produção do material captado.",
    entrega,
  ]);
}

/** 6. DO ACESSO À CONTA DO INSTAGRAM -- so quando ha stories. */
export function clausulaInstagram(b: BaseRedacao): Clausula | null {
  if (!b.escopo.stories) return null;
  return clausula("instagram", [
    "A CONTRATANTE fornecerá à CONTRATADA, até o dia do evento, acesso à conta do Instagram em que os stories serão publicados, preferencialmente pelas ferramentas de acesso compartilhado da própria plataforma. A CONTRATADA e sua equipe utilizarão esse acesso exclusivamente para publicar o conteúdo do evento, sem ler ou responder mensagens diretas nem alterar configurações da conta, e deixarão de utilizá-lo ao término dos serviços, recomendando-se à CONTRATANTE a alteração da senha.",
    "**Na ausência desse acesso, a cobertura será entregue juntamente com o restante do material, por meio de link para download em nuvem.**",
  ]);
}

/** Quando cada parcela e paga, no fim do item. */
export function textoVencimento(v: Vencimento): string {
  switch (v.tipo) {
    case "assinatura":
      return "a ser pago na assinatura deste contrato";
    case "data":
      return `com vencimento em ${dataPorExtenso(v.data)}`;
    case "dias_antes":
      return v.dias === 0 ? "a ser pago até a data do evento" : `a ser pago até ${diasCorridos(v.dias)} antes da data do evento`;
    case "pago":
      return `já pago pela CONTRATANTE em ${dataPorExtenso(v.data)}`;
  }
}

/** 7. DO PAGAMENTO -- parcelas (com o sinal identificado) ou pagamento ja quitado. */
export function clausulaPagamento(b: BaseRedacao): Clausula {
  const pag = b.dados.pagamento;
  const nAdicionais = b.adicionais.length;
  const incluidos =
    nAdicionais === 0 ? "" : nAdicionais === 1 ? ", já incluído o serviço adicional" : ", já incluídos os serviços adicionais";

  if (pag.modo === "quitado") {
    return clausula("pagamento", [
      `O valor total dos serviços prestados é de ${valorComExtenso(b.total)}${incluidos}, integralmente pago pela CONTRATANTE via PIX em ${dataPorExtenso(pag.quitadoEm)}, dando a CONTRATADA plena quitação.`,
      `Do valor pago, ${percentualComExtenso(pag.percentualSinalQuitado)}, equivalente a ${valorComExtenso(b.sinal)}, corresponde ao sinal para garantir a reserva da data.`,
    ]);
  }

  const paragrafos = [
    `O valor total dos serviços prestados será de ${valorComExtenso(b.total)}${incluidos}. O pagamento será realizado da seguinte forma:`,
  ];

  const sinais = b.parcelas.filter((p) => p.sinal);
  // Sinal partido (15/15/70): cada parcela e "parte do sinal", e o "para
  // garantir a reserva da data" fica so no paragrafo-resumo. Repetido em cada
  // parcela, a CONTRATANTE lia a data reservada ja na primeira, e o resumo
  // logo abaixo dizia que so com o sinal inteiro -- contradicao que se le
  // contra quem redigiu (CDC art. 47).
  const sinalPartido = sinais.length >= 2;

  b.parcelas.forEach((p, i) => {
    const sinal = !p.sinal ? "" : sinalPartido ? ", como parte do sinal" : ", a título de sinal para garantir a reserva da data";
    const fim = i === b.parcelas.length - 1 ? "." : ";";
    paragrafos.push(
      `${letra(i)}. ${percentualComExtenso(p.percentual)} do valor total, equivalente a ${valorComExtenso(p.valor)}${sinal}, ${textoVencimento(p.vencimento)}${fim}`,
    );
  });

  const sinalPago = sinais.length > 0 && sinais.every((p) => p.vencimento.tipo === "pago");
  if (sinalPartido) {
    const resumo = `O sinal destinado a garantir a reserva da data corresponde à soma das parcelas acima identificadas como parte do sinal, no total de ${valorComExtenso(b.sinal)}`;
    paragrafos.push(
      sinalPago
        ? `${resumo}, e a reserva da data fica garantida com o sinal já pago.`
        : `${resumo}, e **a reserva da data somente será garantida após a confirmação do pagamento integral do sinal.**`,
    );
  } else if (sinais.length === 1) {
    paragrafos.push(
      sinalPago
        ? "A reserva da data fica garantida com o sinal já pago."
        : "**A reserva da data somente será garantida mediante a confirmação do pagamento do sinal.**",
    );
  }

  paragrafos.push(
    `Todos os pagamentos deverão ser realizados via PIX, utilizando a chave PIX (CNPJ): ${CONTRATADA.chavePix}.`,
  );
  return clausula("pagamento", paragrafos);
}

/** 8. DA PLATAFORMA DE ENTREGA */
export function clausulaEntrega(): Clausula {
  return clausula("entrega", [
    "Os registros serão entregues por meio de um link de compartilhamento de arquivos em nuvem, **não sendo a CONTRATADA obrigada a disponibilizá-los por outros meios.**",
  ]);
}

/** 9. DO TEMPO DE ARMAZENAMENTO */
export function clausulaArmazenamento(): Clausula {
  return clausula("armazenamento", [
    "**A CONTRATANTE terá acesso ao link com os registros por um período de 6 (seis) meses após o evento, cabendo a ela realizar o download dos arquivos dentro desse prazo. Após este prazo, os arquivos serão excluídos da nuvem.**",
    "Parágrafo único. Ficam preservados os conteúdos utilizados no portfólio e na divulgação do trabalho da CONTRATADA, nos termos da Cláusula {{ref:direitos}}.",
  ]);
}

/**
 * 10. DOS DIREITOS AUTORAIS E AUTORIZAÇÃO DE IMAGEM
 *
 * Quem autoriza o uso da imagem:
 * - a CONTRATANTE, sempre, pela propria imagem;
 * - o menor de 16 (ou de idade desconhecida), pela CONTRATANTE como
 *   representante legal;
 * - o anuente, por si -- e, se for o aniversariante de 16-17, assistido pela
 *   CONTRATANTE. Sem anuente, o menor de 16-17 NAO fica coberto: a montagem
 *   avisa a Mel em vez de escrever uma autorizacao que nao vale;
 * - empresa contratante nao autoriza imagem de ninguem: so o anuente autoriza
 *   (e, em evento de menor, o anuente responsavel legal autoriza tambem a do
 *   menor). Sem anuente, a montagem avisa.
 *
 * Cada autorizacao e um item proprio. Numa frase so ("a CONTRATANTE autoriza
 * ..., e Fulano, na qualidade de anuente, autoriza igualmente ..., captadas no
 * evento, no portfólio ... inclusive em anúncios pagos"), o alcance ficava
 * gramaticalmente preso a oracao do anuente, e a autorizacao da CONTRATANTE
 * sem finalidade expressa -- autorizacao gratuita de imagem se le de forma
 * restritiva (CC art. 114).
 */
export function clausulaDireitos(b: BaseRedacao): Clausula {
  const pf = b.dados.contratante.tipo === "pf";
  const a = b.dados.anuente;
  const nomeAnuente = limpo(a.nome);
  const homenageado = limpo(b.dados.evento.homenageado);

  const itens = [
    pf
      ? "Os direitos autorais sobre o material produzido pertencem à CONTRATADA, nos termos da Lei nº 9.610/98. A CONTRATADA concede à CONTRATANTE licença gratuita, não exclusiva e por prazo indeterminado para guardar, publicar e compartilhar o material entregue, para fins pessoais e não comerciais, inclusive em suas redes sociais, indicando-se, sempre que possível, a autoria da CONTRATADA."
      : "Os direitos autorais sobre o material produzido pertencem à CONTRATADA, nos termos da Lei nº 9.610/98. A CONTRATADA concede à CONTRATANTE licença gratuita, não exclusiva e por prazo indeterminado para utilizar o material entregue em seus canais próprios, para fins institucionais e publicitários, indicando-se, sempre que possível, a autoria da CONTRATADA.",
  ];

  if (pf) {
    let quem = "sua imagem e voz";
    if (b.menor && b.menorDe16) {
      quem += ` e, na qualidade de ${minusculaInicial(limpo(b.dados.contratante.vinculo))} e representante legal, a imagem e a voz de ${homenageado}`;
    }
    itens.push(
      `**A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar ${quem}, captadas no evento, ` +
        "no portfólio e na divulgação do trabalho da CONTRATADA em seu site e em seus perfis profissionais nas redes sociais, " +
        "inclusive em anúncios pagos, podendo as publicações incluir marcações, menções ou colaborações com outros fornecedores envolvidos no evento.**",
    );
  } else {
    itens.push(
      "**A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar o material produzido no evento no portfólio e na divulgação do trabalho da CONTRATADA " +
        "em seu site e em seus perfis profissionais nas redes sociais, inclusive em anúncios pagos, podendo as publicações incluir marcações, menções ou colaborações " +
        "com a CONTRATANTE e com outros fornecedores envolvidos no evento.**",
    );
  }

  if (a.ativo) {
    if (anuenteResponsavelDoMenor(b)) {
      itens.push(
        `**${nomeAnuente}, na qualidade de anuente e de responsável legal de ${homenageado}, autoriza a CONTRATADA, nas mesmas condições do item anterior, ` +
          `a utilizar sua imagem e voz e a imagem e a voz de ${homenageado}.**`,
      );
    } else {
      // Assistencia so existe com pessoa fisica: empresa nao assiste menor.
      const assistido =
        pf && b.menor && !b.menorDe16 && b.anuenteEhHomenageado
          ? `, ${flexao(a.genero, "assistido", "assistida")} pela CONTRATANTE`
          : "";
      itens.push(
        `**${nomeAnuente}, na qualidade de anuente${assistido}, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.**`,
      );
    }
  }

  if (b.menor) {
    itens.push(
      "As publicações da CONTRATADA não incluirão informações que permitam localizar menores de idade retratados, como sobrenome, escola ou endereço.",
    );
  }
  return clausula(
    "direitos",
    itens.map((t, i) => `{{n}}.${i + 1}. ${t}`),
  );
}

/** 11. DA ALIMENTAÇÃO -- so quando o evento tem buffet para a equipe. */
export function clausulaAlimentacao(b: BaseRedacao): Clausula | null {
  if (!b.dados.evento.alimentacao) return null;
  const k = b.escopo.storymakers - 1;
  let quem: string;
  if (k >= 1) {
    quem = `a CONTRATADA e ${k === 1 ? "1 (um) profissional" : `${quantidadeComExtenso(k)} profissionais`} de sua equipe têm`;
  } else if (auxiliarParcial(b.escopo)) {
    // O auxiliar por hora esta no evento so por parte dele: a frase nao pode
    // sugerir que ele fica a cobertura inteira.
    quem = `a CONTRATADA e 1 (um) profissional de sua equipe, que atuará por até ${duracaoPorExtenso(b.escopo.minutosAuxiliar)}, têm`;
  } else {
    quem = "a CONTRATADA tem";
  }
  // "bem como A TER acesso À alimentação e ÀS bebidas": o segundo termo pede a
  // mesma regencia do primeiro ("direito a se servir").
  return clausula("alimentacao", [
    `A CONTRATANTE informará à equipe do local do evento que ${quem} direito a se servir do buffet, bem como a ter acesso à alimentação e às bebidas não alcoólicas disponibilizadas durante o evento.`,
  ]);
}

/** 12. DAS ALTERAÇÕES DO MATERIAL */
export function clausulaAlteracoes(): Clausula {
  return clausula("alteracoes", [
    "**A CONTRATANTE reconhece que o serviço de storymaker não inclui adaptações, revisões ou modificações do material, por preferência estética, após a finalização e entrega.** Não se incluem nesta regra as falhas técnicas ou de informação atribuíveis à CONTRATADA, como grafia incorreta de nomes, arquivo corrompido ou material incompleto em relação ao contratado, que serão corrigidas sem custo em até 5 (cinco) dias úteis contados da comunicação da CONTRATANTE.",
  ]);
}

/**
 * 13. DA DESISTÊNCIA OU ADIAMENTO DO EVENTO -- a reciprocidade fica por
 * ultimo.
 *
 * Os itens 3 e 4 dizem o que o contrato calava: o destino do que foi pago
 * ALEM do sinal (que os presets "Tudo na assinatura" e "Já pago" tornam o caso
 * comum -- 100% entra na assinatura) e o adiamento para uma data livre. O que
 * NAO esta aqui de proposito: ressalva de caso fortuito ou forca maior na
 * retencao do sinal -- e decisao comercial do owner, ainda nao tomada.
 */
export function clausulaDesistencia(): Clausula {
  return clausula("desistencia", [
    "{{n}}.1. **Em caso de desistência ou cancelamento do evento pela CONTRATANTE, o sinal previsto na Cláusula {{ref:pagamento}} não será reembolsado.**",
    "{{n}}.2. **Se o evento for adiado e a nova data coincidir com outro compromisso da CONTRATADA, o serviço não será prestado e o sinal não será reembolsado.**",
    "{{n}}.3. Nas hipóteses dos itens {{n}}.1 e {{n}}.2, os valores pagos além do sinal serão restituídos à CONTRATANTE em até 10 (dez) dias.",
    "{{n}}.4. Adiado o evento a pedido da CONTRATANTE para data em que a CONTRATADA esteja disponível, os valores já pagos serão aproveitados para a nova data.",
    "{{n}}.5. Caso a CONTRATADA deixe de prestar os serviços por motivo a ela imputável, fora das hipóteses da Cláusula {{ref:equipe}}, restituirá à CONTRATANTE, em até 10 (dez) dias, a integralidade dos valores pagos, acrescida de quantia equivalente ao sinal, sem prejuízo dos demais direitos assegurados à CONTRATANTE pela legislação.",
  ]);
}

/** 14. DA EQUIPE DE TRABALHO */
export function clausulaEquipe(): Clausula {
  return clausula("equipe", [
    "Em caso de impossibilidade da CONTRATADA de comparecer ao evento por motivo de força maior ou caso fortuito, a CONTRATADA designará outro profissional de sua equipe para a realização do serviço contratado, comunicando o fato à CONTRATANTE tão logo tenha conhecimento do impedimento. **A CONTRATANTE declara estar ciente de que o profissional designado atuará seguindo o mesmo padrão de trabalho, identidade visual e diretrizes previamente estabelecidas pela CONTRATADA, e de que tal substituição não caracterizará descumprimento contratual.**",
    "Parágrafo único. Não sendo possível a substituição, o contrato será resolvido e a CONTRATADA restituirá integralmente os valores pagos pela CONTRATANTE, em até 10 (dez) dias.",
  ]);
}

/**
 * 15. DAS CONDIÇÕES ESPECIAIS -- os paragrafos que a IA redigiu (ja com os
 * nomes de volta) mais o paragrafo unico de prevalencia. Sem paragrafo, sem
 * clausula. `problemas` fica vazio aqui: quem valida e `montar.ts`.
 */
export function clausulaCondicoesEspeciais(paragrafosIa: readonly string[] | null | undefined): Clausula | null {
  const paragrafos = (paragrafosIa ?? []).map((p) => (p ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paragrafos.length === 0) return null;
  return {
    id: "condicoes_especiais",
    titulo: TITULOS_CLAUSULA.condicoes_especiais,
    paragrafos: [...paragrafos, PARAGRAFO_UNICO_CONDICOES_ESPECIAIS],
    origem: "ia",
    problemas: [],
  };
}

/** 16. DA ASSINATURA ELETRÔNICA */
export function clausulaAssinaturaEletronica(): Clausula {
  return clausula("assinatura_eletronica", [
    `As partes reconhecem como válida e eficaz a assinatura deste instrumento por meio eletrônico, pela plataforma ${CONTRATADA.plataformaAssinatura}, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, e declaram que a versão eletrônica, acompanhada do respectivo registro de assinaturas, constitui o original deste contrato.`,
  ]);
}

/**
 * 17. DO FORO. Pessoa fisica: domicilio da CONTRATANTE (consumidor; eleger
 * outro foro seria clausula nula, CDC art. 101, I). Pessoa juridica: Monte
 * Mor/SP, domicilio da CONTRATADA.
 */
export function clausulaForo(b: BaseRedacao): Clausula {
  // "justas e contratadas, as partes": o sujeito e "as partes" (e CONTRATANTE
  // e CONTRATADA, ambas femininas), e a concordancia vai com ele. A formula
  // tradicional, "justos e contratados, assinam", ficava sem sujeito expresso.
  const fecho =
    "E, por estarem assim justas e contratadas, as partes assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito.";
  return clausula("foro", [
    b.dados.contratante.tipo === "pj"
      ? `As partes elegem o Foro da Comarca de ${CONTRATADA.foroPJ}, domicílio da CONTRATADA, para dirimir judicialmente as controvérsias inerentes ao presente contrato, renunciando a qualquer outro, por mais privilegiado que seja. ${fecho}`
      : `As partes elegem o foro da comarca do domicílio da CONTRATANTE para dirimir judicialmente as controvérsias inerentes ao presente contrato. ${fecho}`,
  ]);
}
