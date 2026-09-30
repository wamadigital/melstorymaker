import { lerRegistroInterno } from "@/lib/supabase/contratos";
import { carregarLead, responder, rotaDoContrato } from "../_comum";
import { cancelarEnvio, enviarParaAssinatura, sincronizar } from "./_fluxo";

export const runtime = "nodejs";
// Enviar e: auth + upload do PDF + criacao do pedido (que dispara os e-mails
// antes de responder, com timeout proprio de 60 s no adapter). Consultar um
// pedido concluido baixa dois PDFs. A folga cobre o pior caso de cada um.
export const maxDuration = 300;

// O fluxo mora em `_fluxo.ts` (testavel com provedor e banco falsos); aqui so
// a portaria, o lead e a leitura do registro com as colunas internas.

/** POST /api/admin/leads/[id]/contrato/assinatura -- "Confirmar envio". */
export const POST = rotaDoContrato("enviar", async (_req, id) => {
  const lead = await carregarLead(id);
  return enviarParaAssinatura(id, lead, await lerRegistroInterno(id));
});

/** GET /api/admin/leads/[id]/contrato/assinatura -- "Atualizar status". */
export const GET = rotaDoContrato("consultar", async (_req, id) => {
  await carregarLead(id);
  const reg = await lerRegistroInterno(id);
  if (!reg) return responder({ registro: null });
  return responder({ registro: await sincronizar(id, reg) });
});

/** DELETE /api/admin/leads/[id]/contrato/assinatura -- "Cancelar envio". */
export const DELETE = rotaDoContrato("cancelar", async (_req, id) => {
  await carregarLead(id);
  return cancelarEnvio(id, await lerRegistroInterno(id));
});
