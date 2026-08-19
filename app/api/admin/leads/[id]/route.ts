import { NextResponse } from "next/server";
import { z } from "zod";
import { BUCKET_PROPOSTAS, supabaseAdmin } from "@/lib/supabase/admin";
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
    .update({ respostas, ...colunasPromovidas(lead.categoria, respostas) })
    .eq("id", id);

  if (error) {
    console.error("[admin] falha ao salvar respostas", error);
    return NextResponse.json({ erro: "Não consegui salvar." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, respostas });
}

/**
 * DELETE /api/admin/leads/[id] -- a Mel apaga um lead pelo painel.
 *
 * Existe porque limpar a base deixou de ser tarefa de quem programa: a partir
 * de 19/08/2026 quem decide o que sai e a Mel, na tela. Apaga o PDF do Storage
 * junto -- deixar o arquivo orfao no bucket significaria que o link publico
 * continua abrindo a proposta de um lead que ela achou que tinha removido.
 *
 * Irreversivel: nao ha lixeira nem backup no plano gratuito. A confirmacao
 * mora na interface.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const { data: lead } = await supabaseAdmin()
    .from("leads")
    .select("id, nome_display")
    .eq("id", id)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  // Storage ANTES do banco: se a ordem fosse inversa e o remove falhasse, a
  // linha ja teria sumido e ninguem saberia mais qual arquivo era daquele lead.
  const { error: erroStorage } = await supabaseAdmin()
    .storage.from(BUCKET_PROPOSTAS)
    .remove([`${id}.pdf`]);

  // Lead sem proposta gerada nao tem arquivo; isso nao e falha.
  if (erroStorage) {
    console.warn(`[admin] PDF de ${id} não removido: ${erroStorage.message}`);
  }

  const { error } = await supabaseAdmin().from("leads").delete().eq("id", id);
  if (error) {
    console.error("[admin] falha ao excluir lead", error);
    return NextResponse.json({ erro: "Não consegui excluir agora." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, nome: lead.nome_display });
}
