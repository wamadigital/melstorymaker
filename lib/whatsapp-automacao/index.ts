import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  envelopeJob,
  type JobWhatsApp, type ResultadoWorker, type ProtocoloWorker,
} from "./contrato";
import {
  configuracaoLembreteFormulario, MENSAGENS_LEMBRETE_FORMULARIO,
  type AmbienteLembreteFormulario,
} from "./lembrete-formulario";
import { lembretesPropostaAtivos } from "./lembretes-proposta";
import { propostaInicialAtiva } from "./proposta-inicial";
import { prepararUmaPropostaAutomatica } from "./preparar-proposta";
import { enviarEventoDeStatus } from "@/lib/meta/lead";

export type AmbienteWhatsApp = AmbienteLembreteFormulario & {
  [chave: string]: string | undefined;
  WHATSAPP_AUTOMACAO_ATIVA?: string;
  WHATSAPP_WORKER_TOKEN?: string;
};
export function automacaoAtiva(ambiente: AmbienteWhatsApp = process.env): boolean {
  const valor = ambiente.WHATSAPP_AUTOMACAO_ATIVA?.toLowerCase();
  return valor === "1" || valor === "true";
}

type ContextoRepositorioWhatsApp = {
  ambiente?: AmbienteWhatsApp;
  agora?: () => number;
  falhaLembretes?: () => void;
  protocolo?: ProtocoloWorker;
};

/** SDK real pode receber transporte, ambiente e relógio isolados nos testes. */
export function criarRepositorioWhatsApp(db: SupabaseClient, contexto: ContextoRepositorioWhatsApp = {}) {
  const ambiente: AmbienteWhatsApp = contexto.ambiente ?? process.env;
  const agora = contexto.agora ?? Date.now;
  const protocoloPadrao = contexto.protocolo ?? 1;
  // Somente o worker novo conhece a janela de não perturbe antes de cada parte.
  // Um rollback de código não pode reativar o agendamento antigo de 24 horas.
  const configAtual = (protocolo: ProtocoloWorker) => protocolo >= 5
    ? configuracaoLembreteFormulario(ambiente, agora()) : null;
  const propostasAtivas = (protocolo: ProtocoloWorker) => protocolo >= 3 && lembretesPropostaAtivos(ambiente);
  const inicialAtiva = (protocolo: ProtocoloWorker) => protocolo >= 4 && propostaInicialAtiva(ambiente);
  const falhaLembretes = contexto.falhaLembretes ??
    (() => console.error("[whatsapp] nao consegui registrar lembretes do formulario"));
  return {
    reivindicar: async (protocolo = protocoloPadrao): Promise<JobWhatsApp | null> => {
      const config = configAtual(protocolo);
      const propostas = propostasAtivas(protocolo);
      const inicial = inicialAtiva(protocolo);
      if (!config && !propostas && !inicial) return null;
      if (inicial) {
        try { await prepararUmaPropostaAutomatica(db); }
        catch { console.error("[whatsapp:proposta] preparo_indisponivel"); }
      }
      if (config) {
        try {
          const { error } = await db.rpc("enfileirar_lembretes_formulario_whatsapp_v6", {
            p_inicio_em: config.inicioEm, p_mensagens: MENSAGENS_LEMBRETE_FORMULARIO,
            p_app_url: config.appUrl,
          }).abortSignal(AbortSignal.timeout(5_000));
          if (error) throw new Error("registro_lembretes_whatsapp");
        } catch {
          falhaLembretes();
        }
      }
      const { data, error } = await db.rpc(protocolo === 5 ? "reivindicar_whatsapp_v6" : protocolo === 4 ? "reivindicar_whatsapp_v5" : protocolo === 3 ? "reivindicar_whatsapp_v4" : "reivindicar_whatsapp_v3",
        protocolo >= 3 ? {
          p_formulario_ativo: !!config, p_inicio_em: config?.inicioEm ?? null, p_propostas_ativo: propostas,
          ...(protocolo >= 4 ? { p_inicial_ativo: inicial } : {}),
        } : { p_lembrete_ativo: true, p_inicio_em: config!.inicioEm })
        .abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("claim_whatsapp");
      return data?.[0] ? envelopeJob(data[0], protocolo, agora()) : null;
    },
    resultado: async (id: string, resultado: ResultadoWorker, protocolo = protocoloPadrao): Promise<string | null> => {
      const config = configAtual(protocolo);
      const propostas = propostasAtivas(protocolo);
      const inicial = inicialAtiva(protocolo);
      if (resultado.outcome === "started" && !config && !propostas && !inicial) return null;
      const { data, error } = await db.rpc(protocolo === 5 ? "resultado_whatsapp_v6" : protocolo === 4 ? "resultado_whatsapp_v5" : protocolo === 3 ? "resultado_whatsapp_v4" : config ? "resultado_whatsapp_v3" : "resultado_whatsapp", {
        p_id: id, p_lease_token: resultado.leaseToken, p_outcome: resultado.outcome,
        p_code: resultado.code ?? null,
        ...(protocolo >= 3 ? {
          p_formulario_ativo: !!config, p_inicio_em: config?.inicioEm ?? null, p_propostas_ativo: propostas,
          ...(protocolo >= 4 ? { p_inicial_ativo: inicial } : {}),
          p_historico_verificado_em: resultado.activity?.checkedAt ?? null,
          p_historico_cobertura_inicio_em: resultado.activity?.coverageStartedAt ?? null,
          p_ultima_interacao_em: resultado.activity?.lastInteractionAt ?? null,
          p_historico_completo: resultado.activity?.complete ?? false,
        } : config ? { p_lembrete_ativo: true, p_inicio_em: config.inicioEm } : {}),
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("resultado_whatsapp");
      return typeof data === "string" ? data : null;
    },
  };
}

export async function reivindicarWhatsApp(protocolo: ProtocoloWorker = 1): Promise<JobWhatsApp | null> {
  return criarRepositorioWhatsApp(supabaseAdmin(), { protocolo }).reivindicar();
}

/** Retorna null para token/estado recusado; nunca transforma isso em ACK. */
export async function registrarResultadoWhatsApp(
  id: string, resultado: ResultadoWorker, protocolo: ProtocoloWorker = 1,
): Promise<string | null> {
  const db = supabaseAdmin();
  let primeiroEnvio: string | null = null;
  if (protocolo >= 4 && resultado.outcome === "sent") {
    try {
      const { data } = await db.from("whatsapp_outbox").select("lead_id,tipo,enviado_em")
        .eq("id", id).eq("lease_token", resultado.leaseToken)
        .abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
      if (data?.tipo === "proposta_inicial_15m" && data.enviado_em === null) primeiroEnvio = data.lead_id;
    } catch { /* Tracking auxiliar não bloqueia ACK nem entrega. */ }
  }
  const estado = await criarRepositorioWhatsApp(db, { protocolo }).resultado(id, resultado);
  // O trigger do banco preserva o CRM durável. Mantém também o evento Site
  // existente, após COMMIT, sem expor dados do contato ao navegador da Mel.
  if (estado === "enviado" && primeiroEnvio) {
    const leadId = primeiroEnvio;
    after(async () => { await enviarEventoDeStatus(leadId, "enviado"); });
  }
  return estado;
}
