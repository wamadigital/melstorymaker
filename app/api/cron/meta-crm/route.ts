import { NextResponse } from "next/server";
import { processarFilaCrm } from "@/lib/meta/crm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Resgate diario: envios imediatos pertencem ao after das rotas do lead. */
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET nao configurada" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "nao autorizado" }, { status: 401 });
  }
  try {
    const resumo = await processarFilaCrm({ limite: 20, orcamentoMs: 45_000 });
    return NextResponse.json({ ok: resumo.falhasBanco === 0, ...resumo }, {
      status: resumo.falhasBanco ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("[meta-crm] falha na rotina diaria");
    return NextResponse.json({ erro: "Nao consegui processar a fila" }, { status: 503 });
  }
}
