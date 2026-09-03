import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { COLUNA_LEMBRETE } from "@/lib/admin/lembretes";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

// `marcado: false` e o desfazer do toast. Existe porque o clique no botao abre o
// WhatsApp E marca de uma vez: se a Mel desistir de mandar depois de ver a
// conversa, sem o desfazer o cartao ficaria calado para sempre por um clique.
const corpo = z.object({ marco: z.union([z.literal(7), z.literal(30)]), marcado: z.boolean() });

/**
 * PATCH /api/admin/leads/[id]/lembrete -- a Mel cobrou (ou desfez a marca).
 *
 * Rota propria e nao um campo do PATCH de status: sao dois contratos
 * diferentes. Status move o lead no funil e tem matriz de transicao; isto so
 * carimba "cobrei", sem mexer em coluna nenhuma.
 *
 * O carimbo e uma AFIRMACAO DA MEL, nao prova de entrega: o wa.me abre a
 * conversa e o projeto nunca fala com a API do WhatsApp (regra 3), entao nao ha
 * como saber se a mensagem saiu. E o mesmo grau de confianca de marcar um
 * cartao como "Enviado" no quadro.
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
  const { marco, marcado } = parsed.data;

  const coluna = COLUNA_LEMBRETE[marco];
  const { data: salvo, error } = await supabaseAdmin()
    .from("leads")
    .update({ [coluna]: marcado ? new Date().toISOString() : null })
    .eq("id", id)
    .select("lembrete_7_em, lembrete_30_em")
    .maybeSingle();

  if (error) {
    console.error("[admin] falha ao marcar lembrete", error);
    return NextResponse.json({ erro: "Não consegui marcar agora." }, { status: 500 });
  }
  if (!salvo) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  // Mesma trilha de auditoria da rota de status: os logs da Vercel sao a unica
  // que existe, e cobranca e coisa que a Mel vai querer reconstituir.
  console.log(`[admin] lembrete ${marco}d ${marcado ? "marcado" : "desfeito"}: ${id}`);

  return NextResponse.json({ ok: true, ...salvo });
}
