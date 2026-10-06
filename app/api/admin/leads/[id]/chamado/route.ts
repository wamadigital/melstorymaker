import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

const corpo = z.object({ chamado: z.boolean() });

/**
 * PATCH /api/admin/leads/[id]/chamado -- a caixa "ja chamei" ao lado do
 * "Chamar no WhatsApp", nos cartoes de "Novo" (ver `lib/admin/chamado.ts`).
 *
 * Rota propria, como a do lembrete: e uma marca da Mel, nao um movimento no
 * funil, e nao mexe em status. So vale em "Novo", onde o botao existe -- fora
 * dali o lead ja terminou o formulario e a acao certa e outra.
 *
 * O carimbo e AFIRMACAO da Mel, nao prova de contato: o wa.me so abre a
 * conversa, e o projeto nunca fala com a API do WhatsApp (regra 3).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  // Redundante com o middleware, de proposito: se o matcher mudar um dia, a
  // rota nao fica aberta em silencio.
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Payload inválido." }, { status: 400 });
  }
  const { chamado } = parsed.data;

  const db = supabaseAdmin();
  const { data: salvo, error } = await db
    .from("leads")
    .update({ chamado_whatsapp_em: chamado ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("status", "incompleto")
    .select("chamado_whatsapp_em")
    .maybeSingle();

  if (error) {
    console.error("[admin] falha ao marcar 'ja chamei'", error);
    return NextResponse.json({ erro: "Não consegui marcar agora." }, { status: 500 });
  }

  if (!salvo) {
    // Nenhuma linha: ou o lead nao existe, ou saiu de "Novo" enquanto a Mel
    // olhava o quadro (terminou o formulario, ou foi movido em outra aba).
    const { data: existe } = await db.from("leads").select("id").eq("id", id).maybeSingle();
    return existe
      ? NextResponse.json(
          { erro: "Esse lead já saiu de Novo. Atualizei a página." },
          { status: 409 },
        )
      : NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  // Mesma trilha de auditoria do lembrete: os logs da Vercel sao a unica.
  console.log(`[admin] whatsapp ${chamado ? "marcado como chamado" : "desmarcado"}: ${id}`);

  return NextResponse.json({ ok: true, ...salvo });
}
