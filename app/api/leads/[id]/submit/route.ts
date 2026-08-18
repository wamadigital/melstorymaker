import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { passosVisiveis } from "@/lib/form/engine";
import { validarPassos } from "@/lib/form/validacao";
import type { Respostas } from "@/lib/form/types";
import { colunasPromovidas } from "@/lib/leads";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

/**
 * POST /api/leads/[id]/submit -- fecha o formulario (RF-07).
 *
 * Revalida tudo no servidor: a validacao do client existe para dar feedback
 * bonito, nao para garantir nada.
 */
export async function POST(req: Request, { params }: Ctx) {
  const ip = ipDaRequisicao(req);
  if (excedeuLimite(`submit:${ip}`, LIMITES.submit.limite, LIMITES.submit.janelaMs)) {
    return NextResponse.json({ erro: "Muitas tentativas. Tenta de novo em instantes." }, { status: 429 });
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const { data: lead, error: erroLeitura } = await supabaseAdmin()
    .from("leads")
    .select("id, categoria, status, respostas")
    .eq("id", id)
    .maybeSingle();

  if (erroLeitura) {
    console.error("[leads] falha ao ler lead para submit", erroLeitura);
    return NextResponse.json({ erro: "Não consegui enviar agora." }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  // Reenvio do mesmo formulario (duplo clique, retomada) nao e erro: se ja
  // passou por aqui, o estado desejado ja existe.
  if (lead.status !== "incompleto") {
    return NextResponse.json({ ok: true, status: lead.status });
  }

  const respostas = (lead.respostas ?? {}) as Respostas;
  const erros = validarPassos(passosVisiveis(lead.categoria, respostas), respostas);

  if (Object.keys(erros).length > 0) {
    return NextResponse.json(
      { erro: "Faltou responder alguma coisa.", campos: erros },
      { status: 422 },
    );
  }

  const { error } = await supabaseAdmin()
    .from("leads")
    .update({ status: "aguardando_revisao", ...colunasPromovidas(lead.categoria, respostas) })
    .eq("id", id)
    .eq("status", "incompleto");

  if (error) {
    console.error("[leads] falha no submit", error);
    return NextResponse.json({ erro: "Não consegui enviar agora." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "aguardando_revisao" });
}
