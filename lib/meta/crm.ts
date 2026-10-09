import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CATEGORIAS } from "@/lib/form/types";
import { rastreioGuardado } from "@/lib/meta/rastreio";
import { configCapi, enviarConversoesConfirmadas, type EventoConversao, type ResultadoCapi } from "./conversoes";

export const NOME_CRM = "Mel Storymaker";
export const MAX_TENTATIVAS_CRM = 5;
export const PRAZO_CRM_MS = 47 * 60 * 60 * 1000;
const RESERVA_IO_MS = 20_000; // RPC5s + Meta10s + ACK5s.
const ESPERAS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

const snapshotSchema = z.object({
  categoria: z.enum(CATEGORIAS),
  email: z.string().nullable(),
  whatsapp: z.string().nullable(),
  nome: z.string().nullable(),
  rastreio: z.unknown().optional(),
});
const nomes = {
  lead_criado: "CRMLeadCriado",
  formulario_completo: "CRMFormularioCompleto",
  enviado: "CRMPropostaEnviada",
  virou_cliente: "CRMVirouCliente",
  perdido: "CRMLeadPerdido",
  qualificado: "CRMLeadQualificado",
} as const;

export type EventoFilaCrm = {
  event_id: string;
  lead_id: string;
  etapa: keyof typeof nomes;
  evento: string;
  ocorrido_em: string;
  snapshot: unknown;
  tentativas: number;
  lease_token: string;
};

/** Snapshot e timestamp ja congelados pelo claim; nunca ler contato atual aqui. */
export function montarEventoCrm(linha: EventoFilaCrm): EventoConversao | null {
  const snapshot = snapshotSchema.safeParse(linha.snapshot);
  const ocorrido = Date.parse(linha.ocorrido_em);
  if (!snapshot.success || !Number.isFinite(ocorrido) || nomes[linha.etapa] !== linha.evento ||
    linha.event_id !== `crm_${linha.etapa}_${linha.lead_id}`) return null;
  const pessoa = snapshot.data;
  return {
    nome: linha.evento,
    id: linha.event_id,
    ocorridoEm: Math.floor(ocorrido / 1000),
    origem: "system_generated",
    categoria: pessoa.categoria,
    dados: { event_source: "crm", lead_event_source: NOME_CRM },
    pessoa: {
      leadId: linha.lead_id,
      email: pessoa.email,
      whatsapp: pessoa.whatsapp,
      nome: pessoa.nome,
      ...rastreioGuardado(pessoa.rastreio),
    },
  };
}

type Finalizacao = {
  estado: "enviado" | "pendente" | "encerrado";
  erro: string | null;
  proximaTentativaEm?: string;
  enviadoEm?: string;
};

export type DependenciasFilaCrm = {
  reivindicar: (leadId?: string) => Promise<EventoFilaCrm | null>;
  finalizar: (linha: EventoFilaCrm, resultado: Finalizacao) => Promise<boolean>;
  enviar: (eventos: readonly EventoConversao[]) => Promise<ResultadoCapi>;
  agora: () => number;
};

export type ResumoFilaCrm = {
  processados: number;
  enviados: number;
  pendentes: number;
  encerrados: number;
  falhasBanco: number;
  desligada: boolean;
};

export type OpcoesFilaCrm = { leadId?: string; limite?: number; orcamentoMs?: number };

/** Uma tentativa por item/due. Nenhum sleep ou retry de rede dentro do request. */
export async function processarFilaComDependencias(
  deps: DependenciasFilaCrm,
  opcoes: OpcoesFilaCrm = {},
): Promise<ResumoFilaCrm> {
  const resumo: ResumoFilaCrm = { processados: 0, enviados: 0, pendentes: 0, encerrados: 0, falhasBanco: 0, desligada: false };
  const inicio = deps.agora();
  const limite = Math.max(1, Math.min(20, opcoes.limite ?? 20));
  const orcamento = Math.max(RESERVA_IO_MS, Math.min(45_000, opcoes.orcamentoMs ?? 45_000));
  while (resumo.processados < limite && deps.agora() - inicio <= orcamento - RESERVA_IO_MS) {
    let linha: EventoFilaCrm | null;
    try {
      linha = await deps.reivindicar(opcoes.leadId);
    } catch {
      resumo.falhasBanco++;
      break;
    }
    if (!linha) break;
    resumo.processados++;

    const agora = deps.agora();
    const evento = montarEventoCrm(linha);
    let finalizacao: Finalizacao;
    if (!evento || agora >= Date.parse(linha.ocorrido_em) + PRAZO_CRM_MS) {
      finalizacao = { estado: "encerrado", erro: evento ? "prazo_expirado" : "snapshot_invalido" };
    } else {
      let resposta: ResultadoCapi;
      try {
        resposta = await deps.enviar([evento]);
      } catch {
        resposta = { tipo: "falha", motivo: "rede", repetir: true };
      }
      if (resposta.tipo === "aceito") {
        finalizacao = { estado: "enviado", erro: null, enviadoEm: new Date(deps.agora()).toISOString() };
      } else {
        const motivo = resposta.tipo === "desligada" ? "meta_desligada" : resposta.motivo;
        const repetir = resposta.tipo === "desligada" || resposta.repetir;
        const proxima = deps.agora() + ESPERAS_MS[Math.min(Math.max(linha.tentativas - 1, 0), ESPERAS_MS.length - 1)];
        const encerrado = !repetir || linha.tentativas >= MAX_TENTATIVAS_CRM ||
          proxima >= Date.parse(linha.ocorrido_em) + PRAZO_CRM_MS;
        finalizacao = encerrado
          ? { estado: "encerrado", erro: motivo }
          : { estado: "pendente", erro: motivo, proximaTentativaEm: new Date(proxima).toISOString() };
      }
    }
    try {
      // ACK perdido: token/CAS impedem worker atrasado; a proxima tentativa usa
      // o mesmo payload/ID/time, sempre dentro da janela definida no banco.
      if (!(await deps.finalizar(linha, finalizacao))) resumo.falhasBanco++;
      else if (finalizacao.estado === "enviado") resumo.enviados++;
      else if (finalizacao.estado === "pendente") resumo.pendentes++;
      else resumo.encerrados++;
    } catch {
      resumo.falhasBanco++;
    }
  }
  return resumo;
}

function dependenciasReais(): DependenciasFilaCrm {
  return {
    agora: Date.now,
    enviar: enviarConversoesConfirmadas,
    reivindicar: async (leadId) => {
      const { data, error } = await supabaseAdmin()
        .rpc("reivindicar_meta_crm", { p_lead_id: leadId ?? null })
        .abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("claim_crm");
      return (data?.[0] as EventoFilaCrm | undefined) ?? null;
    },
    finalizar: async (linha, resultado) => {
      const { data, error } = await supabaseAdmin().from("meta_crm_outbox")
        .update({
          estado: resultado.estado,
          ultimo_erro: resultado.erro,
          lease_token: null,
          lease_ate: null,
          ...(resultado.proximaTentativaEm && { proxima_tentativa_em: resultado.proximaTentativaEm }),
          ...(resultado.enviadoEm && { enviado_em: resultado.enviadoEm }),
        })
        .eq("event_id", linha.event_id)
        .eq("lease_token", linha.lease_token)
        .eq("estado", "processando")
        .select("event_id")
        .abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("ack_crm");
      return data?.length === 1;
    },
  };
}

/** No-op sem CAPI configurada: nao consome tentativas nem expõe dado pessoal. */
export async function processarFilaCrm(opcoes: OpcoesFilaCrm = {}): Promise<ResumoFilaCrm> {
  if (!configCapi()) {
    return { processados: 0, enviados: 0, pendentes: 0, encerrados: 0, falhasBanco: 0, desligada: true };
  }
  const resumo = await processarFilaComDependencias(dependenciasReais(), opcoes);
  if (resumo.falhasBanco) console.error(`[meta-crm] fila: ${resumo.falhasBanco} falha(s) de banco`);
  return resumo;
}

/** Chamado no after das rotas; a persistencia atomica pertence ao trigger. */
export async function enviarEventosCrmDoLead(leadId: string): Promise<void> {
  try {
    await processarFilaCrm({ leadId, limite: 6 });
  } catch {
    console.error("[meta-crm] nao consegui processar a fila; cron retomara");
  }
}
