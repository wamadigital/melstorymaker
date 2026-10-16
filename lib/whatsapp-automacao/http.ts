import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  reivindicarWhatsApp, registrarResultadoWhatsApp,
  type AmbienteWhatsApp,
} from "./index";
import {
  HEADER_PROTOCOLO_WORKER, resultadoSchema, validarJobWorker,
  type JobWhatsApp, type ResultadoWorker, type ProtocoloWorker,
} from "./contrato";
import { configuracaoLembreteFormulario } from "./lembrete-formulario";
import { lembretesPropostaAtivos } from "./lembretes-proposta";
import { propostaInicialAtiva } from "./proposta-inicial";

export type DependenciasHttpWhatsApp = {
  ambiente: AmbienteWhatsApp;
  reivindicar: (protocolo?: ProtocoloWorker) => Promise<JobWhatsApp | null>;
  resultado: (id: string, resultado: ResultadoWorker, protocolo?: ProtocoloWorker) => Promise<string | null>;
  agora?: () => number;
};
const uuid = z.string().uuid();
const cabecalhos = { "Cache-Control": "no-store" };
const resposta = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: cabecalhos });
const reais = (): DependenciasHttpWhatsApp => ({
  ambiente: process.env, reivindicar: reivindicarWhatsApp, resultado: registrarResultadoWhatsApp,
});
export function protocoloWorker(req: Request): ProtocoloWorker {
  const valor = req.headers.get(HEADER_PROTOCOLO_WORKER);
  return valor === "5" ? 5 : valor === "4" ? 4 : valor === "3" ? 3 : valor === "2" ? 2 : 1;
}

function autenticar(req: Request, ambiente: AmbienteWhatsApp): Response | null {
  const token = ambiente.WHATSAPP_WORKER_TOKEN;
  if (!token || token.length < 32) return resposta({ erro: "Worker nao configurado" }, 503);
  const recebido = req.headers.get("authorization") ?? "";
  const hash = (valor: string) => createHash("sha256").update(valor).digest();
  if (!timingSafeEqual(hash(recebido), hash(`Bearer ${token}`))) {
    return resposta({ erro: "Nao autorizado" }, 401);
  }
  return null;
}

export async function tratarReivindicacao(req: Request, deps = reais()): Promise<Response> {
  const recusa = autenticar(req, deps.ambiente);
  if (recusa) return recusa;
  const protocolo = protocoloWorker(req);
  const config = protocolo >= 5
    ? configuracaoLembreteFormulario(deps.ambiente, (deps.agora ?? Date.now)()) : null;
  const propostas = protocolo >= 3 && lembretesPropostaAtivos(deps.ambiente);
  const inicial = protocolo >= 4 && propostaInicialAtiva(deps.ambiente);
  const detalhes = protocolo >= 2 ? {
    protocolVersion: protocolo,
    reminderActive: config !== null,
    ...(protocolo >= 3 ? { proposalReminderActive: propostas } : {}),
    ...(protocolo >= 4 ? { proposalInitialActive: inicial } : {}),
  } : {};
  if (!config && !propostas && !inicial) return resposta({ active: false, job: null, ...detalhes });
  try {
    const job = await deps.reivindicar(protocolo);
    return resposta({ active: true, job: job ? validarJobWorker(job, protocolo, (deps.agora ?? Date.now)()) : null, ...detalhes });
  } catch {
    console.error("[whatsapp] nao consegui reivindicar a fila");
    return resposta({ erro: "Fila indisponivel", ...detalhes }, 503);
  }
}

export async function tratarResultado(
  req: Request, id: string, deps = reais(),
): Promise<Response> {
  const recusa = autenticar(req, deps.ambiente);
  if (recusa) return recusa;
  if (!uuid.safeParse(id).success) return resposta({ erro: "Job invalido" }, 400);
  let corpo: unknown;
  try {
    const texto = await req.text();
    corpo = texto.length <= 1024 ? JSON.parse(texto) : null;
  } catch { corpo = null; }
  const parsed = resultadoSchema.safeParse(corpo);
  if (!parsed.success) return resposta({ erro: "Resultado invalido" }, 400);
  // Desligar bloqueia novos envios, mas aceita ACK/indeterminado dos ja iniciados.
  const protocolo = protocoloWorker(req);
  if (parsed.data.activity && protocolo < 3) return resposta({ erro: "Protocolo invalido" }, 400);
  if (parsed.data.outcome === "started" && (protocolo < 2 ||
    (!(protocolo >= 5 && configuracaoLembreteFormulario(deps.ambiente, (deps.agora ?? Date.now)())) &&
      !(protocolo >= 3 && lembretesPropostaAtivos(deps.ambiente)) &&
      !(protocolo >= 4 && propostaInicialAtiva(deps.ambiente))))) {
    return resposta({ erro: "Automacao desativada" }, 409);
  }
  try {
    const state = await deps.resultado(id, parsed.data, protocolo);
    const esperados = {
      started: ["enviando"], sent: ["enviado"], indeterminate: ["indeterminado"],
      failed: ["pendente", "expirado", "indeterminado", "cancelado"],
    };
    if (!state) return resposta({ erro: "Lease ou estado recusado" }, 409);
    if (!esperados[parsed.data.outcome].includes(state)) throw new Error("estado_rpc_invalido");
    return resposta({ accepted: true, state });
  } catch {
    console.error("[whatsapp] nao consegui registrar o resultado");
    return resposta({ erro: "Fila indisponivel" }, 503);
  }
}
