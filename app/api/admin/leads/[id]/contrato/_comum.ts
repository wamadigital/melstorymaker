import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerComRetentativa } from "@/lib/supabase/consulta";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { ErroBancoContrato, type PatchContrato } from "@/lib/supabase/contratos";
import { CamposFaltandoContratoError, type ContextoMontagem } from "@/lib/contrato/montar";
import { MarcacaoInvalidaError, ReferenciaInvalidaError } from "@/lib/contrato/marcacao";
import { contextoDoLead, hojeEmSaoPaulo } from "@/lib/contrato/regras";
import { STATUS_CONTRATO, textoTravado, type Aviso, type StatusContrato } from "@/lib/contrato/tipos";
import type { Categoria, Respostas } from "@/lib/form/types";

// O que as rotas do contrato tem em comum: portaria (sessao + id), leitura do
// lead, contexto da montagem, trava do texto e a traducao de erro para texto
// humano. Nao e rota (o Next so trata `route.ts` como rota); o "_" no nome e
// so para quem abre a pasta.
//
// Regra que atravessa todas: erro de upstream (Supabase, IA, plataforma de
// assinatura) NUNCA vai cru para a tela. A mensagem tecnica fica no log, com o
// id do lead e um codigo -- jamais com CPF, e-mail, endereco ou o payload -- e
// a Mel le uma frase que ela consegue resolver ou repetir.

export type Ctx = { params: Promise<{ id: string }> };

/**
 * Recusa com texto para a tela. Pode ser lancada de qualquer ponto de uma rota:
 * `rotaDoContrato` a transforma na resposta, com `extra` (ex.: `campos`) junto.
 */
export class Recusa extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = "Recusa";
  }
}

/**
 * JSON com `Cache-Control: private, no-store`. O contrato e PII: nenhuma
 * resposta daqui pode ficar em cache de navegador ou de proxy.
 */
export function responder(corpo: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "private, no-store" } });
}

const uuid = z.string().uuid();

type Manipulador = (req: Request, id: string) => Promise<Response>;

/**
 * Envolve o manipulador de uma rota do contrato com a portaria e a traducao
 * de erros. `etapa` so aparece no log ("[contrato] <id> pdf: ...").
 *
 * A sessao e conferida aqui mesmo que o middleware ja confira, pelo mesmo
 * motivo das outras rotas do admin: se o matcher mudar um dia, a rota nao
 * fica aberta em silencio.
 */
export function rotaDoContrato(etapa: string, manipulador: Manipulador) {
  return async (req: Request, { params }: Ctx): Promise<Response> => {
    if (!(await getSessaoAdmin())) {
      return responder({ erro: "Sessão expirada." }, 401);
    }
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return responder({ erro: "Lead não encontrado." }, 404);
    }
    try {
      return await manipulador(req, id);
    } catch (e) {
      return traduzirErro(e, id, etapa);
    }
  };
}

function traduzirErro(e: unknown, id: string, etapa: string): Response {
  if (e instanceof Recusa) return responder({ erro: e.message, ...e.extra }, e.status);

  // Dado faltando e coisa que a Mel resolve na tela: 422 com a lista, igual ao
  // CamposFaltandoError da proposta. A lista NAO vai para o log -- pode citar o
  // nome do homenageado.
  if (e instanceof CamposFaltandoContratoError) {
    return responder({ erro: "Faltam dados para montar o contrato.", campos: e.campos }, 422);
  }

  // Ultima rede do PDF: a validacao do documento pega isto antes, mas um
  // contrato com "Cláusula {{ref:direitos}}" nunca pode chegar a ninguem.
  if (e instanceof ReferenciaInvalidaError || e instanceof MarcacaoInvalidaError) {
    return responder({ erro: "O texto do contrato tem uma marcação que não fecha.", campos: [e.message] }, 422);
  }

  // Banco ou Storage: o detalhe tecnico ja foi logado onde o erro nasceu.
  if (e instanceof ErroBancoContrato) return responder({ erro: e.message }, 503);

  console.error(`[contrato] ${id} ${etapa}: erro inesperado`, e);
  return responder({ erro: "Não consegui concluir agora. Tente de novo em instantes." }, 500);
}

/** Corpo JSON validado pelo schema, ou 400. */
export async function lerCorpo<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new Recusa(400, "Payload inválido.");
  return parsed.data;
}

// --------------------------------------------------------------------- lead --

export type LeadDoContrato = {
  id: string;
  categoria: Categoria;
  respostas: Respostas;
  nome_display: string | null;
};

/** O lead, ou 404. Leitura com retentativa, como tudo que o painel le. */
export async function carregarLead(id: string): Promise<LeadDoContrato> {
  const { data, error } = await lerComRetentativa(`lead ${id} (contrato)`, () =>
    supabaseAdmin().from("leads").select("id, categoria, respostas, nome_display").eq("id", id).maybeSingle(),
  );
  if (error) throw new Recusa(503, "Não consegui carregar o lead agora. Tente de novo em instantes.");
  if (!data) throw new Recusa(404, "Lead não encontrado.");
  const lead = data as LeadDoContrato;
  return { ...lead, respostas: lead.respostas ?? {} };
}

/**
 * O contexto da montagem a partir do lead, com "hoje" em America/Sao_Paulo
 * calculado AQUI, no servidor (a Vercel roda em UTC; depois das 21h de
 * Brasilia um `toISOString()` ja seria amanha).
 *
 * Aniversario sem idade nao tem arte, e sem arte nao ha catalogo: 422 pedindo
 * a idade. Nunca se escolhe uma arte padrao -- mesma regra do PDF da proposta.
 */
export function contextoDeMontagem(lead: LeadDoContrato): ContextoMontagem {
  const c = contextoDoLead(lead, hojeEmSaoPaulo(Date.now()));
  if (!c.templateId) {
    throw new Recusa(
      422,
      lead.categoria === "aniversario"
        ? "Falta a idade do aniversariante: sem ela não sei qual catálogo usar (infantil ou adulto)."
        : "Não consegui identificar a arte deste lead.",
      {
        campos: [
          lead.categoria === "aniversario"
            ? "Idade do aniversariante (corrija nas respostas do lead)"
            : "Categoria do lead",
        ],
      },
    );
  }
  return {
    categoria: c.categoria,
    templateId: c.templateId,
    idadeHomenageado: c.idadeHomenageado,
    hojeISO: c.hojeISO,
    entregaSolicitada: c.entregaSolicitada,
  };
}

// -------------------------------------------------------------------- trava --

/** rascunho, redigido, pdf_gerado: os status em que o texto ainda muda. */
export const STATUS_EDITAVEIS: readonly StatusContrato[] = STATUS_CONTRATO.filter((s) => !textoTravado(s));

/**
 * Em "enviado" o PDF esta na caixa do cliente; mudar dados, texto ou PDF agora
 * faria o painel mostrar um contrato diferente do que ele esta assinando. Em
 * "assinado", o contrato e o original assinado: imutavel.
 */
export function recusarSeTravado(status: StatusContrato | null | undefined): void {
  if (status === "enviado") {
    throw new Recusa(
      409,
      "O contrato está aguardando assinaturas, e o texto fica travado enquanto isso. Cancele o envio para editar.",
    );
  }
  if (status === "assinado") {
    throw new Recusa(409, "O contrato já foi assinado e não pode mais ser alterado.");
  }
}

/** Resposta de toda escrita guardada que nao encontrou a linha no estado lido. */
export const MUDOU_NO_MEIO =
  "O contrato mudou enquanto isso (outra aba ou outro clique). Atualize a página e tente de novo.";

/**
 * Resposta da escrita guardada pelo ESTADO LIDO (`updated_at`): alguem gravou
 * no contrato entre a leitura e a escrita, e o que esta rota ia gravar foi
 * calculado sobre uma versao que nao existe mais.
 */
export const ALTERADO_EM_OUTRA_ABA = "O contrato foi alterado em outra aba. Recarregue a página.";

/** Zera o PDF do registro: o texto mudou, e o PDF gravado nao o representa mais. */
export const SEM_PDF: PatchContrato = {
  pdf_path: null,
  pdf_sha256: null,
  pdf_gerado_em: null,
  posicoes_assinatura: null,
};

// ------------------------------------------------------------------- avisos --

/**
 * Prefixo dos avisos que a REDACAO da IA gera (o que ficou fora da clausula de
 * condicoes especiais, com a instrucao do campo a usar). Tem origem "ia", e a
 * revisao substitui os avisos "ia" anteriores -- sem uma marca, a revisao que o
 * painel dispara logo depois de redigir apagaria na hora justamente o recado
 * "Parcelamento em 3x: use a seção Pagamento". O prefixo e essa marca, e de
 * quebra diz a Mel de onde o aviso veio.
 */
export const PREFIXO_NAO_INCORPORADO = "Observação que ficou fora do texto: ";

export function avisoNaoIncorporado(texto: string): Aviso {
  return {
    origem: "ia",
    gravidade: "atencao",
    clausula: "condicoes_especiais",
    texto: `${PREFIXO_NAO_INCORPORADO}${texto.trim()}`,
  };
}

export function ehAvisoNaoIncorporado(aviso: Aviso): boolean {
  return aviso.origem === "ia" && aviso.texto.startsWith(PREFIXO_NAO_INCORPORADO);
}
