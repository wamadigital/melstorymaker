import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  automacaoAtiva, reivindicarWhatsApp, registrarResultadoWhatsApp,
  type AmbienteWhatsApp,
} from "./index";
import { resultadoSchema, type JobWhatsApp, type ResultadoWorker } from "./contrato";

export type DependenciasHttpWhatsApp = {
  ambiente: AmbienteWhatsApp;
  reivindicar: () => Promise<JobWhatsApp | null>;
  resultado: (id: string, resultado: ResultadoWorker) => Promise<string | null>;
};
const uuid = z.string().uuid();
const cabecalhos = { "Cache-Control": "no-store" };
const resposta = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: cabecalhos });
const reais = (): DependenciasHttpWhatsApp => ({
  ambiente: process.env, reivindicar: reivindicarWhatsApp, resultado: registrarResultadoWhatsApp,
});

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
  if (!automacaoAtiva(deps.ambiente)) return resposta({ active: false, job: null });
  try {
    return resposta({ active: true, job: await deps.reivindicar() });
  } catch {
    console.error("[whatsapp] nao consegui reivindicar a fila");
    return resposta({ erro: "Fila indisponivel" }, 503);
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
  if (parsed.data.outcome === "started" && !automacaoAtiva(deps.ambiente)) {
    return resposta({ erro: "Automacao desativada" }, 409);
  }
  try {
    const state = await deps.resultado(id, parsed.data);
    const esperados = {
      started: ["enviando"], sent: ["enviado"], indeterminate: ["indeterminado"],
      failed: ["pendente", "expirado", "indeterminado"],
    };
    if (!state) return resposta({ erro: "Lease ou estado recusado" }, 409);
    if (!esperados[parsed.data.outcome].includes(state)) throw new Error("estado_rpc_invalido");
    return resposta({ accepted: true, state });
  } catch {
    console.error("[whatsapp] nao consegui registrar o resultado");
    return resposta({ erro: "Fila indisponivel" }, 503);
  }
}
