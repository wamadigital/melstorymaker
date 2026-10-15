import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DisparoWhatsApp } from "@/lib/admin/tipos";
import { ehDataEnvioWhatsApp, ehTipoDisparoWhatsApp } from "@/lib/admin/disparos-whatsapp";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerComRetentativa } from "@/lib/supabase/consulta";

type ResultadoDisparos = { porLead: Map<string, DisparoWhatsApp[]>; erro: boolean };

/**
 * Uma leitura para todos os cartões visíveis (até 300 IDs e dois tipos por lead).
 * Fila segue privada: não seleciona texto, telefone, sequência ou credenciais.
 */
export async function lerDisparosWhatsApp(
  ids: readonly string[],
  cliente?: SupabaseClient,
): Promise<ResultadoDisparos> {
  const porLead = new Map<string, DisparoWhatsApp[]>();
  const visiveis = [...new Set(ids)];
  if (!visiveis.length) return { porLead, erro: false };
  const idsPermitidos = new Set(visiveis);

  try {
    const db = cliente ?? supabaseAdmin();
    const { data, error } = await lerComRetentativa("histórico de WhatsApp", () => db
      .from("whatsapp_outbox")
      .select("lead_id,tipo,enviado_em")
      .in("lead_id", visiveis)
      .in("tipo", ["confirmacao_recebimento", "lembrete_formulario_24h"])
      .eq("estado", "enviado")
      .not("enviado_em", "is", null)
      .abortSignal(AbortSignal.timeout(5_000)));

    if (error) return { porLead, erro: true };
    for (const linha of data ?? []) {
      if (!linha || !idsPermitidos.has(linha.lead_id) || !ehTipoDisparoWhatsApp(linha.tipo) ||
        !ehDataEnvioWhatsApp(linha.enviado_em)) continue;
      const disparos = porLead.get(linha.lead_id) ?? [];
      disparos.push({ tipo: linha.tipo, enviado_em: linha.enviado_em });
      porLead.set(linha.lead_id, disparos);
    }
    return { porLead, erro: false };
  } catch {
    // A leitura auxiliar nunca deve apagar as raias que já carregaram.
    console.error("[admin] não consegui carregar o histórico de WhatsApp");
    return { porLead, erro: true };
  }
}
