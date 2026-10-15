import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadCartao } from "@/lib/admin/tipos";
import { supabaseAdmin } from "./admin";
import { marcoTesteOwner, testeOwnerPropostaValido } from "@/lib/whatsapp-automacao/testes";
import { normalizarNumero } from "@/lib/whatsapp";

/** Só publica o marco do próprio card depois de validar o cadastro privado do teste. */
export async function lerTestesWhatsApp(
  leads: readonly LeadCartao[], agoraMs: number, db: SupabaseClient = supabaseAdmin(),
): Promise<Map<string, { marco: 7 | 30; expiraEm: string }>> {
  const resultado = new Map<string, { marco: 7 | 30; expiraEm: string }>();
  const candidatos = leads.filter(l => marcoTesteOwner({ leadId: l.id, nome: l.nome_display, destinatario: l.whatsapp }, agoraMs));
  if (!candidatos.length) return resultado;
  try {
    const { data, error } = await db.from("whatsapp_testes_owner")
      .select("lead_id,marco,proposta_enviado_em,proposta_pdf_url,expira_em")
      .in("lead_id", candidatos.map(l => l.id)).abortSignal(AbortSignal.timeout(5_000));
    if (error) return resultado;
    for (const row of data ?? []) {
      const lead = candidatos.find(l => l.id === row.lead_id);
      if (!lead || row.proposta_enviado_em !== lead.enviado_em || row.proposta_pdf_url !== lead.pdf_url ||
        marcoTesteOwner({ leadId: lead.id, nome: lead.nome_display, destinatario: lead.whatsapp }, agoraMs) !== row.marco ||
        !testeOwnerPropostaValido({ leadId: lead.id, recipient: normalizarNumero(lead.whatsapp),
          tipo: `lembrete_proposta_${row.marco}d`, expiresAt: row.expira_em }, agoraMs)) continue;
      resultado.set(lead.id, { marco: row.marco, expiraEm: row.expira_em });
    }
  } catch { /* Falha fechada: segue exibindo somente as condições normais. */ }
  return resultado;
}
