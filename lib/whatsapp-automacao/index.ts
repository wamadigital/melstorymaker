import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  destinatarioConfirmacao, envelopeJob, MENSAGEM_CONFIRMACAO, PRAZO_CONFIRMACAO_MS,
  type JobWhatsApp, type ResultadoWorker,
} from "./contrato";
import {
  configuracaoLembreteFormulario, PREFIXO_LEMBRETE_FORMULARIO,
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

export async function enfileirarConfirmacaoWhatsApp(confirmacao: NovaConfirmacao): Promise<void> {
  await enfileirarComDependencias(confirmacao, {
    ativo: automacaoAtiva,
    agora: Date.now,
    falha: () => console.error("[whatsapp] nao consegui registrar a confirmacao; formulario preservado"),
    registrar: (registro) => criarRepositorioWhatsApp(supabaseAdmin()).registrar(registro),
  });
}

type ContextoRepositorioWhatsApp = {
  ambiente?: AmbienteWhatsApp;
  agora?: () => number;
  falhaLembretes?: () => void;
};

/** SDK real pode receber transporte, ambiente e relógio isolados nos testes. */
export function criarRepositorioWhatsApp(db: SupabaseClient, contexto: ContextoRepositorioWhatsApp = {}) {
  const ambiente: AmbienteWhatsApp = contexto.ambiente ?? process.env;
  const agora = contexto.agora ?? Date.now;
  const configAtual = () => configuracaoLembreteFormulario(ambiente, agora());
  const falhaLembretes = contexto.falhaLembretes ??
    (() => console.error("[whatsapp] nao consegui registrar lembretes do formulario; confirmacoes preservadas"));
  return {
    registrar: async ({ leadId, recipient, message, ocorridoEm }: RegistroConfirmacao): Promise<void> => {
      const { error } = await db.rpc("registrar_confirmacao_whatsapp", {
        p_lead_id: leadId, p_destinatario: recipient, p_mensagem: message, p_ocorrido_em: ocorridoEm,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("registro_whatsapp");
    },
    reivindicar: async (): Promise<JobWhatsApp | null> => {
      const config = configAtual();
      if (config) {
        try {
          const { error } = await db.rpc("enfileirar_lembretes_formulario_whatsapp", {
            p_inicio_em: config.inicioEm, p_mensagem_prefixo: PREFIXO_LEMBRETE_FORMULARIO,
            p_app_url: config.appUrl,
          }).abortSignal(AbortSignal.timeout(5_000));
          if (error) throw new Error("registro_lembretes_whatsapp");
        } catch {
          falhaLembretes();
        }
      }
      // V1 permanece suficiente quando desativado, inclusive antes de aplicar o SQL novo.
      const { data, error } = await db.rpc(config ? "reivindicar_whatsapp_v2" : "reivindicar_whatsapp", config ? {
        p_lembrete_ativo: true, p_inicio_em: config.inicioEm,
      } : undefined)
        .abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("claim_whatsapp");
      return data?.[0] ? envelopeJob(data[0]) : null;
    },
    resultado: async (id: string, resultado: ResultadoWorker): Promise<string | null> => {
      const config = configAtual();
      const { data, error } = await db.rpc(config ? "resultado_whatsapp_v2" : "resultado_whatsapp", {
        p_id: id, p_lease_token: resultado.leaseToken, p_outcome: resultado.outcome,
        p_code: resultado.code ?? null,
        ...(config ? { p_lembrete_ativo: true, p_inicio_em: config.inicioEm } : {}),
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("resultado_whatsapp");
      return typeof data === "string" ? data : null;
    },
  };
}

export async function reivindicarWhatsApp(): Promise<JobWhatsApp | null> {
  return criarRepositorioWhatsApp(supabaseAdmin()).reivindicar();
}

/** Retorna null para token/estado recusado; nunca transforma isso em ACK. */
export async function registrarResultadoWhatsApp(id: string, resultado: ResultadoWorker): Promise<string | null> {
  return criarRepositorioWhatsApp(supabaseAdmin()).resultado(id, resultado);
}
