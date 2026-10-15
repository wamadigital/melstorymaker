import { z } from "zod";
import { MENSAGENS_LEMBRETE_FORMULARIO } from "./lembrete-formulario";
export type ProtocoloWorker = 1 | 2;
export const HEADER_PROTOCOLO_WORKER = "X-Mel-Worker-Protocol";

export const jobSchema = z.object({
  id: z.string().uuid(),
  lease_token: z.string().uuid(),
  destinatario: z.string().regex(/^55\d{10,11}$/),
  mensagem: z.string().min(1).max(2000),
  expira_em: z.string().datetime({ offset: true }),
  tipo: z.literal("lembrete_formulario_24h"),
  sequencia: z.unknown().optional(),
});
const textoSequencia = z.string().min(1).max(2000).refine((texto) => texto.trim().length > 0);
const parte = <T extends number>(delay: T) => z.object({
  message: textoSequencia, delayBeforeSeconds: z.literal(delay),
});
const sequenciaSchema = z.tuple([parte(0), parte(2), parte(3), parte(2)]);
export type SequenciaMensagens = z.infer<typeof sequenciaSchema>;
export type JobWhatsApp = {
  id: string;
  leaseToken: string;
  recipient: string;
  message: string;
  expiresAt: string;
  messagesSequence?: SequenciaMensagens;
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
  if (protocolo !== 2) throw new Error("worker_sem_protocolo_sequencia");
  return { ...job, messagesSequence: validarSequenciaMensagens(job.messagesSequence, job.message) };
}

export function envelopeJob(linha: unknown, protocolo: ProtocoloWorker = 1): JobWhatsApp {
  const job = jobSchema.parse(linha);
  const envelope: JobWhatsApp = {
    id: job.id, leaseToken: job.lease_token, recipient: job.destinatario,
    message: job.mensagem, expiresAt: job.expira_em,
  };
  if (protocolo !== 2) throw new Error("worker_sem_protocolo_sequencia");
  envelope.messagesSequence = validarSequenciaMensagens(job.sequencia, job.mensagem);
  return envelope;
}

// Apenas codigos tecnicos, nunca texto bruto do bridge, mensagem ou telefone.
export const resultadoSchema = z.object({
  leaseToken: z.string().uuid(),
  outcome: z.enum(["started", "sent", "indeterminate", "failed"]),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
}).strict();
export type ResultadoWorker = z.infer<typeof resultadoSchema>;
