// Regras de ESTADO da secao de contrato no painel, sem React: o que conta como
// "alteracao nao salva", como a extracao da IA entra nos campos, quando o texto
// gerado ficou velho em relacao aos dados, e quais avisos mostrar.
//
// Tudo aqui decide o que a Mel ve e o que ela consegue clicar (o botao do PDF
// trava com texto velho), entao mora num modulo puro e testado em vez de
// espalhado pelos componentes.

import { limparCnpj, limparCpf, normalizarEmail, somenteDigitos } from "@/lib/contrato/documento";
import {
  avisosDeterministicos,
  montarContrato,
  unidadeDoAdicional as unidadeNaMontagem,
  type ContextoMontagem,
} from "@/lib/contrato/montar";
import {
  contratanteSchema,
  dadosContratoSchema,
  type Adicional,
  type Aviso,
  type Contratante,
  type DadosContrato,
  type DocumentoContrato,
  type Endereco,
  type StatusAssinatura,
} from "@/lib/contrato/tipos";
import { ehClausulaDoModelo } from "@/lib/contrato/validar";
import type { TemplateId } from "@/lib/form/types";

// ------------------------------------------------------------ comparacao --

/**
 * JSON com as chaves em ordem alfabetica, em qualquer profundidade.
 *
 * `JSON.stringify` puro depende da ordem em que as chaves foram criadas: um
 * objeto que voltou do servidor (ordem do schema) e o mesmo objeto montado a
 * mao no painel dariam strings diferentes, e o painel acusaria "alteracoes nao
 * salvas" sem a Mel ter mexido em nada.
 */
export function chaveEstavel(valor: unknown): string {
  return JSON.stringify(valor, (_chave, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, obj[k]]),
      );
    }
    return v;
  });
}

/**
 * Os dados salvos, passados pelo schema (completa campos que um registro
 * antigo nao tinha). `null` quando nao passam -- quem chama decide o que fazer
 * em vez de o painel abrir um formulario quebrado.
 */
export function dadosDoRegistro(dados: unknown): DadosContrato | null {
  const r = dadosContratoSchema.safeParse(dados);
  return r.success ? r.data : null;
}

// -------------------------------------------------------------- extracao --

/** Valor extraido que vale a pena copiar: texto nao vazio depois de aparar. */
function preenchido(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

type Contador = { n: number };

function copiar<T extends Record<string, string>>(
  destino: T,
  origem: Partial<Record<keyof T, string>>,
  campos: readonly (keyof T)[],
  normalizar: Partial<Record<keyof T, (v: string) => string>>,
  contador: Contador,
): T {
  const saida = { ...destino };
  for (const campo of campos) {
    const v = origem[campo];
    if (!preenchido(v)) continue;
    const norm = normalizar[campo] ? normalizar[campo]!(v) : v.trim();
    if (!norm) continue;
    saida[campo] = norm as T[typeof campo];
    contador.n += 1;
  }
  return saida;
}

const CAMPOS_ENDERECO: readonly (keyof Endereco)[] = [
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "cep",
];

const NORMALIZAR_ENDERECO: Partial<Record<keyof Endereco, (v: string) => string>> = {
  uf: (v) => v.trim().toUpperCase().slice(0, 2),
  cep: (v) => somenteDigitos(v).slice(0, 8),
};

/**
 * Junta nos campos o que a IA extraiu do texto colado: so o que veio
 * PREENCHIDO sobrescreve. Campo que a IA deixou vazio nao apaga o que a Mel ja
 * tinha digitado.
 *
 * - O tratamento (genero) nunca vem da IA -- se vier, e ignorado. E a Mel quem
 *   decide a concordancia do contrato.
 * - Vira pessoa JURIDICA so se a IA achou razao social ou CNPJ. O contrario
 *   (voltar para PF) nunca acontece aqui: no corporativo, o texto colado pode
 *   trazer so os dados de quem assina pela empresa.
 * - CPF, CNPJ e CEP ficam so com os caracteres que o sistema guarda; e-mail em
 *   minusculas.
 *
 * Devolve tambem quantos campos foram preenchidos, para o painel dizer o que
 * aconteceu em vez de "pronto".
 */
export function mesclarContratante(
  atual: Contratante,
  extraidoBruto: unknown,
): { contratante: Contratante; preenchidos: number } {
  const parse = contratanteSchema.safeParse(extraidoBruto);
  if (!parse.success) return { contratante: atual, preenchidos: 0 };
  const ex = parse.data;
  const n: Contador = { n: 0 };

  const pf = {
    ...copiar(
      {
        nome: atual.pf.nome,
        nacionalidade: atual.pf.nacionalidade,
        cpf: atual.pf.cpf,
        email: atual.pf.email,
        telefone: atual.pf.telefone,
      },
      ex.pf,
      ["nome", "nacionalidade", "cpf", "email", "telefone"],
      { cpf: (v) => limparCpf(v).slice(0, 11), email: normalizarEmail },
      n,
    ),
    genero: atual.pf.genero,
    endereco: copiar(atual.pf.endereco, ex.pf.endereco, CAMPOS_ENDERECO, NORMALIZAR_ENDERECO, n),
  };

  const rep = atual.pj.representante;
  const pj = {
    ...copiar(
      { razaoSocial: atual.pj.razaoSocial, cnpj: atual.pj.cnpj },
      ex.pj,
      ["razaoSocial", "cnpj"],
      { cnpj: (v) => limparCnpj(v).slice(0, 14) },
      n,
    ),
    endereco: copiar(atual.pj.endereco, ex.pj.endereco, CAMPOS_ENDERECO, NORMALIZAR_ENDERECO, n),
    representante: {
      ...copiar(
        { nome: rep.nome, cpf: rep.cpf, cargo: rep.cargo, email: rep.email, telefone: rep.telefone },
        ex.pj.representante,
        ["nome", "cpf", "cargo", "email", "telefone"],
        { cpf: (v) => limparCpf(v).slice(0, 11), email: normalizarEmail },
        n,
      ),
      genero: rep.genero,
    },
  };

  const vinculo = preenchido(ex.vinculo) ? ex.vinculo.trim().toLowerCase() : atual.vinculo;
  if (preenchido(ex.vinculo)) n.n += 1;

  const achouEmpresa = preenchido(ex.pj.razaoSocial) || preenchido(ex.pj.cnpj);

  return {
    contratante: { tipo: achouEmpresa ? "pj" : atual.tipo, pf, pj, vinculo },
    preenchidos: n.n,
  };
}

// ------------------------------------------------------ texto desatualizado --

/**
 * O texto salvo ainda corresponde aos dados na tela?
 *
 * Remonta o contrato a partir dos dados ATUAIS (os mesmos `montarContrato` que
 * a rota usa) e compara com o salvo. Se a Mel trocou o valor, o CPF ou a data
 * depois de gerar o texto, o PDF sairia com o numero antigo -- e o botao do PDF
 * trava ate ela gerar o texto de novo.
 *
 * Fica de fora da comparacao, de proposito:
 * - clausula que a Mel editou a mao, ou que a IA escreveu: nao ha como
 *   reproduzi-las, e editar e ela assumir o texto;
 * - clausula que existe nos dados mas nao no texto salvo: pode ter sido
 *   removida pela Mel no editor, e isso nao e texto velho.
 *
 * Clausula do modelo que esta no texto salvo e que os dados de hoje nao gerariam
 * mais (desmarcou o buffet, tirou o ultimo adicional) conta como desatualizado.
 * Dados incompletos (a montagem recusa) tambem: o texto salvo descreve dados
 * que nao existem mais.
 */
export function textoDesatualizado(
  documento: DocumentoContrato | null,
  dados: DadosContrato,
  ctx: ContextoMontagem | null,
): boolean {
  if (!documento || !ctx) return false;

  let novo: DocumentoContrato;
  try {
    novo = montarContrato(dados, ctx).documento;
  } catch {
    return true;
  }

  if (chaveEstavel(novo.partes) !== chaveEstavel(documento.partes)) return true;
  if (chaveEstavel(novo.assinaturas) !== chaveEstavel(documento.assinaturas)) return true;

  const geradas = new Map(novo.clausulas.map((c) => [c.id, c]));
  for (const salva of documento.clausulas) {
    if (salva.origem !== "padrao" || !ehClausulaDoModelo(salva.id)) continue;
    const gerada = geradas.get(salva.id);
    if (!gerada) return true;
    if (chaveEstavel(gerada.paragrafos) !== chaveEstavel(salva.paragrafos)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ avisos --

/**
 * Os avisos que o painel mostra.
 *
 * - Sem texto gerado, ou com o texto velho em relacao aos dados: os avisos do
 *   SISTEMA calculados ao vivo sobre o que esta na tela. E o que ajuda
 *   enquanto a Mel preenche ("inclua o noivo como anuente"); os avisos salvos
 *   descreveriam dados que ja mudaram.
 * - Com o texto em dia: os avisos salvos com ele (sistema + revisao da IA), que
 *   sao os que valem para aquele texto.
 */
export function avisosParaExibir(opcoes: {
  documento: DocumentoContrato | null;
  avisosSalvos: readonly Aviso[];
  dados: DadosContrato;
  ctx: ContextoMontagem | null;
  desatualizado: boolean;
}): Aviso[] {
  const { documento, avisosSalvos, dados, ctx, desatualizado } = opcoes;
  if (documento && !desatualizado) return [...avisosSalvos];
  if (!ctx) return avisosSalvos.filter((a) => a.origem === "sistema");
  return avisosDeterministicos(dados, ctx);
}

// ------------------------------------------------------------- adicionais --

/**
 * A unidade de cobranca de um adicional ja incluido. E a MESMA funcao da
 * montagem, e nao uma copia: o painel rotula "Valor por hora" e abre o campo
 * de horas exatamente onde o contrato vai dizer "N horas ... por hora". Com
 * uma copia, o "Storymaker adicional (hora)" do infantil, que continua na
 * lista quando a idade muda e a arte vira a do adulto, saia do painel sem
 * campo de horas enquanto o contrato seguia cobrando por hora.
 */
export function unidadeDoAdicional(
  templateId: TemplateId | null,
  a: Pick<Adicional, "id" | "tipo">,
): "hora" | "unidade" | null {
  return unidadeNaMontagem(a, templateId ?? undefined);
}

/**
 * O adicional tem QUANTIDADE para a Mel mexer? So o que se cobra por hora ou
 * por unidade, e o "outro servico" (dois videos, tres albuns). Making of,
 * locomocao, Polaroid e tempo real sao um item so: o campo de quantidade ali
 * so abriria espaco para um "2" por engano dobrar o preco.
 */
export function temQuantidade(templateId: TemplateId | null, a: Pick<Adicional, "id" | "tipo">): boolean {
  return a.tipo === "outro" || unidadeDoAdicional(templateId, a) !== null;
}

// --------------------------------------------------------------- editor --

/**
 * O texto da caixa de edicao de uma clausula em paragrafos: separados por
 * linha em branco; quebra de linha simples vira espaco, porque o PDF justifica
 * o paragrafo inteiro e um "\n" no meio viraria um buraco na linha.
 */
export function paragrafosDoTexto(texto: string): string[] {
  return (texto ?? "")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/\s*\n\s*/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

// ------------------------------------------------------- origem do aviso --

/**
 * Prefixo dos avisos que a REDACAO da IA grava (o que ficou fora da clausula
 * de condicoes especiais). O mesmo texto de `PREFIXO_NAO_INCORPORADO` em
 * `app/api/admin/leads/[id]/contrato/_comum.ts` -- que e server-only e nao
 * pode ser importado aqui; o teste confere que os dois continuam iguais.
 */
export const PREFIXO_NAO_INCORPORADO = "Observação que ficou fora do texto: ";

export type OrigemExibida = "sistema" | "redacao_ia" | "revisao_ia";

/** Como o painel rotula cada origem. */
export const ROTULO_ORIGEM_AVISO: Record<OrigemExibida, string> = {
  sistema: "Sistema",
  redacao_ia: "Redação da IA",
  revisao_ia: "Revisão da IA",
};

/**
 * De onde o aviso veio, para o rotulo. Os dois tipos de aviso da IA tem
 * `origem: "ia"`, mas dizem coisas opostas: a REVISAO aponta um problema NA
 * clausula citada; a REDACAO avisa o que NAO entrou nela (e em que secao do
 * formulario resolver). Rotular os dois como "Revisão da IA" -- e linkar a
 * clausula de condicoes especiais -- levava a Mel ao lugar errado.
 */
export function origemDoAviso(aviso: Pick<Aviso, "origem" | "texto">): OrigemExibida {
  if (aviso.origem !== "ia") return "sistema";
  return aviso.texto.startsWith(PREFIXO_NAO_INCORPORADO) ? "redacao_ia" : "revisao_ia";
}

// ------------------------------------------------------------ cronometro --

/**
 * Chave do cronometro do progresso: muda quando muda o TEXTO, e nao so quando
 * o progresso aparece ou some. "Gerar texto" passa da redacao direto para a
 * revisao, sem o progresso virar null no meio; com a chave antiga (ligado ou
 * desligado), a revisao ja abria marcando o tempo gasto na redacao.
 */
export function chaveDoCronometro(progresso: { lugar: string; texto: string } | null): string | null {
  return progresso ? `${progresso.lugar}\n${progresso.texto}` : null;
}

// ------------------------------------------------------- sair da pagina --

/**
 * O clique neste link tira a Mel da pagina DENTRO do app (navegacao do App
 * Router, que nao dispara `beforeunload`)? So esses pedem a confirmacao de
 * "alteracoes nao salvas" pelo painel:
 * - link para outra origem, ou fora de http(s), sai da pagina de verdade e o
 *   `beforeunload` ja pergunta (ou nem sai: mailto, tel);
 * - nova aba (target, Ctrl/Cmd/Shift, botao do meio) e download nao saem;
 * - ancora na propria pagina (#...) nao sai.
 */
export function linkSaiDaPagina(opcoes: {
  href: string | null;
  target: string | null;
  download: boolean;
  /** `location.href` de agora. */
  atual: string;
  /** `MouseEvent.button`: 0 e o principal. */
  botao: number;
  /** Ctrl, Cmd, Shift ou Alt apertado. */
  modificador: boolean;
}): boolean {
  const { href, target, download, atual, botao, modificador } = opcoes;
  if (!href || download || botao !== 0 || modificador) return false;
  if (target && target !== "_self") return false;
  let destino: URL;
  let aqui: URL;
  try {
    aqui = new URL(atual);
    destino = new URL(href, aqui);
  } catch {
    return false;
  }
  if (destino.protocol !== "http:" && destino.protocol !== "https:") return false;
  if (destino.origin !== aqui.origin) return false;
  return destino.pathname !== aqui.pathname || destino.search !== aqui.search;
}

// ------------------------------------------------------------- assinatura --

/**
 * Por que a secao nao deixa enviar para assinatura agora (null = pode).
 *
 * Dados SUJOS tambem bloqueiam: a lista de quem recebe o link vem do texto
 * salvo, e o servidor confere com os dados salvos. Uma correcao de e-mail
 * ainda nao salva passaria nas duas conferencias e o link iria para o e-mail
 * antigo -- errado, possivelmente de um estranho.
 */
export function bloqueioDoEnvio(opcoes: {
  editandoClausula: boolean;
  desatualizado: boolean;
  sujo: boolean;
}): string | null {
  if (opcoes.editandoClausula) return "Salve ou cancele a cláusula que você está editando.";
  if (opcoes.desatualizado) {
    return "Os dados mudaram depois do texto: gere o texto e o PDF de novo antes de enviar.";
  }
  if (opcoes.sujo) {
    return "Há alterações não salvas nos dados do contrato: salve o rascunho (e, se o texto mudar, gere o texto e o PDF de novo) antes de enviar.";
  }
  return null;
}

/**
 * O motivo para o envio ficar travado (null = pode). Vale para os DOIS
 * botoes: "Enviar para assinatura" e o "Confirmar envio" da confirmacao, que
 * fecha sozinha quando aparece um motivo.
 */
export function motivoSemEnvio(opcoes: {
  assinaturaConfigurada: boolean;
  bloqueioEnvio: string | null;
  /** Os e-mails invalidos, pelo rotulo de quem assina. */
  rotulosComEmailInvalido: readonly string[];
}): string | null {
  if (!opcoes.assinaturaConfigurada) {
    return "A assinatura eletrônica não está configurada neste ambiente (falta a chave da iLoveAPI).";
  }
  if (opcoes.bloqueioEnvio) return opcoes.bloqueioEnvio;
  if (opcoes.rotulosComEmailInvalido.length > 0) {
    return `Confira o e-mail de: ${opcoes.rotulosComEmailInvalido.join(", ")}.`;
  }
  return null;
}

/**
 * O recado sobre o envio anterior, de volta em "PDF gerado".
 *
 * Cancelado e quase sempre a propria Mel que cancelou: tom neutro, sem
 * "corrija" -- o ambar de erro ficava para sempre depois de um cancelamento de
 * proposito. Ambar so para o que pede acao: recusado e expirado.
 */
export function avisoDoUltimoEnvio(
  status: StatusAssinatura | null | undefined,
): { tom: "info" | "atencao"; texto: string } | null {
  switch (status) {
    case "cancelado":
      return { tom: "info", texto: "Envio anterior cancelado." };
    case "recusado":
      return {
        tom: "atencao",
        texto: "O último envio foi recusado por uma das pessoas. Corrija o que for preciso e envie de novo.",
      };
    case "expirado":
      return {
        tom: "atencao",
        texto: "O último envio expirou antes de todos assinarem. Confira os dados e envie de novo.",
      };
    default:
      return null;
  }
}

/**
 * O recado quando "Atualizar status" (ou a consulta sozinha ao abrir a
 * pagina) falha.
 *
 * Na consulta silenciosa, um erro passageiro vira a frase generica de "tente
 * de novo". Mas o pedido que SUMIU da plataforma (ou o token ilegivel) nao
 * passa tentando de novo: a saida e o "Cancelar envio", e so a frase do
 * servidor diz isso. Escondida atras da generica, a Mel tocaria em "Atualizar
 * status" para sempre sem descobrir a saida.
 */
export function textoDaConsultaQueFalhou(opcoes: {
  silencioso: boolean;
  erro: string;
  pedidoInexistente?: boolean;
}): string {
  if (opcoes.silencioso && !opcoes.pedidoInexistente) {
    return "Não consegui atualizar o status da assinatura agora. Toque em “Atualizar status” para tentar de novo.";
  }
  return opcoes.erro;
}

/**
 * O recado depois de "Cancelar envio" que deu certo (200).
 *
 * Quando o envio nao existia mais na plataforma, ou o token nao se lia, ele
 * foi encerrado SO no sistema, e o servidor manda um `aviso` proprio (no caso
 * do token, conferir no painel da iLoveAPI se o pedido antigo nao ficou
 * aberto). Trocar esse aviso pelo "Envio cancelado" de sempre esconderia
 * justamente o que a Mel precisa fazer antes de enviar de novo.
 */
export function recadoDoCancelamento(resposta: {
  registro?: { status?: string } | null;
  pedidoInexistente?: unknown;
  aviso?: unknown;
}): { tom: "ok" | "atencao"; texto: string } {
  if (resposta.registro?.status === "assinado") {
    return { tom: "ok", texto: "Não deu para cancelar: todos já tinham assinado. O contrato assinado foi guardado." };
  }
  if (resposta.pedidoInexistente === true && typeof resposta.aviso === "string" && resposta.aviso.trim()) {
    return { tom: "atencao", texto: resposta.aviso };
  }
  return { tom: "ok", texto: "Envio cancelado. O texto está destravado." };
}

// ------------------------------------------------------------- formulario --

/**
 * O formulario de dados fica recolhido num <details>?
 *
 * - Texto travado (na assinatura ou assinado): recolhido, so para ler.
 * - PDF gerado: recolhido tambem. Nessa hora a Mel quer conferir o PDF e
 *   enviar, e o formulario aberto sao milhares de pixels no celular entre ela
 *   e a Assinatura. Abre sozinho quando ha alteracao nao salva ou pendencia de
 *   campo: esconder o que precisa de atencao seria pior que rolar.
 * - Antes do PDF: aberto, e o lugar de trabalho.
 */
export function recolhimentoDoFormulario(opcoes: {
  travado: boolean;
  temPdf: boolean;
  sujo: boolean;
  pendencias: boolean;
}): { recolhido: false } | { recolhido: true; resumo: string; abrir: boolean } {
  if (opcoes.travado) return { recolhido: true, resumo: "Ver os dados do contrato", abrir: false };
  if (opcoes.temPdf) {
    return {
      recolhido: true,
      resumo: "Ver e editar os dados do contrato",
      abrir: opcoes.sujo || opcoes.pendencias,
    };
  }
  return { recolhido: false };
}

// ---------------------------------------------------------------- editor --

/**
 * Onde mostrar o "Texto salvo." depois de REMOVER uma clausula: na que ficou
 * no lugar dela (a seguinte), ou na anterior se era a ultima. `null` so se
 * nao sobrou nenhuma.
 */
export function vizinhaDaRemovida(clausulas: readonly { id: string }[], id: string): string | null {
  const i = clausulas.findIndex((c) => c.id === id);
  if (i < 0) return null;
  return clausulas[i + 1]?.id ?? clausulas[i - 1]?.id ?? null;
}
