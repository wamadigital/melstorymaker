import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerComRetentativa } from "@/lib/supabase/consulta";
import type {
  PosicaoAssinatura,
  RegistroContrato,
  StatusContrato,
} from "@/lib/contrato/tipos";

// Acesso a tabela `contratos` e ao bucket `contratos`. Unico lugar do sistema
// que fala com os dois: as rotas do painel nunca montam select nem caminho de
// arquivo na mao.
//
// O contrato e PII (CPF, endereco, e-mail de quem assina). Por isso:
//  - o bucket e PRIVADO e o PDF so sai pela rota admin autenticada;
//  - o log daqui leva o id do lead e a mensagem TECNICA do Supabase (que fala
//    de tabela e de caminho, nunca do conteudo), jamais o payload;
//  - o registro que o painel recebe (`RegistroContrato`) deixa de fora as
//    colunas internas -- caminho no Storage, token da plataforma de
//    assinatura e posicoes do campo de assinatura. Nenhuma delas serve para a
//    tela, e o token e o que permite consultar ou cancelar o envio.

export const BUCKET_CONTRATOS = "contratos";

// ------------------------------------------------------------------ tipos --

/** A linha inteira, com as colunas que so o servidor enxerga. */
export type RegistroContratoInterno = RegistroContrato & {
  pdf_path: string | null;
  posicoes_assinatura: PosicaoAssinatura[] | null;
  /** Opaco: "dry-<uuid>" no dry run, "{server}|{token_requester}" na iLoveAPI. */
  assinatura_token: string | null;
  assinado_path: string | null;
  trilha_path: string | null;
};

/** O que uma rota pode gravar. `lead_id` e os carimbos de criacao sao do banco. */
export type PatchContrato = Partial<Omit<RegistroContratoInterno, "lead_id" | "created_at" | "updated_at">>;

/**
 * Condicoes de uma escrita GUARDADA: o UPDATE so pega a linha se ela ainda
 * estiver no estado que a rota leu. Zero linhas = alguem chegou antes (outra
 * aba, duplo clique, o envio mudando o status no meio do caminho), e a rota
 * responde 409 em vez de sobrescrever o que nao viu -- o mesmo guard do
 * `.eq("status", atual)` da rota de status dos leads.
 */
export type CondicaoEscrita = {
  status?: readonly StatusContrato[];
  /** `null` = a linha ainda nao tem token (reserva de envio em andamento). */
  token?: string | null;
  /** O PDF gravado e exatamente este (sha256 em hex). */
  pdfSha256?: string;
  /**
   * Ninguem escreveu na linha desde a leitura: `updated_at` ainda e o que a
   * rota leu. O trigger `contratos_set_updated_at` troca o carimbo a CADA
   * update, entao isto pega qualquer escrita no meio -- inclusive as que o
   * status nao pega (o texto editado em outra aba enquanto o PDF era gerado
   * deixava o registro em "pdf_gerado" com o PDF do texto anterior).
   *
   * E o guard de quem LEU, pensou (desenhou o PDF, chamou a IA) e agora grava
   * algo que depende do que leu.
   */
  atualizadoEm?: string;
};

/** O pedaco do query builder do PostgREST que as condicoes usam. */
type FiltrosEscrita<Q> = {
  in(coluna: string, valores: readonly string[]): Q;
  is(coluna: string, valor: null): Q;
  eq(coluna: string, valor: string): Q;
};

/**
 * Traduz a condicao em filtros do UPDATE. Separado de `salvarRegistro` para o
 * teste conferir, sem banco, que cada condicao vira filtro -- uma condicao
 * esquecida aqui vira escrita sem guard, em silencio.
 */
export function aplicarCondicao<Q extends FiltrosEscrita<Q>>(q: Q, condicao: CondicaoEscrita): Q {
  let r = q;
  if (condicao.status) r = r.in("status", [...condicao.status]);
  if (condicao.token !== undefined) {
    r = condicao.token === null ? r.is("assinatura_token", null) : r.eq("assinatura_token", condicao.token);
  }
  if (condicao.pdfSha256 !== undefined) r = r.eq("pdf_sha256", condicao.pdfSha256);
  if (condicao.atualizadoEm !== undefined) r = r.eq("updated_at", condicao.atualizadoEm);
  return r;
}

/**
 * Falha do banco ou do Storage. `message` e texto HUMANO, pronto para a tela;
 * o detalhe tecnico ja foi para o log quando o erro nasceu.
 */
export class ErroBancoContrato extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroBancoContrato";
  }
}

// ----------------------------------------------------------------- colunas --

/**
 * Select EXPLICITO, coluna por coluna. Um `select("*")` aqui mandaria o token
 * da assinatura e o caminho do arquivo para o navegador na primeira coluna
 * nova que alguem acrescentasse sem pensar.
 */
const COLUNAS_PUBLICAS = [
  "lead_id",
  "created_at",
  "updated_at",
  "status",
  "dados",
  "documento",
  "avisos",
  "redigido_em",
  "revisado_em",
  "pdf_gerado_em",
  "pdf_sha256",
  "assinatura_provedor",
  "assinatura_status",
  "assinatura_signatarios",
  "assinatura_enviada_em",
  "assinatura_atualizada_em",
  "assinado_em",
] as const satisfies readonly (keyof RegistroContrato)[];

const COLUNAS_INTERNAS = [
  "pdf_path",
  "posicoes_assinatura",
  "assinatura_token",
  "assinado_path",
  "trilha_path",
] as const satisfies readonly Exclude<keyof RegistroContratoInterno, keyof RegistroContrato>[];

const SELECT_PUBLICO = COLUNAS_PUBLICAS.join(", ");
const SELECT_INTERNO = [...COLUNAS_PUBLICAS, ...COLUNAS_INTERNAS].join(", ");

type Linha = Record<string, unknown>;

function paraPublico(linha: Linha): RegistroContrato {
  const r = Object.fromEntries(COLUNAS_PUBLICAS.map((c) => [c, linha[c] ?? null])) as unknown as RegistroContrato;
  // jsonb com default no banco, mas a tela itera sobre eles: nunca `null`.
  r.avisos = Array.isArray(r.avisos) ? r.avisos : [];
  r.assinatura_signatarios = Array.isArray(r.assinatura_signatarios) ? r.assinatura_signatarios : null;
  return r;
}

function paraInterno(linha: Linha): RegistroContratoInterno {
  const r = paraPublico(linha) as RegistroContratoInterno;
  for (const c of COLUNAS_INTERNAS) (r as unknown as Linha)[c] = linha[c] ?? null;
  r.posicoes_assinatura = Array.isArray(r.posicoes_assinatura) ? r.posicoes_assinatura : null;
  return r;
}

/** So as colunas que o painel pode ver, a partir de um registro interno. */
export function registroPublico(r: RegistroContratoInterno): RegistroContrato {
  return paraPublico(r as unknown as Linha);
}

// --------------------------------------------------- banco sem o schema novo --

type ErroSupabase = { message: string; code?: string } | null;

/**
 * A tabela `contratos` ainda nao existe: o codigo foi publicado antes de
 * alguem aplicar o `supabase/schema.sql` (o runbook e manual). Nesse estado
 * nenhum contrato pode existir, entao LER responde "nenhum" em vez de derrubar
 * o detalhe do lead e a exclusao -- que funcionavam antes desta feature e
 * precisam continuar funcionando. Escrever continua falhando, com recado.
 */
function tabelaAusente(erro: ErroSupabase): boolean {
  if (!erro) return false;
  return (
    erro.code === "PGRST205" ||
    erro.code === "42P01" ||
    /could not find the table|relation .*contratos.* does not exist/i.test(erro.message)
  );
}

let avisouTabelaAusente = false;
function avisarTabelaAusente() {
  if (avisouTabelaAusente) return;
  avisouTabelaAusente = true;
  console.warn("[contrato] a tabela contratos não existe: aplique supabase/schema.sql no SQL Editor");
}

const MENSAGEM_SEM_SCHEMA =
  "Os contratos ainda não foram ativados no banco de dados (falta aplicar o supabase/schema.sql).";

/** O bucket `contratos` ainda nao foi criado (mesma situacao da tabela). */
function bucketAusente(erro: { message: string; statusCode?: string; code?: string } | null): boolean {
  if (!erro) return false;
  return erro.code === "NoSuchBucket" || /bucket not found/i.test(erro.message);
}

function naoEncontrado(erro: { message: string; status?: number; statusCode?: string; code?: string }): boolean {
  return (
    erro.status === 404 ||
    erro.statusCode === "404" ||
    erro.code === "NoSuchKey" ||
    /not found|does not exist/i.test(erro.message)
  );
}

function jaExiste(erro: { message: string; status?: number; statusCode?: string; code?: string }): boolean {
  return (
    erro.status === 409 ||
    erro.statusCode === "409" ||
    erro.code === "KeyAlreadyExists" ||
    erro.code === "ResourceAlreadyExists" ||
    /already exists|duplicate/i.test(erro.message)
  );
}

// ------------------------------------------------------------------ leitura --

/**
 * O contrato do lead, como o painel o recebe, ou `null` se ainda nao ha.
 *
 * Passa por `lerComRetentativa` (a falha "JWT issued at future" do Supabase
 * tambem acontece aqui). Erro que persiste vira `ErroBancoContrato`, com texto
 * para a tela.
 */
export async function lerRegistro(leadId: string): Promise<RegistroContrato | null> {
  const { data, error } = await lerComRetentativa(`contrato ${leadId}`, () =>
    supabaseAdmin().from("contratos").select(SELECT_PUBLICO).eq("lead_id", leadId).maybeSingle(),
  );
  if (error) {
    if (tabelaAusente(error)) {
      avisarTabelaAusente();
      return null;
    }
    throw new ErroBancoContrato("Não consegui carregar o contrato agora. Tente de novo em instantes.");
  }
  return data ? paraPublico(data as unknown as Linha) : null;
}

/** Com as colunas internas. So para rotas; nunca devolver isto ao navegador. */
export async function lerRegistroInterno(leadId: string): Promise<RegistroContratoInterno | null> {
  const { data, error } = await lerComRetentativa(`contrato interno ${leadId}`, () =>
    supabaseAdmin().from("contratos").select(SELECT_INTERNO).eq("lead_id", leadId).maybeSingle(),
  );
  if (error) {
    if (tabelaAusente(error)) {
      avisarTabelaAusente();
      return null;
    }
    throw new ErroBancoContrato("Não consegui carregar o contrato agora. Tente de novo em instantes.");
  }
  return data ? paraInterno(data as unknown as Linha) : null;
}

// ------------------------------------------------------------------ escrita --

/**
 * Grava o contrato do lead e devolve o registro publico atualizado.
 *
 * - Sem `condicao`: UPSERT por `lead_id` (cria o registro se nao existe).
 *   So as colunas presentes em `patch` sao escritas.
 * - Com `condicao`: UPDATE guardado. Devolve `null` quando a linha nao estava
 *   mais no estado esperado -- a rota decide o 409.
 *
 * Sem retentativa, de proposito: repetir escrita pode duplicar efeito.
 */
export async function salvarRegistro(
  leadId: string,
  patch: PatchContrato,
  condicao?: CondicaoEscrita,
): Promise<RegistroContrato | null> {
  const tabela = supabaseAdmin().from("contratos");

  let resultado: { data: unknown; error: ErroSupabase };
  if (!condicao) {
    resultado = await tabela
      .upsert({ lead_id: leadId, ...patch }, { onConflict: "lead_id" })
      .select(SELECT_PUBLICO)
      .single();
  } else {
    const q = aplicarCondicao(tabela.update(patch).eq("lead_id", leadId), condicao);
    resultado = await q.select(SELECT_PUBLICO).maybeSingle();
  }

  if (resultado.error) {
    console.error(
      `[contrato] ${leadId}: falha ao gravar (${resultado.error.code ?? "sem código"}) ${resultado.error.message}`,
    );
    if (tabelaAusente(resultado.error)) throw new ErroBancoContrato(MENSAGEM_SEM_SCHEMA);
    throw new ErroBancoContrato("Não consegui salvar o contrato agora. Tente de novo em instantes.");
  }
  return resultado.data ? paraPublico(resultado.data as Linha) : null;
}

// ------------------------------------------------------------------ Storage --

/** Tudo do contrato de um lead mora sob `{leadId}/`: apagar o lead e apagar a pasta. */
export function caminhoRascunho(leadId: string): string {
  return `${leadId}/contrato.pdf`;
}

/**
 * O token nao entra cru no caminho: o da iLoveAPI e "{server}|{token_requester}",
 * e o Storage do Supabase recusa "|" em nome de objeto. Um resumo do token e
 * estavel (o mesmo envio cai sempre no mesmo arquivo, e e isso que torna o
 * download idempotente) e so tem caracteres seguros.
 */
function marcaDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

/** PDF assinado de um envio. Nunca sobrescrito: e o original do contrato. */
export function caminhoAssinado(leadId: string, token: string): string {
  return `${leadId}/assinado-${marcaDoToken(token)}.pdf`;
}

/** Trilha de auditoria (registro de assinaturas) do mesmo envio. Tambem imutavel. */
export function caminhoTrilha(leadId: string, token: string): string {
  return `${leadId}/trilha-${marcaDoToken(token)}.pdf`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Grava um PDF no bucket privado.
 *
 * `substituir: true` e so para o rascunho (regerar o PDF sobrescreve o mesmo
 * objeto). Assinado e trilha vao com `false`: se o objeto ja existe, e porque
 * uma consulta anterior ja o guardou -- responde "ja_existia" e segue, sem
 * tocar no arquivo. E o que torna a consulta repetivel sem nunca reescrever
 * um contrato assinado.
 */
export async function guardarPdf(
  caminho: string,
  bytes: Uint8Array,
  opcoes: { substituir: boolean },
): Promise<"gravado" | "ja_existia"> {
  const { error } = await supabaseAdmin()
    .storage.from(BUCKET_CONTRATOS)
    .upload(caminho, bytes, {
      contentType: "application/pdf",
      upsert: opcoes.substituir,
      // O rascunho e sobrescrito a cada geracao; cache nenhum no caminho, ou o
      // envio para assinatura poderia baixar a versao anterior.
      cacheControl: "0",
    });

  if (!error) return "gravado";
  if (!opcoes.substituir && jaExiste(error)) return "ja_existia";

  console.error(`[contrato] upload recusado em ${caminho}: ${error.message}`);
  if (bucketAusente(error)) throw new ErroBancoContrato(MENSAGEM_SEM_SCHEMA);
  throw new ErroBancoContrato("Não consegui guardar o PDF do contrato. Tente de novo em instantes.");
}

/** O PDF do bucket, ou `null` se o objeto nao existe. */
export async function baixarPdf(caminho: string): Promise<Uint8Array | null> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET_CONTRATOS).download(caminho);
  if (error || !data) {
    if (!error || naoEncontrado(error) || bucketAusente(error)) return null;
    console.error(`[contrato] download recusado em ${caminho}: ${error.message}`);
    throw new ErroBancoContrato("Não consegui abrir o PDF do contrato agora. Tente de novo em instantes.");
  }
  return new Uint8Array(await data.arrayBuffer());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGINA_LISTAGEM = 100;

/**
 * Apaga TODOS os arquivos de contrato do lead (rascunho, assinados, trilhas).
 * Devolve quantos saiam. Erro real lanca: quem apaga o lead aborta, como ja
 * faz com o PDF da proposta -- deixar contrato orfao no bucket seria guardar
 * CPF e endereco de alguem que a Mel acha que apagou.
 *
 * Pasta vazia ou bucket ainda nao criado: nada a apagar, devolve 0.
 */
export async function removerArquivosDoLead(leadId: string): Promise<number> {
  // Este caminho APAGA arquivos: um id fora do formato (".." ou vazio) apontaria
  // para outra pasta. As rotas ja validam, e isto e a segunda porta.
  if (!UUID.test(leadId)) throw new Error("id de lead inválido para remover arquivos");

  const bucket = supabaseAdmin().storage.from(BUCKET_CONTRATOS);
  const caminhos: string[] = [];

  for (let offset = 0; ; offset += PAGINA_LISTAGEM) {
    const { data, error } = await lerComRetentativa(`arquivos do contrato ${leadId}`, () =>
      bucket.list(leadId, { limit: PAGINA_LISTAGEM, offset, sortBy: { column: "name", order: "asc" } }),
    );
    if (error) {
      if (bucketAusente(error)) return 0;
      throw new ErroBancoContrato("Não consegui listar os arquivos do contrato. Tente de novo em instantes.");
    }
    const pagina = data ?? [];
    for (const objeto of pagina) if (objeto.name) caminhos.push(`${leadId}/${objeto.name}`);
    if (pagina.length < PAGINA_LISTAGEM) break;
  }

  if (caminhos.length === 0) return 0;

  const { error } = await bucket.remove(caminhos);
  if (error) {
    console.error(`[contrato] ${leadId}: remoção de ${caminhos.length} arquivo(s) recusada: ${error.message}`);
    throw new ErroBancoContrato("Não consegui apagar os arquivos do contrato. Tente de novo em instantes.");
  }
  return caminhos.length;
}
