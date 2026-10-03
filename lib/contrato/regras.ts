// Regras de negocio do contrato que dependem do LEAD: evento de menor, idade
// do homenageado, pre-preenchimento a partir das respostas do formulario e os
// rotulos de status para o painel.
//
// Sem "server-only": o painel decide o que mostrar (campo "vínculo", aviso de
// anuente) com as mesmas regras que a montagem aplica.

import { ehADefinir, type Categoria, type Lead, type Respostas, type TemplateId } from "@/lib/form/types";
import { resolverTemplateId } from "@/lib/form/engine";
import { nomeContato, sujeitoDoEvento } from "@/lib/leads";
import { resolverTabelaPreco, TABELA_BASE } from "@/lib/pdf/precos";
import {
  dadosContratoSchema,
  type DadosContrato,
  type Local,
  type SignatarioStatus,
  type StatusAssinatura,
  type StatusContrato,
} from "@/lib/contrato/tipos";
import { adicionalDoCatalogo, novoAdicional, pacoteDoCatalogo, precoPacote } from "@/lib/contrato/catalogo";
import { normalizarEmail } from "@/lib/contrato/documento";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import { normalizarComparacao } from "@/lib/contrato/texto";

/** Maioridade civil (CC art. 5º). Abaixo disso, quem contrata e o responsavel. */
export const MAIORIDADE = 18;

// ------------------------------------------------------------ homenageado --

/**
 * Idade de quem o evento homenageia: 15 na debutante, a resposta `idade` no
 * aniversario, `null` quando nao se aplica (casamento, corporativo) ou quando
 * a idade nao foi respondida.
 */
export function idadeHomenageado(categoria: Categoria, respostas: Respostas): number | null {
  if (categoria === "debutante") return 15;
  if (categoria !== "aniversario") return null;

  const bruto = (respostas?.idade ?? "").trim();
  if (!/^\d+$/.test(bruto)) return null;
  return Number.parseInt(bruto, 10);
}

/**
 * O evento e de MENOR de idade? Decide a qualificacao ("na qualidade de mãe
 * de..."), a autorizacao de imagem do menor e a clausula que proibe publicar
 * o que permita localiza-lo.
 *
 * - debutante: sempre;
 * - aniversario: idade < 18. Idade AUSENTE conta como menor, por seguranca:
 *   tratar um menor como adulto tira dele a protecao do contrato, o contrario
 *   so acrescenta uma assinatura. (A montagem avisa a Mel.)
 * - casamento e corporativo: nunca.
 *
 * NUNCA derivar do `TemplateId`: a arte "aniversario_adulto" comeca aos 15, e
 * um aniversariante de 16 e adulto para a arte mas menor para o contrato.
 */
export function ehEventoDeMenor(categoria: Categoria, respostasOuIdade: Respostas | number | null): boolean {
  switch (categoria) {
    case "debutante":
      return true;
    case "casamento":
    case "corporativo":
      return false;
    case "aniversario": {
      const idade =
        typeof respostasOuIdade === "number"
          ? Number.isFinite(respostasOuIdade)
            ? respostasOuIdade
            : null
          : respostasOuIdade === null
            ? null
            : idadeHomenageado(categoria, respostasOuIdade);
      return idade === null || idade < MAIORIDADE;
    }
  }
}

/** A arte do lead (para o catalogo). `null` no aniversario sem idade: nunca se chuta a arte. */
export function templateDoLead(lead: Pick<Lead, "categoria" | "respostas">): TemplateId | null {
  return resolverTemplateId(lead.categoria, lead.respostas ?? {});
}

/**
 * O que a montagem precisa saber do lead alem dos dados do contrato.
 *
 * `templateId` pode ser `null` (aniversario sem idade). A montagem exige a
 * arte, entao quem chama decide: e o caso de pedir a idade a Mel, nao de
 * escolher uma arte padrao.
 */
export type ContextoLead = {
  categoria: Categoria;
  templateId: TemplateId | null;
  idadeHomenageado: number | null;
  hojeISO: string;
  /** "Em tempo real" / "Em até 1 semana" / "" -- para avisar se o contrato nao entrega o que o lead pediu. */
  entregaSolicitada: string;
};

export function contextoDoLead(lead: Pick<Lead, "categoria" | "respostas">, hojeISO: string): ContextoLead {
  const respostas = lead.respostas ?? {};
  return {
    categoria: lead.categoria,
    templateId: templateDoLead(lead),
    idadeHomenageado: idadeHomenageado(lead.categoria, respostas),
    hojeISO,
    entregaSolicitada: (respostas.entrega ?? "").trim(),
  };
}

/**
 * "Hoje" em America/Sao_Paulo, em ISO ("2026-09-29").
 *
 * Calculado no SERVIDOR e passado adiante (para a pagina e para a montagem):
 * o servidor da Vercel roda em UTC, e depois das 21h de Brasilia um
 * `toISOString()` ja seria amanha -- o que faria uma parcela que vence hoje
 * parecer vencida.
 */
export function hojeEmSaoPaulo(agora: Date | number): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof agora === "number" ? new Date(agora) : agora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

// ---------------------------------------------------------- listas do painel --

/** Rotulos de local que o painel oferece (mais "Outro", digitado). */
export const ROTULOS_LOCAL = [
  "Local do evento",
  "Local da cerimônia",
  "Local da recepção",
  "Local da cerimônia e recepção",
] as const;

/** Vinculos mais comuns com o homenageado menor (mais "outro", digitado). */
export const VINCULOS_MENOR = ["mãe", "pai", "responsável legal"] as const;

// ------------------------------------------------------- pre-preenchimento --

/**
 * Resposta do lead como texto do contrato: aparada e dentro do limite do schema.
 *
 * "A definir" (a caixa "decidir depois" do formulario) vira VAZIO: o contrato
 * continua acusando o horario e o local como faltando, e quem confirma com o
 * cliente e a Mel. Passado adiante, o marcador entraria como endereco valido
 * ("Local da cerimônia: A definir") e, no horario, viraria "horário inválido".
 */
function campo(v: string | null | undefined): string {
  const texto = (v ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
  return ehADefinir(texto) ? "" : texto;
}

/**
 * "Mesmo local", "no mesmo lugar", "idem": o lead dizendo que a festa e onde
 * foi a cerimonia, em vez de repetir o nome.
 */
function ehMesmoLugar(cerimonia: string, festa: string): boolean {
  const c = normalizarComparacao(cerimonia);
  const f = normalizarComparacao(festa);
  if (!f) return false;
  if (c && c === f) return true;
  return /^(e |no |na |o |a )?(mesmo|mesma)\b/.test(f) || /^(idem|igual)\b/.test(f);
}

function locaisDoLead(categoria: Categoria, r: Respostas): Local[] {
  if (categoria !== "casamento") {
    return [{ rotulo: "Local do evento", endereco: campo(r.local) }];
  }
  const cerimonia = campo(r.local_cerimonia);
  const festa = campo(r.local_festa);
  if (ehMesmoLugar(cerimonia, festa)) {
    return [{ rotulo: "Local da cerimônia e recepção", endereco: cerimonia || festa }];
  }
  // Duas linhas mesmo com uma vazia: a linha vazia e o que mostra a Mel que
  // falta um endereco, e a montagem acusa a falta.
  return [
    { rotulo: "Local da cerimônia", endereco: cerimonia },
    { rotulo: "Local da recepção", endereco: festa },
  ];
}

/** Casamento: "Ana & João" vira "Ana e João" -- o "&" e da arte, nao do contrato. */
function homenageadoDoLead(categoria: Categoria, r: Respostas): string {
  const sujeito = campo(sujeitoDoEvento(categoria, r));
  return categoria === "casamento" ? sujeito.replace(/\s*&\s*/g, " e ") : sujeito;
}

/**
 * Casamento e a unica arte em que o formulario ja diz o pacote: "Em tempo real"
 * so existe no Real Time. Nas outras, a entrega pedida nao escolhe pacote
 * (debutante e aniversario tem tempo real como adicional), e a Mel escolhe.
 */
function pacoteDoLead(categoria: Categoria, r: Respostas): string {
  if (categoria !== "casamento") return "";
  const entrega = campo(r.entrega);
  if (entrega === "Em tempo real") return "Pacote Real Time";
  if (entrega === "Em até 1 semana") return "Pacote Principal";
  return "";
}

/**
 * O contrato pre-preenchido a partir do lead. Tudo aqui e SUGESTAO: a Mel
 * confirma no painel antes de gerar.
 *
 * - Quem assina: e-mail e telefone de contato do formulario. O NOME so vem
 *   pre-preenchido se o evento nao for de menor -- `respostas.nome` e quem
 *   preencheu, e no 15 anos pode ter sido a propria debutante; quem assina e
 *   o responsavel, e e a Mel que confirma quem e. Corporativo nasce como
 *   pessoa juridica, com a razao social = nome da empresa informado.
 * - Evento: data, horario do convite como inicio da cobertura, homenageado,
 *   locais (no casamento, um local so quando cerimonia e festa sao o mesmo
 *   lugar) e o local do making of quando o lead pediu making of.
 * - Servico: tabela pelo ANO DO EVENTO; pacote so no casamento (pela entrega
 *   pedida), com o escopo e o preco da tabela; making of da noiva pre-marcado
 *   quando o casal pediu making of.
 * - Pagamento: 30% de sinal na assinatura + 70% ate 10 dias antes.
 *
 * `hojeISO` so entra quando a data do evento falta: a tabela sai do ano de
 * hoje, e nao da tabela base -- a base ficaria cada ano mais defasada.
 */
export function dadosIniciais(lead: Lead, hojeISO: string): DadosContrato {
  const r = lead.respostas ?? {};
  const categoria = lead.categoria;
  const templateId = templateDoLead(lead);
  const menor = ehEventoDeMenor(categoria, r);

  const email = normalizarEmail(campo(r.contato_email) || campo(lead.email));
  const telefone = campo(r.contato_whatsapp) || campo(lead.whatsapp);
  const data = campo(r.data) || campo(lead.data_evento);

  const tabela = resolverTabelaPreco(data) ?? resolverTabelaPreco(hojeISO) ?? TABELA_BASE;
  const pacote = templateId ? pacoteDoLead(categoria, r) : "";
  const doCatalogo = templateId && pacote ? pacoteDoCatalogo(templateId, pacote) : null;

  const querMakingOf = campo(r.making_of) === "Sim";
  const makingOfNoiva =
    categoria === "casamento" && querMakingOf && templateId
      ? adicionalDoCatalogo(templateId, "casamento.making_of_noiva")
      : null;

  return dadosContratoSchema.parse({
    versao: 1,
    contratante: {
      tipo: categoria === "corporativo" ? "pj" : "pf",
      pf: {
        nome: menor ? "" : campo(nomeContato(r)),
        email,
        telefone,
      },
      pj: {
        razaoSocial: categoria === "corporativo" ? campo(r.empresa) : "",
        representante: { email, telefone },
      },
      vinculo: "",
    },
    anuente: { ativo: false },
    evento: {
      data,
      horarioInicio: campo(r.horario),
      homenageado: homenageadoDoLead(categoria, r),
      tipoEvento: categoria === "corporativo" ? campo(r.tipo_evento) : "",
      locais: locaisDoLead(categoria, r),
      makingOfLocal: querMakingOf ? campo(r.local_making_of) : "",
      makingOfHorario: "",
      alimentacao: true,
    },
    servico: {
      tabela,
      pacote: doCatalogo ? doCatalogo.nome : "",
      valorPacote: doCatalogo && templateId ? (precoPacote(templateId, tabela, doCatalogo.nome) ?? 0) : 0,
      ...(doCatalogo ? { escopo: doCatalogo.escopo } : {}),
      adicionais: makingOfNoiva ? [novoAdicional(makingOfNoiva, pacote, tabela)] : [],
      desconto: 0,
    },
    pagamento: pagamentoDoPreset("30/70"),
    observacoes: "",
  });
}

// ---------------------------------------------------------------- rotulos --

export const ROTULO_STATUS_CONTRATO: Record<StatusContrato, string> = {
  rascunho: "Rascunho",
  redigido: "Texto pronto",
  pdf_gerado: "PDF gerado",
  enviado: "Aguardando assinaturas",
  assinado: "Assinado",
};

export const ROTULO_STATUS_ASSINATURA: Record<StatusAssinatura, string> = {
  enviado: "Enviado para assinatura",
  concluido: "Assinado por todos",
  recusado: "Recusado",
  expirado: "Expirou",
  cancelado: "Cancelado",
};

/** Status de cada signatario na lista do painel. */
export const ROTULO_STATUS_SIGNATARIO: Record<SignatarioStatus["status"], string> = {
  pendente: "Pendente",
  assinou: "Assinou",
  recusou: "Recusou",
};
