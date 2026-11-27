import { NextResponse } from "next/server";
import { z } from "zod";
import { autenticarWorker } from "@/lib/whatsapp-automacao/http";
import { rpcCampanhas } from "@/lib/campanhas/banco";
import { configuracaoCampanhas } from "@/lib/campanhas/config";
import type { ModoCampanha } from "@/lib/campanhas/contrato";

const protocolo = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("reivindicar"), conectado: z.boolean() }),
  z.object({
    acao: z.literal("resultado"), id: z.uuid(), tentativa: z.number().int().min(1).max(2_147_483_647),
    resultado: z.enum(["enviado", "indeterminado", "expirado"]),
  }),
]);

type Trabalho = {
  id: string; tentativa: number; recipient: string; modo: ModoCampanha; message: string; expiresAt: string;
};
const headers = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const negado = autenticarWorker(req, process.env);
  if (negado) return negado;
  // O worker anterior só envia {}. Ele não recebe dados de destinatários.
  const parsed = protocolo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ativo: false }, { headers });
  const dados = parsed.data;
  const opcoes = configuracaoCampanhas();
  try {
    if (dados.acao === "resultado") {
      const confirmado = await rpcCampanhas<boolean>("campanha_whatsapp_resultado_worker", {
        p_id: dados.id, p_tentativa: dados.tentativa, p_resultado: dados.resultado,
      });
      return NextResponse.json({ confirmado }, { headers });
    }
    if (!opcoes.workerAtivo) return NextResponse.json({ ativo: false }, { headers });
    const trabalho = await rpcCampanhas<Trabalho | null>("campanha_whatsapp_reivindicar", {
      p_limite: Number(dados.conectado && opcoes.enviosAtivos), p_cadencia: opcoes.cadencia,
    });
    if (trabalho?.modo === "simulacao") {
      await rpcCampanhas<boolean>("campanha_whatsapp_finalizar", {
        p_id: trabalho.id, p_tentativa: trabalho.tentativa, p_status: "simulado",
        p_motivo: null, p_provedor_id: null, p_espera: 0,
      });
      return NextResponse.json({ ativo: true, trabalho: null, processado: true }, { headers });
    }
    return NextResponse.json({ ativo: true, trabalho }, { headers });
  } catch {
    return NextResponse.json({ erro: "Fila de campanhas indisponível." }, { status: 503, headers });
  }
}
