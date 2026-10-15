import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  destinatarioConfirmacao, envelopeJob, MENSAGEM_CONFIRMACAO, PRAZO_CONFIRMACAO_MS,
  type JobWhatsApp, type ResultadoWorker, type ProtocoloWorker,
} from "./contrato";
import {
  configuracaoLembreteFormulario, MENSAGENS_LEMBRETE_FORMULARIO,
  type AmbienteLembreteFormulario,
} from "./lembrete-formulario";

export type AmbienteWhatsApp = AmbienteLembreteFormulario & {
  [chave: string]: string | undefined;
  WHATSAPP_AUTOMACAO_ATIVA?: string;
  WHATSAPP_WORKER_TOKEN?: string;
};
export function automacaoAtiva(ambiente: AmbienteWhatsApp = process.env): boolean {
  const valor = ambiente.WHATSAPP_AUTOMACAO_ATIVA?.toLowerCase();
  return valor === "1" || valor === "true";
}

export type NovaConfirmacao = { leadId: string; whatsapp: string | null; ocorridoEm: string };
export type RegistroConfirmacao = { leadId: string; recipient: string; message: string; ocorridoEm: string };
export type DependenciasRegistro = {
  ativo: () => boolean;
  agora: () => number;
  registrar: (confirmacao: RegistroConfirmacao) => Promise<void>;
  falha: () => void;
};

/**
 * Auxiliar: aguarda o INSERT idempotente, mas a falha nao desfaz o formulario.
 * Existe uma janela entre o CAS do submit e este INSERT. Nao e um trigger nem
 * uma transacao atomica com o submit; nao recupera conclusoes historicas.
 */
export async function enfileirarComDependencias(
  confirmacao: NovaConfirmacao,
  deps: DependenciasRegistro,
): Promise<void> {
  try {
    if (!deps.ativo()) return;
    const recipient = destinatarioConfirmacao(confirmacao.whatsapp);
    const ocorrido = Date.parse(confirmacao.ocorridoEm);
    const agora = deps.agora();
    if (!recipient || !Number.isFinite(ocorrido) || ocorrido > agora + 60_000 ||
      agora >= ocorrido + PRAZO_CONFIRMACAO_MS) return;
    await deps.registrar({
      leadId: confirmacao.leadId, recipient, message: MENSAGEM_CONFIRMACAO,
      ocorridoEm: confirmacao.ocorridoEm,
    });
  } catch {
    deps.falha();
  }
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
  const configAtual = (protocolo: ProtocoloWorker) => protocolo === 2
    ? configuracaoLembreteFormulario(ambiente, agora()) : null;
  const falhaLembretes = contexto.falhaLembretes ??
    (() => console.error("[whatsapp] nao consegui registrar lembretes do formulario; confirmacoes preservadas"));
  return {
    registrar: async ({ leadId, recipient, message, ocorridoEm }: RegistroConfirmacao): Promise<void> => {
      const { error } = await db.rpc("registrar_confirmacao_whatsapp", {
        p_lead_id: leadId, p_destinatario: recipient, p_mensagem: message, p_ocorrido_em: ocorridoEm,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("registro_whatsapp");
    },
    reivindicar: async (protocolo = protocoloPadrao): Promise<JobWhatsApp | null> => {
      const config = configAtual(protocolo);
      if (config) {
        try {
          const { error } = await db.rpc("enfileirar_lembretes_formulario_whatsapp_v3", {
            p_inicio_em: config.inicioEm, p_mensagens: MENSAGENS_LEMBRETE_FORMULARIO,
            p_app_url: config.appUrl,
          }).abortSignal(AbortSignal.timeout(5_000));
          if (error) throw new Error("registro_lembretes_whatsapp");
        } catch {
          falhaLembretes();
        }
      }
      // V1 permanece suficiente quando desativado, inclusive antes de aplicar o SQL novo.
      const { data, error } = await db.rpc(config ? "reivindicar_whatsapp_v3" : "reivindicar_whatsapp", config ? {
        p_lembrete_ativo: true, p_inicio_em: config.inicioEm,
      } : undefined)
        .abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("claim_whatsapp");
      return data?.[0] ? envelopeJob(data[0], protocolo) : null;
    },
    resultado: async (id: string, resultado: ResultadoWorker, protocolo = protocoloPadrao): Promise<string | null> => {
      const config = configAtual(protocolo);
      const { data, error } = await db.rpc(config ? "resultado_whatsapp_v3" : "resultado_whatsapp", {
        p_id: id, p_lease_token: resultado.leaseToken, p_outcome: resultado.outcome,
        p_code: resultado.code ?? null,
        ...(config ? { p_lembrete_ativo: true, p_inicio_em: config.inicioEm } : {}),
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
  return criarRepositorioWhatsApp(supabaseAdmin(), { protocolo }).resultado(id, resultado);
}
