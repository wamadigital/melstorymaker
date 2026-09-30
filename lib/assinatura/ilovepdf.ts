import "server-only";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import type { PosicaoAssinatura, SignatarioStatus, StatusAssinatura } from "@/lib/contrato/tipos";
import {
  AssinaturaError,
  PREFIXO_TOKEN_DRY_RUN,
  nomeArquivoSeguro,
  normalizarEmail,
  pareceSerPdf,
  recuperarPapel,
  validarPedido,
  type CodigoErroAssinatura,
  type PedidoAssinatura,
  type ProvedorAssinatura,
  type ResultadoConsulta,
  type ResultadoEnvio,
  type SignatarioConhecido,
} from "./adapter";

// Cliente REST da assinatura eletronica da iLoveAPI (iLovePDF Signature).
// Referencia: https://www.iloveapi.com/docs/api-reference, secoes
// "Authentication" e "Signatures". Sem SDK de proposito: o oficial puxa axios e
// um cliente de JWT para seis chamadas que cabem em `fetch`.
//
// Fluxo do envio: /auth -> /start/sign -> {server}/upload -> {server}/signature.
// Ninguem aqui chama a API sem a rota pedir, e a rota so pede por clique da Mel.

const API = "https://api.ilovepdf.com/v1";

/**
 * O JWT do /auth vale 1 hora (medido em 29/09/2026: `exp - agora` = 3600 s). O
 * cache guarda 50 minutos: a folga cobre relogio adiantado e uma chamada longa
 * (upload, download) que comece no fim da validade.
 */
const VALIDADE_TOKEN_MS = 50 * 60 * 1000;

/** Chamadas de JSON. */
const TIMEOUT_PADRAO_MS = 20_000;
/**
 * Chamadas que carregam arquivo (upload, download) e a CRIACAO do pedido, que
 * dispara os e-mails antes de responder. Timeout curto ali e o pior caso: o
 * pedido nasce na plataforma, a gente desiste de esperar e a Mel reenvia.
 */
const TIMEOUT_LONGO_MS = 60_000;

type Etapa =
  | "auth"
  | "start"
  | "upload"
  | "signature"
  | "consultar"
  | "download-signed"
  | "download-audit"
  | "void";

const ROTULO_ETAPA: Record<Etapa, string> = {
  auth: "autenticação",
  start: "abertura do envio",
  upload: "envio do PDF",
  signature: "criação do pedido de assinatura",
  consultar: "consulta do andamento",
  "download-signed": "download do contrato assinado",
  "download-audit": "download da trilha de auditoria",
  void: "cancelamento",
};

export type OpcoesILoveApi = {
  publicKey: string;
  /** Injetavel para teste. Padrao: o `fetch` global. */
  fetch?: typeof fetch;
  /** Relogio do cache do token, em ms. Injetavel para teste. */
  agora?: () => number;
  /** Timeout das chamadas de JSON. Padrao 20 s. */
  timeoutMs?: number;
  /** Timeout de upload, download e criacao do pedido. Padrao 60 s. */
  timeoutLongoMs?: number;
};

/**
 * Cache do token por chave publica, no escopo do MODULO e nao da instancia: a
 * rota cria um provedor por request, e um cache por instancia nunca seria
 * reaproveitado entre o envio e a consulta seguinte na mesma funcao quente.
 */
const cacheDeToken = new Map<string, { token: string; expiraEm: number }>();

// ------------------------------------------------------------------ token --

/**
 * O token opaco guardado em `contratos.assinatura_token` e "{server}|{token_requester}".
 *
 * Por que o server vai junto:
 * 1. Os downloads (contrato assinado e trilha) sao feitos no servidor de
 *    trabalho (`https://{server}/v1/signature/...`), nao em api.ilovepdf.com.
 * 2. As bibliotecas oficiais conseguem um server chamando /start/sign de novo.
 *    So que /start/sign RECUSA (400, "You don't have enough signatures to start
 *    a request", medido em 29/09/2026) quando a conta esta sem credito de
 *    assinatura. Fazer igual amarraria o download de um contrato JA ASSINADO a
 *    ter credito para um contrato NOVO. Guardando o server do proprio envio,
 *    baixar nunca depende de saldo.
 * 3. Um campo so, opaco, numa coluna interna: nenhuma migration para uma segunda
 *    coluna, e ninguem fora deste arquivo precisa saber o formato.
 */
export function montarToken(server: string, tokenRequester: string): string {
  return `${server}|${tokenRequester}`;
}

/**
 * Servidor de trabalho da iLoveAPI ("api84.ilovepdf.com"). Conferido antes de
 * virar URL porque o token vem do banco e a chamada leva o Bearer: um valor
 * adulterado nunca pode mandar a credencial para outro host.
 */
function servidorValido(server: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(ilovepdf|iloveimg|iloveapi)\.com$/i.test(server);
}

export function lerToken(token: string): { server: string; tokenRequester: string } {
  if (token.startsWith(PREFIXO_TOKEN_DRY_RUN)) {
    throw new AssinaturaError(
      "Este envio foi feito em modo de teste (ASSINATURA_DRY_RUN) e não existe na plataforma de assinatura.",
      { codigo: "token_invalido" },
    );
  }
  const barra = token.indexOf("|");
  const server = barra > 0 ? token.slice(0, barra) : "";
  const tokenRequester = barra > 0 ? token.slice(barra + 1) : "";
  if (!servidorValido(server) || !/^[^\s/|?#]+$/.test(tokenRequester)) {
    // Sem token legivel nao ha como consultar nem cancelar o pedido por aqui:
    // o "Cancelar envio" do painel encerra o envio so no sistema, e o pedido
    // antigo, se ainda existir, so sai pelo painel da iLoveAPI.
    throw new AssinaturaError(
      "O registro deste envio para assinatura está corrompido. Use “Cancelar envio” para destravar o contrato e, antes de enviar de novo, confira no painel da iLoveAPI se o pedido antigo não ficou aberto.",
      { codigo: "token_ilegivel" },
    );
  }
  return { server, tokenRequester };
}

// ----------------------------------------------------------------- respostas --

// So os campos que usamos. `z.object` descarta o resto: o que a API acrescentar
// amanha nao quebra nada.
const respostaAuth = z.object({ token: z.string().min(1) });
const respostaStart = z.object({ server: z.string().min(1), task: z.string().min(1) });
const respostaUpload = z.object({ server_filename: z.string().min(1) });
const signatarioApi = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  status: z.string().nullish(),
});
const respostaAssinatura = z.object({
  token_requester: z.string().nullish(),
  status: z.string(),
  expired: z.boolean().nullish(),
  completed_on: z.string().nullish(),
  signers: z.array(signatarioApi).nullish(),
});
type RespostaAssinatura = z.infer<typeof respostaAssinatura>;

// --------------------------------------------------------------- normalizar --

const STATUS_CONHECIDOS = new Set([
  "draft",
  "sent",
  "delivered",
  "waiting",
  "completed",
  "declined",
  "expired",
  "void",
  "deleted",
]);

/**
 * Status do PEDIDO, no vocabulario do sistema.
 *
 * - draft/sent/delivered/waiting -> "enviado": "draft" e o instante entre criar
 *   o pedido e a plataforma terminar de mandar os e-mails; para a Mel, ja foi.
 * - "deleted" e pedido CONCLUIDO que alguem apagou no site da iLovePDF depois.
 *   Vira "cancelado" porque, sem os arquivos na plataforma, nao ha o que baixar:
 *   para o sistema e um envio que nao chegou a lugar nenhum.
 * - Status que nao conhecemos cai em "enviado", o unico que nao move nada no
 *   banco: a rota continua consultando em vez de dar como perdido um contrato
 *   que talvez tenha sido assinado.
 * - `expired: true` vence o texto do status: a plataforma pode demorar a
 *   atualizar um enquanto o outro ja virou.
 */
export function normalizarStatus(status: string, expirado?: boolean | null): StatusAssinatura {
  switch (status.trim().toLowerCase()) {
    case "completed":
      return "concluido";
    case "declined":
      return "recusado";
    case "expired":
      return "expirado";
    case "void":
    case "deleted":
      return "cancelado";
    default:
      return expirado ? "expirado" : "enviado";
  }
}

/**
 * Status de cada SIGNATARIO. A plataforma distingue waiting/sent/viewed (e
 * "error" de entrega); para a Mel tudo isso e "ainda nao assinou".
 */
export function normalizarStatusSignatario(status: string | null | undefined): SignatarioStatus["status"] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "signed":
      return "assinou";
    case "declined":
    case "rejected":
    case "nonvalidated":
      return "recusou";
    default:
      return "pendente";
  }
}

/**
 * Data da API ("2024-06-17 12:39:34", sem fuso) para ISO 8601.
 *
 * A referencia diz que as datas saem "no fuso do painel do usuario". O painel da
 * conta nao tem configuracao de fuso (conferido em 29/09/2026) e o console dele
 * agrupa as horas em UTC, entao a leitura e UTC. Se a API passar a mandar
 * offset explicito, ele e respeitado. Formato desconhecido -> null: a data e
 * informativa, a prova juridica e a trilha de auditoria.
 */
export function dataDaApiParaIso(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) {
    const [, a, mes, d, h, min, s] = m;
    const ms = Date.UTC(+a, +mes - 1, +d, +h, +min, s ? +s : 0);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return null;
}

/** "{x} -{y}": origem no canto SUPERIOR esquerdo, y para baixo e negativo. */
export function posicaoIlove(pos: PosicaoAssinatura): string {
  const n = (v: number) => String(Number(v.toFixed(2)));
  const y = n(pos.yTopo);
  return `${n(pos.x)} ${y === "0" ? "0" : `-${y}`}`;
}

/**
 * Corpo do POST {server}/v1/signature. Puro e exportado para o teste conferir
 * exatamente o que sai.
 */
export function montarCorpoAssinatura(e: {
  task: string;
  serverFilename: string;
  pedido: PedidoAssinatura;
}): Record<string, unknown> {
  const { task, serverFilename, pedido } = e;
  const filename = nomeArquivoSeguro(pedido.nomeArquivo);
  const assunto = pedido.assunto.trim();
  const mensagem = pedido.mensagem.trim();

  return {
    task,
    files: [{ server_filename: serverFilename, filename }],
    signers: pedido.signatarios.map((s) => ({
      name: s.nome.trim(),
      email: s.email.trim(),
      type: "signer",
      files: [
        {
          server_filename: serverFilename,
          // So as posicoes do papel de quem assina: o campo da CONTRATANTE nao
          // pode aparecer para a CONTRATADA assinar.
          elements: pedido.posicoes
            .filter((pos) => pos.papel === s.papel)
            .map((pos) => ({
              type: "signature",
              position: posicaoIlove(pos),
              pages: String(pos.pagina),
              // `size` e a ALTURA do elemento, inteira; a largura acompanha.
              size: Math.round(pos.altura),
            })),
        },
      ],
    })),
    language: "pt",
    // Em paralelo: a Mel nao precisa esperar a cliente para assinar a parte dela.
    lock_order: false,
    expiration_days: pedido.diasValidade,
    signer_reminders: true,
    signer_reminder_days_cycle: 3,
    // A propria referencia avisa: sem o UUID visivel a validade da assinatura cai.
    uuid_visible: true,
    // QR code na trilha levando aos documentos originais e assinados.
    verify_enabled: true,
    ...(assunto ? { subject_signer: assunto } : {}),
    ...(mensagem ? { message_signer: mensagem } : {}),
  };
}

// ----------------------------------------------------------------- arquivo --

/**
 * A referencia diz que o download devolve PDF quando o pedido tem um arquivo so
 * (sempre o nosso caso) e ZIP quando tem mais. Se um dia vier ZIP mesmo assim,
 * extrair aqui e a diferenca entre guardar o contrato assinado e travar o
 * contrato em "enviado" para sempre. Sem dependencia nova: `node:zlib` resolve.
 */
function garantirPdf(bytes: Uint8Array, etapa: Etapa): Uint8Array {
  if (pareceSerPdf(bytes)) return bytes;
  const doZip = ehZip(bytes) ? extrairPdfDeZip(bytes) : null;
  if (doZip && pareceSerPdf(doZip)) return doZip;

  console.error(`[assinatura] ${etapa} arquivo em formato inesperado`);
  throw new AssinaturaError(
    `A plataforma de assinatura devolveu um arquivo que não é PDF (${ROTULO_ETAPA[etapa]}). Tente de novo em alguns minutos.`,
    { codigo: "resposta_invalida", etapa },
  );
}

function ehZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/**
 * Primeiro ".pdf" de um ZIP, lido pelo diretorio central (o cabecalho local pode
 * vir sem os tamanhos, quando o ZIP e gerado em streaming). Metodos 0 (sem
 * compressao) e 8 (deflate), que e o que qualquer gerador usa. Sem ZIP64: um
 * contrato nao chega perto de 4 GB. Qualquer coisa fora disso -> null.
 */
export function extrairPdfDeZip(bytes: Uint8Array): Uint8Array | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;

  // O fim do diretorio central fica nos ultimos 22 bytes + comentario (<= 64 kB).
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return null;

  const entradas = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);

  try {
    for (let n = 0; n < entradas; n++) {
      if (buf.readUInt32LE(p) !== CENTRAL) return null;
      const metodo = buf.readUInt16LE(p + 10);
      const tamanho = buf.readUInt32LE(p + 20);
      const tamNome = buf.readUInt16LE(p + 28);
      const tamExtra = buf.readUInt16LE(p + 30);
      const tamComentario = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      const nome = buf.toString("utf8", p + 46, p + 46 + tamNome);
      p += 46 + tamNome + tamExtra + tamComentario;

      if (!/\.pdf$/i.test(nome)) continue;
      if (buf.readUInt32LE(local) !== LOCAL) return null;
      const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(inicio, inicio + tamanho);
      if (metodo === 0) return new Uint8Array(dados);
      if (metodo === 8) return new Uint8Array(inflateRawSync(dados));
      return null;
    }
  } catch {
    // Offset fora do buffer ou deflate corrompido: nao e um ZIP que sabemos ler.
    return null;
  }
  return null;
}

// ------------------------------------------------------------------ erros --

const MENSAGEM_SEM_CREDITOS =
  "A conta da iLoveAPI está sem créditos de assinatura. Compre créditos no painel da iLoveAPI e tente de novo.";

function mensagemHttp(etapa: Etapa, status: number): { mensagem: string; codigo: CodigoErroAssinatura } {
  // No /auth, qualquer recusa do cliente (400 ou 401) quer dizer chave errada.
  if (status === 401 || status === 403 || (etapa === "auth" && status >= 400 && status < 500 && status !== 429)) {
    return {
      codigo: "http",
      mensagem:
        "A plataforma de assinatura recusou a chave de acesso. Confira a configuração da iLoveAPI.",
    };
  }
  if (status === 429) {
    return {
      codigo: "http",
      mensagem:
        "A plataforma de assinatura recebeu pedidos demais em pouco tempo. Espere alguns minutos e tente de novo.",
    };
  }
  if (status >= 500) {
    return {
      codigo: "http",
      mensagem: `A plataforma de assinatura está instável agora (${ROTULO_ETAPA[etapa]}). Tente de novo em alguns minutos.`,
    };
  }
  if ((etapa === "download-signed" || etapa === "download-audit") && status === 400) {
    // A referencia: download-signed responde 400 enquanto o pedido nao esta "completed".
    return { codigo: "sem_arquivo", mensagem: "O contrato ainda não foi assinado por todas as partes." };
  }
  if (status === 404 && etapa !== "auth" && etapa !== "start" && etapa !== "upload") {
    return {
      // Nas etapas que apontam para um pedido JA criado, 404 e o pedido que
      // sumiu da plataforma. Na criacao ("signature") o 404 nao diz isso: e so
      // uma recusa como as outras.
      codigo: etapa === "signature" ? "http" : "inexistente",
      mensagem:
        "Este envio não foi encontrado na plataforma de assinatura. Ele pode ter sido apagado pelo painel da iLovePDF.",
    };
  }
  if (etapa === "upload" && status === 413) {
    return {
      codigo: "http",
      mensagem: "O PDF do contrato ficou grande demais para a plataforma de assinatura.",
    };
  }
  return {
    codigo: "http",
    mensagem: `A plataforma de assinatura recusou o pedido (${ROTULO_ETAPA[etapa]}, HTTP ${status}). Tente de novo; se continuar, confira o painel da iLoveAPI.`,
  };
}

/**
 * Erro HTTP -> AssinaturaError. O CORPO da resposta nunca vai para o log nem
 * para a mensagem: o erro de validacao da iLoveAPI ecoa os campos do pedido, e
 * os campos do pedido sao nome e e-mail de cliente. A unica leitura do corpo e
 * no /start/sign, para reconhecer falta de credito -- e dali so sai um texto fixo.
 */
async function erroHttp(etapa: Etapa, r: Response): Promise<AssinaturaError> {
  let { mensagem, codigo } = mensagemHttp(etapa, r.status);

  if (etapa === "start" && r.status === 400) {
    const corpo = await r.text().catch(() => "");
    if (/enough\s+(signatures|credits)|credit/i.test(corpo)) {
      mensagem = MENSAGEM_SEM_CREDITOS;
      codigo = "sem_creditos";
    }
  } else {
    await r.body?.cancel().catch(() => {});
  }

  console.error(`[assinatura] ${etapa} ${r.status}${codigo === "sem_creditos" ? " sem créditos" : ""}`);
  return new AssinaturaError(mensagem, { codigo, etapa, status: r.status });
}

function lerJson<T>(schema: z.ZodType<T>, etapa: Etapa): (r: Response) => Promise<T> {
  return async (r) => {
    const texto = await r.text();
    let dado: unknown;
    try {
      dado = JSON.parse(texto);
    } catch {
      dado = undefined;
    }
    const parsed = schema.safeParse(dado);
    if (!parsed.success) {
      console.error(`[assinatura] ${etapa} resposta inesperada`);
      throw new AssinaturaError(
        `A plataforma de assinatura respondeu num formato inesperado (${ROTULO_ETAPA[etapa]}). Tente de novo em alguns minutos.`,
        { codigo: "resposta_invalida", etapa, status: r.status },
      );
    }
    return parsed.data;
  };
}

async function lerBytes(r: Response): Promise<Uint8Array> {
  return new Uint8Array(await r.arrayBuffer());
}

async function descartar(r: Response): Promise<void> {
  await r.body?.cancel().catch(() => {});
}

/** Codigo de rede sem PII ("ECONNRESET", "ENOTFOUND"), so para o log. */
function codigoDeRede(e: unknown): string {
  const causa = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof causa === "string") return causa;
  return e instanceof Error ? e.name : "desconhecido";
}

// ----------------------------------------------------------------- cliente --

export class ILoveApi implements ProvedorAssinatura {
  readonly nome = "ilovepdf" as const;

  private readonly publicKey: string;
  private readonly buscarFetch: typeof fetch;
  private readonly agora: () => number;
  private readonly timeoutMs: number;
  private readonly timeoutLongoMs: number;

  constructor(opcoes: OpcoesILoveApi) {
    if (!opcoes.publicKey.trim()) {
      throw new AssinaturaError("A assinatura eletrônica não está configurada.", {
        codigo: "pedido_invalido",
      });
    }
    this.publicKey = opcoes.publicKey.trim();
    // Sem `.bind`, o fetch nativo reclama de "Illegal invocation" quando chamado
    // como metodo de outro objeto.
    this.buscarFetch = opcoes.fetch ?? ((url, init) => fetch(url, init));
    this.agora = opcoes.agora ?? Date.now;
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.timeoutLongoMs = opcoes.timeoutLongoMs ?? TIMEOUT_LONGO_MS;
  }

  // ------------------------------------------------------------ envio --

  async enviar(p: PedidoAssinatura): Promise<ResultadoEnvio> {
    // Antes de qualquer chamada: /start/sign ja reserva uma tarefa, e o
    // /signature gasta credito. Pedido errado para aqui, de graca.
    validarPedido(p);

    const { server, task } = await this.chamar(
      "start",
      () => ({ url: `${API}/start/sign` }),
      lerJson(respostaStart, "start"),
      this.timeoutMs,
    );
    if (!servidorValido(server)) {
      console.error("[assinatura] start servidor inesperado");
      throw new AssinaturaError(
        "A plataforma de assinatura respondeu num formato inesperado (abertura do envio). Tente de novo em alguns minutos.",
        { codigo: "resposta_invalida", etapa: "start" },
      );
    }

    const filename = nomeArquivoSeguro(p.nomeArquivo);
    const { server_filename: serverFilename } = await this.chamar(
      "upload",
      () => {
        // Remontado a cada tentativa: um FormData nao pode ser reenviado.
        const form = new FormData();
        form.append("task", task);
        form.append("file", new Blob([new Uint8Array(p.pdf)], { type: "application/pdf" }), filename);
        return { url: `https://${server}/v1/upload`, init: { method: "POST", body: form } };
      },
      lerJson(respostaUpload, "upload"),
      this.timeoutLongoMs,
    );

    const corpo = JSON.stringify(montarCorpoAssinatura({ task, serverFilename, pedido: p }));
    const resposta = await this.chamar(
      "signature",
      () => ({
        url: `https://${server}/v1/signature`,
        init: { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo },
      }),
      lerJson(respostaAssinatura, "signature"),
      this.timeoutLongoMs,
    );
    if (!resposta.token_requester) {
      console.error("[assinatura] signature resposta sem token_requester");
      throw new AssinaturaError(
        "A plataforma de assinatura criou o pedido mas não devolveu a identificação dele. Confira no painel da iLoveAPI antes de enviar de novo, para o cliente não receber dois e-mails.",
        { codigo: "resposta_invalida", etapa: "signature" },
      );
    }

    // A lista sai da ENTRADA, e nao da resposta: nome, e-mail e papel quem sabe
    // somos nos; da plataforma vem so o status de cada um.
    const daApi = resposta.signers ?? [];
    const signatarios: SignatarioStatus[] = p.signatarios.map((s) => {
      const correspondente = daApi.find(
        (a) => normalizarEmail(a.email ?? "") === normalizarEmail(s.email),
      );
      return {
        papel: s.papel,
        nome: s.nome,
        email: s.email,
        status: normalizarStatusSignatario(correspondente?.status),
        assinadoEm: null,
      };
    });

    return {
      token: montarToken(server, resposta.token_requester),
      status: normalizarStatus(resposta.status, resposta.expired),
      signatarios,
    };
  }

  // --------------------------------------------------------- consulta --

  async consultar(
    token: string,
    conhecidos: readonly SignatarioConhecido[] = [],
  ): Promise<ResultadoConsulta> {
    const { tokenRequester } = lerToken(token);
    const r = await this.chamar(
      "consultar",
      () => ({ url: `${API}/signature/requesterview/${encodeURIComponent(tokenRequester)}` }),
      lerJson(respostaAssinatura, "consultar"),
      this.timeoutMs,
    );
    return this.normalizarConsulta(r, conhecidos);
  }

  private normalizarConsulta(
    r: RespostaAssinatura,
    conhecidos: readonly SignatarioConhecido[],
  ): ResultadoConsulta {
    if (!STATUS_CONHECIDOS.has(r.status.trim().toLowerCase())) {
      // O status nao e PII; o registro e para alguem acrescentar o caso aqui.
      console.warn(`[assinatura] consultar status desconhecido: ${r.status.slice(0, 40)}`);
    }
    const status = normalizarStatus(r.status, r.expired);
    const daApi = r.signers ?? [];

    const signatarios: SignatarioStatus[] =
      daApi.length > 0
        ? daApi.map((a) => {
            const email = a.email ?? "";
            const nome = a.name ?? "";
            const conhecido = conhecidos.find(
              (c) => normalizarEmail(c.email) === normalizarEmail(email),
            );
            return {
              papel: recuperarPapel(email, nome, conhecidos),
              nome: nome || conhecido?.nome || "",
              email,
              status: normalizarStatusSignatario(a.status),
              // A requesterview nao traz a data de cada assinatura (so a do
              // pedido inteiro, em `completed_on`). Quem registra quando cada
              // um assinou e a trilha de auditoria.
              assinadoEm: null,
            };
          })
        : // Resposta sem signatarios: mantem a lista que a rota ja tinha em vez
          // de apagar da tela quem precisa assinar.
          conhecidos.map((c) => ({
            papel: c.papel,
            nome: c.nome ?? "",
            email: c.email,
            status: "pendente" as const,
            assinadoEm: null,
          }));

    return {
      status,
      signatarios,
      concluidoEm: status === "concluido" ? dataDaApiParaIso(r.completed_on) : null,
    };
  }

  // -------------------------------------------------------- downloads --

  async baixarAssinado(token: string): Promise<Uint8Array> {
    return this.baixar(token, "download-signed");
  }

  async baixarTrilha(token: string): Promise<Uint8Array> {
    return this.baixar(token, "download-audit");
  }

  private async baixar(token: string, etapa: "download-signed" | "download-audit"): Promise<Uint8Array> {
    const { server, tokenRequester } = lerToken(token);
    const bytes = await this.chamar(
      etapa,
      () => ({ url: `https://${server}/v1/signature/${encodeURIComponent(tokenRequester)}/${etapa}` }),
      lerBytes,
      this.timeoutLongoMs,
    );
    return garantirPdf(bytes, etapa);
  }

  // ------------------------------------------------------- cancelamento --

  /**
   * Anula o pedido (PUT /signature/void). Idempotente do ponto de vista da Mel:
   * se a plataforma recusa porque o pedido ja terminou por outro caminho
   * (cancelado pelo site, expirado, recusado pelo cliente), nao ha mais nada a
   * cancelar e isso nao e erro. Se ja foi ASSINADO por todos, e erro com texto
   * proprio: a rota precisa consultar e guardar o contrato assinado, nao
   * marcar como cancelado.
   *
   * 404 no void so vira "inexistente" se a CONSULTA tambem responder 404. O
   * erro "inexistente" e o que deixa a rota encerrar o envio so no sistema,
   * sem a plataforma confirmar; um 404 isolado (a consulta acha o pedido
   * aberto, ou nao responde) nao basta para dizer que o link morreu na caixa
   * do cliente.
   */
  async cancelar(token: string): Promise<void> {
    const { tokenRequester } = lerToken(token);
    try {
      await this.chamar(
        "void",
        () => ({
          url: `${API}/signature/void/${encodeURIComponent(tokenRequester)}`,
          init: { method: "PUT" },
        }),
        descartar,
        this.timeoutMs,
      );
    } catch (e) {
      if (!(e instanceof AssinaturaError)) throw e;
      const naoAchou = e.codigo === "inexistente";
      const recusaDeNegocio =
        naoAchou ||
        (e.codigo === "http" &&
          e.status !== null &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 401 &&
          e.status !== 403 &&
          e.status !== 429);
      if (!recusaDeNegocio) throw e;

      let atual: ResultadoConsulta | null = null;
      try {
        atual = await this.consultar(token);
      } catch (consulta) {
        // 404 dos dois lados: o pedido nao existe mais na plataforma.
        if (naoAchou && consulta instanceof AssinaturaError && consulta.codigo === "inexistente") {
          throw consulta;
        }
      }
      if (atual?.status === "concluido") {
        throw new AssinaturaError(
          "Todas as partes já assinaram: não dá mais para cancelar este envio. Atualize o status para guardar o contrato assinado.",
          { codigo: "ja_concluido", etapa: "void", status: e.status },
        );
      }
      if (atual && atual.status !== "enviado") return;
      if (naoAchou) {
        throw new AssinaturaError(
          "A plataforma de assinatura não encontrou o pedido para cancelar, mas também não confirmou que ele foi encerrado. Tente de novo em instantes; se continuar, cancele pelo painel da iLoveAPI.",
          { codigo: "http", etapa: "void", status: e.status },
        );
      }
      throw e;
    }
  }

  // ------------------------------------------------------------- http --

  private async tokenDeAcesso(): Promise<{ token: string; doCache: boolean }> {
    const agora = this.agora();
    const guardado = cacheDeToken.get(this.publicKey);
    if (guardado && guardado.expiraEm > agora) return { token: guardado.token, doCache: true };

    const lerAuth = lerJson(respostaAuth, "auth");
    const { token } = await this.comTempo(
      "auth",
      `${API}/auth`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ public_key: this.publicKey }),
      },
      async (r) => {
        if (!r.ok) throw await erroHttp("auth", r);
        return lerAuth(r);
      },
      this.timeoutMs,
    );
    // Validade contada de ANTES do pedido: erra para o lado de renovar cedo.
    cacheDeToken.set(this.publicKey, { token, expiraEm: agora + VALIDADE_TOKEN_MS });
    return { token, doCache: false };
  }

  /**
   * Chamada autenticada. Um 401 com token do cache (funcao quente que passou da
   * validade, relogio adiantado) ganha UMA segunda tentativa com token novo: o
   * 401 e recusa na porta, antes de a plataforma processar qualquer coisa, entao
   * repetir nao duplica pedido. Token recem-emitido recusado e chave errada, e
   * repetir nao ajudaria.
   */
  private async chamar<T>(
    etapa: Etapa,
    montar: (token: string) => { url: string; init?: RequestInit },
    ler: (r: Response) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let acesso = await this.tokenDeAcesso();
    for (let tentativa = 0; ; tentativa++) {
      const { url, init = {} } = montar(acesso.token);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${acesso.token}`);

      const resultado = await this.comTempo(
        etapa,
        url,
        { ...init, headers },
        async (r) => {
          if (r.status === 401 && acesso.doCache && tentativa === 0) {
            await descartar(r);
            return { repetir: true as const };
          }
          if (!r.ok) throw await erroHttp(etapa, r);
          return { repetir: false as const, valor: await ler(r) };
        },
        timeoutMs,
      );

      if (!resultado.repetir) return resultado.valor;
      cacheDeToken.delete(this.publicKey);
      acesso = await this.tokenDeAcesso();
    }
  }

  /**
   * fetch + leitura do corpo sob o MESMO timeout. So o fetch nao basta: ele
   * resolve quando chegam os cabecalhos, e um download que trava no meio do
   * corpo penduraria a funcao ate o teto da Vercel.
   */
  private async comTempo<T>(
    etapa: Etapa,
    url: string,
    init: RequestInit,
    ler: (r: Response) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);
    try {
      const r = await this.buscarFetch(url, { ...init, signal: controle.signal });
      return await ler(r);
    } catch (e) {
      if (e instanceof AssinaturaError) throw e;

      // Na criacao do pedido, "sem resposta" nao quer dizer "nao criado": os
      // e-mails podem ja ter saido. Reenviar as cegas manda dois contratos ao
      // cliente.
      const conferir =
        etapa === "signature"
          ? " Antes de tentar de novo, confira no painel da iLoveAPI se o pedido não foi criado, para o cliente não receber dois e-mails."
          : " Tente de novo em instantes.";

      if (controle.signal.aborted) {
        console.error(`[assinatura] ${etapa} timeout (${timeoutMs} ms)`);
        throw new AssinaturaError(
          `A plataforma de assinatura demorou demais para responder (${ROTULO_ETAPA[etapa]}).${conferir}`,
          { codigo: "timeout", etapa },
        );
      }
      console.error(`[assinatura] ${etapa} falha de rede (${codigoDeRede(e)})`);
      throw new AssinaturaError(
        `Não foi possível falar com a plataforma de assinatura (${ROTULO_ETAPA[etapa]}).${conferir}`,
        { codigo: "rede", etapa },
      );
    } finally {
      clearTimeout(relogio);
    }
  }
}
