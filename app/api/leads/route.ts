import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS } from "@/lib/form/types";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";

const corpo = z.object({ categoria: z.enum(CATEGORIAS) });

/**
 * POST /api/leads -- cria o lead na escolha da categoria (RF-02).
 *
 * Lead parcial e lead: o registro nasce aqui, antes da 2a pergunta, para que
 * abandono no meio ainda deixe dado para a Mel fazer follow-up.
 */
export async function POST(req: Request) {
  const ip = ipDaRequisicao(req);
  if (excedeuLimite(`criar:${ip}`, LIMITES.criarLead.limite, LIMITES.criarLead.janelaMs)) {
    return NextResponse.json({ erro: "Muitas tentativas. Tenta de novo em instantes." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = corpo.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Categoria inválida." }, { status: 400 });
  }

  const { categoria } = parsed.data;
  const primeiroPasso = passosVisiveis(categoria, {})[0]?.id ?? null;

  const { data, error } = await supabaseAdmin()
    .from("leads")
    .insert({ categoria, status: "incompleto", respostas: {}, passo_atual: primeiroPasso })
    .select("id, categoria, passo_atual")
    .single();

  if (error) {
    console.error("[leads] falha ao criar lead", error);
    return NextResponse.json({ erro: "Não consegui salvar agora. Tenta de novo?" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
