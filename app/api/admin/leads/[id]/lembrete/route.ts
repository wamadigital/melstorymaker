import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { solicitarLembreteProposta } from "@/lib/whatsapp-automacao/solicitar-proposta";

type Ctx = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();
const corpo = z.object({ marco: z.union([z.literal(7), z.literal(30)]) }).strict();
const headers = { "Cache-Control": "no-store" };

/** Um clique autorizado registra uma tentativa; apenas o ACK marca envio. */
export async function POST(req: Request, { params }: Ctx) {
  const sessao = await getSessaoAdmin();
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401, headers });
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404, headers });
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Payload inválido." }, { status: 400, headers });
  try {
    const resultado = await solicitarLembreteProposta(supabaseAdmin(), { id, marco: parsed.data.marco, solicitante: sessao.id });
    return NextResponse.json(resultado.corpo, { status: resultado.status, headers });
  } catch {
    console.error("[admin] falha ao solicitar lembrete WhatsApp");
    return NextResponse.json({ erro: "Não consegui solicitar o envio agora.", codigo: "fila_indisponivel" }, { status: 503, headers });
  }
}
