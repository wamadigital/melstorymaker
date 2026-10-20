import "server-only";
import { z } from "zod";
import type { SignatarioStatus } from "@/lib/contrato/tipos";
import {
  AssinaturaError,
  nomeArquivoSeguro,
  normalizarEmail,
  pareceSerPdf,
  recuperarPapel,
  validarPedido,
  type PedidoAssinatura,
  type ProvedorAssinatura,
  type ResultadoConsulta,
  type ResultadoEnvio,
  type Signatario,
  type SignatarioConhecido,
} from "./adapter";
import { EnvioAssinaturaIncertoError } from "./envio-incerto";

// Contrato REST oficial: https://api.assinafy.com.br/v1/docs/openapi.json
// virtual + Email preserva o PDF conferido e usa o certificado do provedor,
// sem campos coletados, WhatsApp, biometria ou certificado A1/A3 pagos.
const BASES = {
  production: "https://api.assinafy.com.br/v1",
  sandbox: "https://sandbox.assinafy.com.br/v1",
} as const;
type Ambiente = keyof typeof BASES;
export const PREFIXO_TOKEN_ASSINAFY = "assinafy-v1|";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const tokenSchema = z.object({ ambiente: z.enum(["production", "sandbox"]), accountId: id, documentId: id });
const pessoaSchema = z.object({
  id,
  full_name: z.string().min(1),
  email: z.string().nullable(),
  completed: z.boolean().nullable().optional(),
});
const resumoPessoaSchema = z.object({
  id: id.optional(), email: z.string().nullable().optional(), completed: z.boolean().optional(),
});
const assignmentSchema = z.object({
  id,
  signers: z.array(pessoaSchema).min(1),
  summary: z.object({ signers: z.array(resumoPessoaSchema) }).optional(),
});
const documentoSchema = z.object({
  id, account_id: id, status: z.string(),
  assignment: assignmentSchema.nullable().optional(),
  declined_by: z.object({ id: id.optional(), email: z.string().nullable().optional() }).nullable().optional(),
  updated_at: z.string().optional(),
});
const estimativaSchema = z.object({
  has_sufficient_resources: z.boolean(),
  needs_extra_document: z.boolean(),
  total_credits: z.number().nonnegative(),
  documents: z.number().int().positive(),
});
type Documento = z.infer<typeof documentoSchema>;
type Pessoa = z.infer<typeof pessoaSchema>;
type Token = z.infer<typeof tokenSchema>;
type Etapa = "upload" | "estimar" | "signatarios" | "signature" | "consultar" | "void" | "download-signed" | "download-audit";
const ROTULOS: Record<Etapa, string> = {
  upload: "enviar o PDF", estimar: "conferir o limite de documentos",
  signatarios: "preparar quem vai assinar", signature: "solicitar as assinaturas",
  consultar: "consultar o andamento", void: "cancelar o envio",
  "download-signed": "baixar o contrato assinado", "download-audit": "baixar o certificado de assinatura",
};
export type OpcoesAssinafy = {
  apiKey: string;
  accountId: string;
  ambiente?: Ambiente;
  fetch?: typeof fetch;
  agora?: () => number;
  timeoutMs?: number;
  timeoutLongoMs?: number;
};

function erroResposta(etapa: Etapa): AssinaturaError {
  return new AssinaturaError("A Assinafy devolveu uma resposta que não consegui confirmar. Confira o andamento antes de tentar novamente.", {
    codigo: "resposta_invalida", etapa,
  });
}

/** Token interno sem chave nem URL arbitraria. Conta/ambiente ficam presos ao envio. */
export function montarTokenAssinafy(dados: Token): string {
  return PREFIXO_TOKEN_ASSINAFY + Buffer.from(JSON.stringify(tokenSchema.parse(dados))).toString("base64url");
}

export function lerTokenAssinafy(token: string): Token {
  try {
    const corpo = token.slice(PREFIXO_TOKEN_ASSINAFY.length);
    if (!token.startsWith(PREFIXO_TOKEN_ASSINAFY) || corpo.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(corpo)) throw new Error();
    return tokenSchema.parse(JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")));
  } catch {
    throw new AssinaturaError("O registro deste envio está corrompido. Confira o pedido no painel da Assinafy antes de cancelar e enviar novamente.", { codigo: "token_ilegivel" });
  }
}

function nomesIguais(a: string, b: string): boolean {
  const chave = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return chave(a) === chave(b);
}

function pendentes(signatarios: readonly Signatario[]): SignatarioStatus[] {
  return signatarios.map((s) => ({ ...s, email: normalizarEmail(s.email), status: "pendente", assinadoEm: null }));
}

export class Assinafy implements ProvedorAssinatura {
  readonly nome = "assinafy" as const;
  private readonly apiKey: string;
  private readonly accountId: string;
  private readonly ambiente: Ambiente;
  private readonly requisitar: typeof fetch;
  private readonly agora: () => number;
  private readonly timeoutMs: number;
  private readonly timeoutLongoMs: number;

  constructor(o: OpcoesAssinafy) {
    if (!o.apiKey.trim() || !id.safeParse(o.accountId).success || (o.ambiente && !Object.hasOwn(BASES, o.ambiente))) {
      throw new AssinaturaError("Confira a chave, a conta e o ambiente da Assinafy na configuração do servidor.", { codigo: "pedido_invalido" });
    }
    this.apiKey = o.apiKey.trim();
    this.accountId = o.accountId;
    this.ambiente = o.ambiente ?? "production";
    this.requisitar = o.fetch ?? fetch;
    this.agora = o.agora ?? Date.now;
    this.timeoutMs = o.timeoutMs ?? 20_000;
    this.timeoutLongoMs = o.timeoutLongoMs ?? 60_000;
  }

  private token(token: string): Token {
    const dados = lerTokenAssinafy(token);
    if (dados.accountId !== this.accountId || dados.ambiente !== this.ambiente) {
      throw new AssinaturaError("Este envio pertence a outra conta ou ambiente da Assinafy. Restaure a configuração original para consultá-lo ou cancelá-lo.", { codigo: "token_invalido" });
    }
    return dados;
  }

  private async chamar(caminho: string, etapa: Etapa, init: RequestInit = {}, longo = false): Promise<Response> {
    let r: Response;
    try {
      r = await this.requisitar(`${BASES[this.ambiente]}${caminho}`, {
        ...init,
        headers: { ...init.headers, "X-Api-Key": this.apiKey, Accept: "application/json, application/pdf" },
        cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(longo ? this.timeoutLongoMs : this.timeoutMs),
      });
    } catch (e) {
      const timeout = e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name);
      throw new AssinaturaError(`Não consegui ${ROTULOS[etapa]} na Assinafy agora.`, { codigo: timeout ? "timeout" : "rede", etapa });
    }
    if (!r.ok) {
      // Nunca expor/registrar corpo upstream: pode conter dados do contrato.
      const configuracao = r.status === 401 || r.status === 403;
      throw new AssinaturaError(configuracao
        ? "A Assinafy recusou o acesso. Confira a chave e as permissões da conta no servidor."
        : `Não consegui ${ROTULOS[etapa]} na Assinafy agora.`, { codigo: "http", etapa, status: r.status });
    }
    return r;
  }

  private async bytes(r: Response, etapa: Etapa, maximo: number): Promise<Uint8Array> {
    if (Number(r.headers.get("content-length")) > maximo || !r.body) throw erroResposta(etapa);
    const reader = r.body.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximo) { await reader.cancel(); throw erroResposta(etapa); }
        partes.push(value);
      }
    } catch (e) {
      if (e instanceof AssinaturaError) throw e;
      throw new AssinaturaError(`A conexão com a Assinafy foi interrompida ao ${ROTULOS[etapa]}.`, { codigo: "rede", etapa });
    } finally { reader.releaseLock(); }
    return Buffer.concat(partes, total);
  }

  private async json<S extends z.ZodType>(caminho: string, etapa: Etapa, schema: S, init: RequestInit = {}, longo = false): Promise<z.infer<S>> {
    const r = await this.chamar(caminho, etapa, init, longo);
    const bytes = await this.bytes(r, etapa, 1_000_000);
    try {
      const envelope = z.object({ status: z.number().int().min(200).max(299), data: z.unknown() });
      return schema.parse(envelope.parse(JSON.parse(Buffer.from(bytes).toString("utf8"))).data);
    } catch { throw erroResposta(etapa); }
  }

  private post(dados: unknown): RequestInit {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) };
  }

  private async documento(documentId: string): Promise<Documento> {
    const d = await this.json(`/documents/${documentId}`, "consultar", documentoSchema);
    if (d.id !== documentId || d.account_id !== this.accountId) throw erroResposta("consultar");
    return d;
  }

  private async buscarPessoa(email: string): Promise<Pessoa | null> {
    for (let pagina = 1; pagina <= 10; pagina++) {
      const query = new URLSearchParams({ search: email, "per-page": "50", page: String(pagina) });
      const pessoas = await this.json(`/accounts/${this.accountId}/signers?${query}`, "signatarios", z.array(pessoaSchema));
      const pessoa = pessoas.find((s) => s.email && normalizarEmail(s.email) === email);
      if (pessoa) return pessoa;
      if (pessoas.length < 50) return null;
    }
    throw erroResposta("signatarios");
  }

  private async pessoa(s: Signatario): Promise<Pessoa> {
    const email = normalizarEmail(s.email);
    let pessoa = await this.buscarPessoa(email);
    if (!pessoa) {
      try {
        pessoa = await this.json(`/accounts/${this.accountId}/signers`, "signatarios", pessoaSchema, this.post({ full_name: s.nome.trim(), email }));
      } catch (e) {
        // A API usa 400 para e-mail duplicado. Confirmar a correspondencia,
        // em vez de transformar qualquer 400 em duplicacao.
        if (!(e instanceof AssinaturaError) || ![400, 409].includes(e.status ?? 0)) throw e;
        pessoa = await this.buscarPessoa(email);
        if (!pessoa) throw e;
      }
    }
    if (normalizarEmail(pessoa.email ?? "") !== email || !nomesIguais(pessoa.full_name, s.nome)) {
      throw new AssinaturaError("O nome de um signatário cadastrado na Assinafy não confere com o contrato. Confira o cadastro e os dados antes de enviar.", { codigo: "pedido_invalido", etapa: "signatarios" });
    }
    return pessoa;
  }

  async enviar(p: PedidoAssinatura): Promise<ResultadoEnvio> {
    validarPedido(p);
    if (!p.antesDeNotificar) throw new AssinaturaError("Não consegui reservar este envio com segurança. Recarregue o contrato antes de enviar.", { codigo: "pedido_invalido" });
    const form = new FormData();
    form.set("file", new Blob([Buffer.from(p.pdf)], { type: "application/pdf" }), nomeArquivoSeguro(p.nomeArquivo));
    const doc = await this.json(`/accounts/${this.accountId}/documents`, "upload", documentoSchema, { method: "POST", body: form }, true);
    if (doc.account_id !== this.accountId || !["uploaded", "metadata_processing", "metadata_ready"].includes(doc.status)) throw erroResposta("upload");
    const canal = { verification_method: "Email", notification_methods: ["Email"] };
    const pessoas: Pessoa[] = [];
    for (const s of p.signatarios) pessoas.push(await this.pessoa(s));
    if (new Set(pessoas.map((s) => s.id)).size !== pessoas.length) throw erroResposta("signatarios");
    // Consultar o saldo perto do convite e recusar extras na estimativa.
    // A API nao oferece reserva atomica de franquia/max_cost: nao representa
    // garantia de custo contra outros envios simultaneos no mesmo workspace.
    const estimativa = await this.json(`/documents/${doc.id}/assignments/estimate-cost`, "estimar", estimativaSchema,
      this.post({ method: "virtual", signers: p.signatarios.map(() => canal) }));
    if (!estimativa.has_sufficient_resources || estimativa.needs_extra_document || estimativa.total_credits !== 0 || estimativa.documents !== 1) {
      throw new AssinaturaError("O limite de documentos incluídos no plano da Assinafy não permite este envio. Nenhuma assinatura foi solicitada e créditos extras não foram usados.", { codigo: "sem_creditos", etapa: "estimar" });
    }
    const resultado: ResultadoEnvio = {
      token: montarTokenAssinafy({ ambiente: this.ambiente, accountId: this.accountId, documentId: doc.id }),
      status: "enviado", signatarios: pendentes(p.signatarios),
    };
    // Esta gravacao antecede o unico passo que pode notificar alguem. Um
    // crash/timeout deixa um token consultavel e o contrato reservado.
    try { await p.antesDeNotificar(resultado); }
    catch (e) {
      // Ainda nao existe convite. Remover o rascunho quando o processamento
      // ja permite, sem transformar falha de limpeza em autorizacao de envio.
      try {
        const rascunho = await this.documento(doc.id);
        if (!rascunho.assignment && rascunho.status === "metadata_ready") {
          await this.chamar(`/documents/${doc.id}`, "void", { method: "DELETE" });
        }
      } catch { console.warn("[assinatura] Assinafy: rascunho sem convite pendente de limpeza"); }
      throw e;
    }
    try {
      const assignment = await this.json(`/documents/${doc.id}/assignments`, "signature", assignmentSchema, this.post({
        method: "virtual", signers: pessoas.map((s) => ({ id: s.id, ...canal })),
        message: p.mensagem,
        expires_at: new Date(this.agora() + p.diasValidade * 86_400_000).toISOString(),
      }), true);
      const ids = new Set(assignment.signers.map((s) => s.id));
      if (ids.size !== pessoas.length || pessoas.some((s) => !ids.has(s.id))) throw erroResposta("signature");
    } catch (e) {
      // 4xx (exceto timeout408) e recusa explicita. Rede/5xx/JSON invalido
      // podem ter criado o pedido: nao cancelar, reenviar nem liberar o card.
      if (e instanceof AssinaturaError && e.codigo === "http" && e.status && e.status >= 400 && e.status < 500 && e.status !== 408) throw e;
      throw new EnvioAssinaturaIncertoError(resultado, e);
    }
    return resultado;
  }

  async consultar(token: string, conhecidos: readonly SignatarioConhecido[] = []): Promise<ResultadoConsulta> {
    const { documentId } = this.token(token);
    let d: Documento;
    try { d = await this.documento(documentId); }
    catch (e) {
      if (e instanceof AssinaturaError && e.status === 404) throw new AssinaturaError("Não encontrei este envio na Assinafy.", { codigo: "inexistente", etapa: "consultar", status: 404 });
      throw e;
    }
    if (!d.assignment) throw new AssinaturaError("A Assinafy ainda não confirmou a solicitação de assinaturas. Confira novamente em instantes ou cancele o envio antes de tentar outro.", { codigo: "http", etapa: "consultar" });
    const emails = d.assignment.signers.map((s) => normalizarEmail(s.email ?? ""));
    if (conhecidos.length && (emails.length !== conhecidos.length || conhecidos.some((s) => !emails.includes(normalizarEmail(s.email))))) throw erroResposta("consultar");
    const fechado = d.status === "certificated";
    const signatarios: SignatarioStatus[] = d.assignment.signers.map((s) => {
      const resumo = d.assignment?.summary?.signers.find((r) => r.id === s.id || (r.email && normalizarEmail(r.email) === normalizarEmail(s.email ?? "")));
      const recusou = d.status === "rejected_by_signer" && (d.declined_by?.id === s.id || (d.declined_by?.email && normalizarEmail(d.declined_by.email) === normalizarEmail(s.email ?? "")));
      return {
        papel: recuperarPapel(s.email ?? "", s.full_name, conhecidos), nome: s.full_name, email: s.email ?? "",
        status: recusou ? "recusou" : fechado || s.completed || resumo?.completed ? "assinou" : "pendente",
        assinadoEm: null, // A API nao fornece instante individual de assinatura.
      };
    });
    const encerrados = { rejected_by_signer: "recusado", rejected_by_user: "cancelado", expired: "expirado" } as const;
    if (Object.hasOwn(encerrados, d.status)) return { status: encerrados[d.status as keyof typeof encerrados], signatarios, concluidoEm: null };
    if (!["uploaded", "metadata_processing", "metadata_ready", "pending_signature", "pending_identity_review", "certificating", "certificated"].includes(d.status)) throw erroResposta("consultar");
    let concluidoEm: string | null = null;
    if (fechado) {
      // updated_at muda com alteracoes administrativas; nao e a data da
      // certificacao. A atividade document_ready registra esse instante.
      const atividades = await this.json(`/documents/${documentId}/activities`, "consultar",
        z.array(z.object({ event: z.string(), created_at: z.string() })));
      const datas = atividades.filter((a) => a.event === "document_ready")
        .map((a) => Date.parse(a.created_at)).filter(Number.isFinite);
      if (!datas.length) throw erroResposta("consultar");
      concluidoEm = new Date(Math.max(...datas)).toISOString();
    }
    return { status: fechado ? "concluido" : "enviado", signatarios, concluidoEm };
  }

  private async baixar(token: string, artefato: "certificated" | "certificate-page"): Promise<Uint8Array> {
    const { documentId } = this.token(token);
    const etapa = artefato === "certificated" ? "download-signed" : "download-audit";
    if ((await this.documento(documentId)).status !== "certificated") throw new AssinaturaError("O contrato ainda não foi certificado pela Assinafy. Atualize o status em instantes.", { codigo: "sem_arquivo", etapa });
    let r: Response;
    try { r = await this.chamar(`/documents/${documentId}/download/${artefato}`, etapa, {}, true); }
    catch (e) {
      if (e instanceof AssinaturaError && e.status === 404) throw new AssinaturaError("A Assinafy ainda está preparando o arquivo assinado. Atualize o status em instantes.", { codigo: "sem_arquivo", etapa });
      throw e;
    }
    const bytes = await this.bytes(r, etapa, 10 * 1024 * 1024);
    if (!pareceSerPdf(bytes)) throw erroResposta(etapa);
    return bytes;
  }

  baixarAssinado(token: string): Promise<Uint8Array> { return this.baixar(token, "certificated"); }
  baixarTrilha(token: string): Promise<Uint8Array> { return this.baixar(token, "certificate-page"); }

  async cancelar(token: string): Promise<void> {
    const { documentId } = this.token(token);
    let d: Documento;
    try { d = await this.documento(documentId); }
    catch (e) {
      if (e instanceof AssinaturaError && e.status === 404) {
        // Confirmar ausencia antes de a rota encerrar so no sistema.
        await this.consultar(token);
      }
      throw e;
    }
    if (d.status === "certificated") throw new AssinaturaError("O contrato já foi assinado por todos.", { codigo: "ja_concluido", etapa: "void" });
    if (["expired", "rejected_by_signer", "rejected_by_user"].includes(d.status)) return;
    const catalogo = await this.json("/documents/statuses", "void", z.array(z.object({ code: z.string(), deletable: z.boolean() })));
    if (!catalogo.some((s) => s.code === d.status && s.deletable)) throw new AssinaturaError("A Assinafy está processando este documento e ainda não permite cancelá-lo. Atualize o status em instantes.", { codigo: "http", etapa: "void" });
    try { await this.chamar(`/documents/${documentId}`, "void", { method: "DELETE" }); }
    catch (e) {
      if (e instanceof AssinaturaError && e.status === 404) await this.consultar(token);
      throw e;
    }
    try {
      const depois = await this.documento(documentId);
      if (["expired", "rejected_by_signer", "rejected_by_user"].includes(depois.status)) return;
      if (depois.status === "certificated") throw new AssinaturaError("O contrato já foi assinado por todos.", { codigo: "ja_concluido", etapa: "void" });
      throw new AssinaturaError("A Assinafy ainda não confirmou o cancelamento. O contrato continua reservado; atualize o status antes de enviar novamente.", { codigo: "http", etapa: "void" });
    } catch (e) {
      if (e instanceof AssinaturaError && e.status === 404) return;
      throw e;
    }
  }
}
