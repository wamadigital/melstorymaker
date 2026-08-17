import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { idsValidos, limparRespostasOrfas } from "@/lib/form/engine";
import type { Respostas } from "@/lib/form/types";
import { colunasPromovidas } from "@/lib/leads";

type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({ respostas: z.record(z.string(), z.string()) });

/**
 * PATCH /api/admin/leads/[id] -- a Mel corrige as respostas antes de gerar o
 * PDF (RF-10). Diferente do autosave publico, este aceita lead em qualquer
 * status: corrigir um typo depois de enviado e caso de uso legitimo.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  // Redundante com o middleware, de proposito: se o matcher mudar um dia, a
  // rota nao fica aberta em silencio.
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Payload inválido." }, { status: 400 });
  }

  const { data: lead } = await supabaseAdmin()
    .from("leads")
    .select("id, categoria, respostas")
    .eq("id", id)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const permitidos = idsValidos(lead.categoria);
  const mescladas: Respostas = { ...((lead.respostas ?? {}) as Respostas) };
  for (const [chave, valor] of Object.entries(parsed.data.respostas)) {
    if (permitidos.has(chave)) mescladas[chave] = valor;
  }

  const respostas = limparRespostasOrfas(lead.categoria, mescladas);

  const { error } = await supabaseAdmin()
    .from("leads")
    .update({ respostas, ...colunasPromovidas(respostas) })
    .eq("id", id);

  if (error) {
    console.error("[admin] falha ao salvar respostas", error);
    return NextResponse.json({ erro: "Não consegui salvar." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, respostas });
}
