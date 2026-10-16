import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sequenciaLembreteProposta } from "./lembretes-proposta";

const uuid = z.string().uuid();
const payloadSchema = z.object({
  batchId: uuid, jobId: uuid, leadId: uuid,
  recipient: z.string().regex(/^55\d{10,11}$/),
  tipo: z.literal("lembrete_proposta_7d"),
  expiresAt: z.string().datetime({ offset: true }),
  messages: z.tuple([z.string(), z.string(), z.string(), z.string()]),
}).strict();
const DOMINIO = "mel-whatsapp-legacy-v1.";
type Ticket = z.infer<typeof payloadSchema>;
type JobLegado = {
  id: string; recipient: string; tipo?: string; expiresAt: string;
  messagesSequence?: { message: string; delayBeforeSeconds: number }[];
  legacyBatchId?: string; legacyAuthorization?: string; testLeadId?: string;
};

function conferirPayload(payload: Ticket, job: JobLegado, agoraMs: number) {
  const expira = Date.parse(payload.expiresAt);
  if (!Number.isFinite(agoraMs) || expira <= agoraMs || expira > agoraMs + 300_000 ||
    expira > Date.parse(job.expiresAt) || payload.jobId !== job.id ||
    payload.batchId !== job.legacyBatchId || payload.recipient !== job.recipient ||
    payload.tipo !== job.tipo || job.testLeadId !== undefined ||
    !job.messagesSequence || payload.messages.some((texto, i) => texto !== job.messagesSequence?.[i]?.message)) {
    throw new Error("lote_legado_nao_autorizado");
  }
  const aprovadas = sequenciaLembreteProposta(7, payload.messages[2]);
  if (aprovadas.some((parte, i) => parte.message !== payload.messages[i] ||
    parte.delayBeforeSeconds !== job.messagesSequence?.[i]?.delayBeforeSeconds) ||
    job.messagesSequence.length !== 4) throw new Error("lote_legado_nao_autorizado");
}

/** Capacidade curta vinculada ao snapshot do job reservado; não declara silêncio. */
export function assinarAutorizacaoLegada(job: JobLegado, leadId: unknown, segredo: string | undefined, agoraMs: number): string {
  if (!segredo || segredo.length < 32) throw new Error("lote_legado_sem_chave");
  const payload = payloadSchema.parse({
    batchId: job.legacyBatchId, jobId: job.id, leadId, recipient: job.recipient, tipo: job.tipo,
    expiresAt: new Date(Math.min(agoraMs + 300_000, Date.parse(job.expiresAt))).toISOString(),
    messages: job.messagesSequence?.map(parte => parte.message),
  });
  conferirPayload(payload, job, agoraMs);
  const texto = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const assinatura = createHmac("sha256", segredo).update(DOMINIO + texto).digest("base64url");
  return `${texto}.${assinatura}`;
}

export function validarAutorizacaoLegada(job: JobLegado, agoraMs: number, segredo?: string): void {
  if (job.legacyBatchId === undefined && job.legacyAuthorization === undefined) return;
  if (!uuid.safeParse(job.legacyBatchId).success || typeof job.legacyAuthorization !== "string" ||
    job.legacyAuthorization.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(job.legacyAuthorization)) {
    throw new Error("lote_legado_nao_autorizado");
  }
  const [texto, assinatura] = job.legacyAuthorization.split(".");
  const decoded = Buffer.from(texto, "base64url");
  if (decoded.toString("base64url") !== texto) throw new Error("lote_legado_nao_autorizado");
  const payload = payloadSchema.parse(JSON.parse(decoded.toString("utf8")));
  conferirPayload(payload, job, agoraMs);
  if (segredo !== undefined) {
    if (segredo.length < 32) throw new Error("lote_legado_sem_chave");
    const esperado = createHmac("sha256", segredo).update(DOMINIO + texto).digest();
    const recebido = Buffer.from(assinatura, "base64url");
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
      throw new Error("lote_legado_nao_autorizado");
    }
  }
}
