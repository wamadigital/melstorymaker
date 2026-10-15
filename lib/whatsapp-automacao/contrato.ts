import { z } from "zod";
import { MENSAGENS_LEMBRETE_FORMULARIO } from "./lembrete-formulario";
import { validarSequenciaProposta, type ParteMensagem } from "./lembretes-proposta";
export type ProtocoloWorker = 1 | 2 | 3;
export type TipoJobWhatsApp = "lembrete_formulario_24h" | "lembrete_proposta_7d" | "lembrete_proposta_30d";
export const HEADER_PROTOCOLO_WORKER = "X-Mel-Worker-Protocol";

export const jobSchema = z.object({
  id: z.string().uuid(),
  lease_token: z.string().uuid(),
  destinatario: z.string().regex(/^55\d{10,11}$/),
  mensagem: z.string().min(1).max(2000),
  expira_em: z.string().datetime({ offset: true }),
  tipo: z.enum(["lembrete_formulario_24h", "lembrete_proposta_7d", "lembrete_proposta_30d"]),
  sequencia: z.unknown().optional(),
});
const textoSequencia = z.string().min(1).max(2000).refine((texto) => texto.trim().length > 0);
const parte = <T extends number>(delay: T) => z.object({
  message: textoSequencia, delayBeforeSeconds: z.literal(delay),
});
const sequenciaSchema = z.tuple([parte(0), parte(2), parte(3), parte(2)]);
export type SequenciaMensagens = ParteMensagem[];
export type JobWhatsApp = {
  id: string;
  leaseToken: string;
  recipient: string;
  message: string;
  expiresAt: string;
  messagesSequence?: SequenciaMensagens;
  /** Obrigatório no protocolo 3; protocolo 2 continua restrito ao formulário. */
  tipo?: TipoJobWhatsApp;
};

function linkIndividual(texto: string): boolean {
  if (!/^https:\/\/[^\s/?#\\@]+\/continuar\/[a-f0-9-]+$/i.test(texto)) return false;
  try {
    const url = new URL(texto);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.startsWith("/continuar/") &&
      z.string().uuid().safeParse(url.pathname.slice("/continuar/".length)).success;
  } catch { return false; }
}

/** Valida o snapshot sem substituir texto, URL ou pausas pela copy atual. */
export function validarSequenciaMensagens(sequencia: unknown, mensagem: string): SequenciaMensagens {
  const partes = sequenciaSchema.parse(sequencia);
  if (!MENSAGENS_LEMBRETE_FORMULARIO.every((aprovada, i) => partes[i].message === aprovada.message) ||
    !linkIndividual(partes[3].message) || partes.map((p) => p.message).join("\n\n") !== mensagem) {
    throw new Error("snapshot_sequencia_invalido");
  }
  return partes;
}

/** Tambem usado na fronteira HTTP para nunca liberar sequencia a worker V1. */
export function validarJobWorker(job: JobWhatsApp, protocolo: ProtocoloWorker): JobWhatsApp {
  if (job.messagesSequence === undefined) throw new Error("mensagem_nao_autorizada");
  if (protocolo === 3) {
    if (!job.tipo) throw new Error("tipo_ausente");
    if (job.tipo === "lembrete_proposta_7d" || job.tipo === "lembrete_proposta_30d") {
      return { ...job, messagesSequence: validarSequenciaProposta(job.tipo, job.messagesSequence, job.message) };
    }
    if (job.tipo !== "lembrete_formulario_24h") throw new Error("tipo_nao_autorizado");
  } else if (protocolo !== 2 || (job.tipo && job.tipo !== "lembrete_formulario_24h")) {
    throw new Error("worker_sem_protocolo_sequencia");
  }
  return { ...job, messagesSequence: validarSequenciaMensagens(job.messagesSequence, job.message) };
}

export function envelopeJob(linha: unknown, protocolo: ProtocoloWorker = 1): JobWhatsApp {
  const job = jobSchema.parse(linha);
  const envelope: JobWhatsApp = {
    id: job.id, leaseToken: job.lease_token, recipient: job.destinatario,
    message: job.mensagem, expiresAt: job.expira_em,
  };
  if (protocolo === 3) {
    envelope.tipo = job.tipo;
    envelope.messagesSequence = job.tipo === "lembrete_formulario_24h"
      ? validarSequenciaMensagens(job.sequencia, job.mensagem)
      : validarSequenciaProposta(job.tipo, job.sequencia, job.mensagem);
  } else {
    if (protocolo !== 2 || job.tipo !== "lembrete_formulario_24h") throw new Error("worker_sem_protocolo_sequencia");
    envelope.messagesSequence = validarSequenciaMensagens(job.sequencia, job.mensagem);
  }
  return validarJobWorker(envelope, protocolo);
}

export const atividadeSchema = z.object({
  checkedAt: z.string().datetime({ offset: true }),
  coverageStartedAt: z.string().datetime({ offset: true }),
  lastInteractionAt: z.string().datetime({ offset: true }).nullable(),
  complete: z.boolean(),
}).strict();
// Apenas codigos tecnicos, nunca texto bruto do bridge, mensagem ou telefone.
export const resultadoSchema = z.object({
  leaseToken: z.string().uuid(),
  outcome: z.enum(["started", "sent", "indeterminate", "failed"]),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  activity: atividadeSchema.optional(),
}).strict();
export type ResultadoWorker = z.infer<typeof resultadoSchema>;
