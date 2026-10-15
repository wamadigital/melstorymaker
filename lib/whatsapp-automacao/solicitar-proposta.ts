import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { lembretesPropostaAtivos } from "./lembretes-proposta";

const mensagens: Record<string, string> = {
  automacao_pausada: "Os envios de lembrete estão pausados.",
  payload_invalido: "Solicitação inválida.",
  lead_nao_encontrado: "Lead não encontrado.",
  coluna_invalida: "O lembrete só está disponível em Enviado ou Esfriou.",
  proposta_alterada: "A proposta mudou. Atualize o card antes de solicitar o lembrete.",
  proposta_ausente: "Gere a proposta antes de enviar o lembrete.",
  telefone_invalido: "Confira o WhatsApp cadastrado neste lead.",
  prazo_nao_atingido: "O prazo deste lembrete ainda não foi atingido.",
  lembrete_7_nao_enviado: "Envie primeiro o lembrete de 7 dias pelo sistema. Uma marcação manual não confirma o envio.",
  lembrete_7_recente: "Aguarde 15 dias desde o primeiro lembrete, sem novas conversas, para a última tentativa.",
  ja_enviado: "Este lembrete já foi enviado para esta proposta.",
  envio_indeterminado: "O envio anterior ficou sem confirmação. Confira a conversa antes de qualquer novo contato.",
  tentativa_encerrada: "Esta tentativa foi encerrada. Confira o histórico do lead.",
  fila_indisponivel: "Não consegui solicitar o envio agora.",
};
type ResultadoSolicitacao = { status: number; corpo: { ok?: true; estado?: string; erro?: string; codigo?: string } };
const sucesso = z.object({ id: z.string().uuid(), estado: z.enum(["pendente", "reservado", "enviando", "enviado"]), reutilizado: z.boolean().optional() });
const falha = (codigo: string, status = 409): ResultadoSolicitacao => ({
  status, corpo: { erro: mensagens[codigo] ?? mensagens.fila_indisponivel, codigo: mensagens[codigo] ? codigo : "fila_indisponivel" },
});

export async function solicitarLembreteProposta(
  db: SupabaseClient, entrada: { id: string; marco: 7 | 30; solicitante: string },
  ambiente: Record<string, string | undefined> = process.env,
): Promise<ResultadoSolicitacao> {
  if (!lembretesPropostaAtivos(ambiente)) return falha("automacao_pausada", 503);
  const { data: lead, error: erroLead } = await db.from("leads").select("enviado_em")
    .eq("id", entrada.id).abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
  if (erroLead) return falha("fila_indisponivel", 503);
  if (!lead) return falha("lead_nao_encontrado", 404);
  const { data, error } = await db.rpc("enfileirar_lembrete_proposta_whatsapp", {
    p_lead_id: entrada.id, p_marco: entrada.marco, p_proposta_enviado_em: lead.enviado_em,
    p_solicitado_por: entrada.solicitante,
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) return falha("fila_indisponivel", 503);
  // Outra aba ou uma página antiga pode solicitar um lembrete já confirmado.
  // Sincroniza o botão com esse fato; o banco não cria outra tentativa.
  if (data?.erro === "ja_enviado") return { status: 200, corpo: { ok: true, estado: "enviado" } };
  const parsed = sucesso.safeParse(data);
  if (!parsed.success) return falha(typeof data?.erro === "string" ? data.erro : "fila_indisponivel");
  return { status: parsed.data.estado === "enviado" ? 200 : 202, corpo: { ok: true, estado: parsed.data.estado } };
}
