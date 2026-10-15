import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DisparoWhatsApp, SolicitacaoWhatsApp } from "@/lib/admin/tipos";
import { ehDataEnvioWhatsApp, ehTipoDisparoWhatsApp } from "@/lib/admin/disparos-whatsapp";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerComRetentativa } from "@/lib/supabase/consulta";

type ResultadoDisparos = {
  porLead: Map<string, DisparoWhatsApp[]>;
  solicitacoesPorLead: Map<string, SolicitacaoWhatsApp[]>;
  erro: boolean;
};
const MOTIVOS: Readonly<Record<string, string>> = {
  inactivity_recent: "Houve interação recente com este contato no WhatsApp.",
  interacao_recente: "Houve interação recente com este contato no WhatsApp.",
  inactivity_unverified: "Não consegui confirmar o histórico recente deste contato no WhatsApp.",
  historico_incompleto: "O histórico disponível ainda não cobre o período necessário.",
  historico_obsoleto: "É necessário atualizar a verificação do histórico do WhatsApp.",
  proposta_condicao_alterada: "A proposta ou as condições deste lembrete mudaram.",
  teste_owner_expirado: "O período autorizado para este teste terminou ou os dados do teste mudaram.",
};
const ESTADOS = ["pendente", "reservado", "enviando", "enviado", "indeterminado", "expirado", "cancelado"] as const;

/**
 * Uma leitura para todos os cartões visíveis (até 300 IDs).
 * Fila segue privada: não seleciona texto, telefone, sequência ou credenciais.
 */
export async function lerDisparosWhatsApp(
  ids: readonly string[],
  cliente?: SupabaseClient,
): Promise<ResultadoDisparos> {
  const porLead = new Map<string, DisparoWhatsApp[]>();
  const solicitacoesPorLead = new Map<string, SolicitacaoWhatsApp[]>();
  const visiveis = [...new Set(ids)];
  if (!visiveis.length) return { porLead, solicitacoesPorLead, erro: false };
  const idsPermitidos = new Set(visiveis);

  try {
    const db = cliente ?? supabaseAdmin();
    const { data, error } = await lerComRetentativa("histórico de WhatsApp", () => db
      .from("whatsapp_outbox")
      .select("lead_id,tipo,enviado_em,estado,ocorrido_em,proposta_enviado_em,ultimo_codigo")
      .in("lead_id", visiveis)
      .in("tipo", ["confirmacao_recebimento", "lembrete_formulario_24h", "lembrete_proposta_7d", "lembrete_proposta_30d"])
      .in("estado", ESTADOS)
      .abortSignal(AbortSignal.timeout(5_000)));

    if (error) return { porLead, solicitacoesPorLead, erro: true };
    for (const linha of data ?? []) {
      if (!linha || !idsPermitidos.has(linha.lead_id) || !ehTipoDisparoWhatsApp(linha.tipo)) continue;
      if (linha.estado === "enviado" && ehDataEnvioWhatsApp(linha.enviado_em)) {
        const disparos = porLead.get(linha.lead_id) ?? [];
        const revisao = (linha.tipo === "lembrete_proposta_7d" || linha.tipo === "lembrete_proposta_30d") &&
          ehDataEnvioWhatsApp(linha.proposta_enviado_em)
          ? { proposta_enviado_em: linha.proposta_enviado_em } : {};
        disparos.push({ tipo: linha.tipo, enviado_em: linha.enviado_em, ...revisao });
        porLead.set(linha.lead_id, disparos);
      }
      if ((linha.tipo === "lembrete_proposta_7d" || linha.tipo === "lembrete_proposta_30d") &&
        ESTADOS.includes(linha.estado) && ehDataEnvioWhatsApp(linha.ocorrido_em) &&
        ehDataEnvioWhatsApp(linha.proposta_enviado_em)) {
        const solicitacoes = solicitacoesPorLead.get(linha.lead_id) ?? [];
        solicitacoes.push({ tipo: linha.tipo, estado: linha.estado, ocorrido_em: linha.ocorrido_em,
          proposta_enviado_em: linha.proposta_enviado_em,
          motivo: typeof linha.ultimo_codigo === "string" && Object.hasOwn(MOTIVOS, linha.ultimo_codigo)
            ? MOTIVOS[linha.ultimo_codigo] : null });
        solicitacoesPorLead.set(linha.lead_id, solicitacoes);
      }
    }
    return { porLead, solicitacoesPorLead, erro: false };
  } catch {
    // A leitura auxiliar nunca deve apagar as raias que já carregaram.
    console.error("[admin] não consegui carregar o histórico de WhatsApp");
    return { porLead, solicitacoesPorLead, erro: true };
  }
}
