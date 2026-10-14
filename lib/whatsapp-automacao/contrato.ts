import { z } from "zod";
import { validarTelefoneBr } from "@/lib/form/validacao";
import { normalizarNumero } from "@/lib/whatsapp";

export const MENSAGEM_CONFIRMACAO =
  "Oi! Recebi as informações do seu evento 💛\n\n" +
  "Vou analisar os detalhes e te chamar por aqui para conversar sobre a sua proposta.\n\n" +
  "Mel Simão | Storymaker";
export const PRAZO_CONFIRMACAO_MS = 24 * 60 * 60 * 1000;

export function destinatarioConfirmacao(whatsapp: string | null | undefined): string | null {
  if (!whatsapp || validarTelefoneBr(whatsapp)) return null;
  return normalizarNumero(whatsapp);
}

export const jobSchema = z.object({
  id: z.string().uuid(),
  lease_token: z.string().uuid(),
  destinatario: z.string().regex(/^55\d{10,11}$/),
  mensagem: z.string().min(1).max(2000),
  expira_em: z.string().datetime({ offset: true }),
});
export type JobWhatsApp = {
  id: string;
  leaseToken: string;
  recipient: string;
  message: string;
  expiresAt: string;
};

export function envelopeJob(linha: unknown): JobWhatsApp {
  const job = jobSchema.parse(linha);
  return {
    id: job.id, leaseToken: job.lease_token, recipient: job.destinatario,
    message: job.mensagem, expiresAt: job.expira_em,
  };
}

// Apenas codigos tecnicos, nunca texto bruto do bridge, mensagem ou telefone.
export const resultadoSchema = z.object({
  leaseToken: z.string().uuid(),
  outcome: z.enum(["started", "sent", "indeterminate", "failed"]),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
}).strict();
export type ResultadoWorker = z.infer<typeof resultadoSchema>;
