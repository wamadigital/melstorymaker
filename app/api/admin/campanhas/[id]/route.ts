import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { configuracaoCampanhas } from "@/lib/campanhas/provedor";
import { rpcCampanhas } from "@/lib/campanhas/banco";
import { acaoCampanhaSchema, paginaCampanhaSchema, type Campanha } from "@/lib/campanhas/contrato";

type Contexto = { params: Promise<{ id: string }> };

const resposta = (corpo: object, status = 200) => NextResponse.json(corpo, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function GET(req: Request, { params }: Contexto) {
  if (!await getSessaoAdmin()) return resposta({ erro: "Sessão expirada." }, 401);
  const { id } = await params;
  const pagina = paginaCampanhaSchema.safeParse(new URL(req.url).searchParams.get("pagina") ?? 0);
  if (!z.uuid().safeParse(id).success || !pagina.success) return resposta({ erro: "Consulta inválida." }, 400);
  try {
    const { opcoes, meta } = configuracaoCampanhas();
    const [campanha] = await rpcCampanhas<Campanha[]>("campanha_whatsapp_progresso", {
      p_id: id, p_pagina: pagina.data, p_limite: meta?.limite ?? 0, p_cadencia: opcoes.cadencia,
    });
    return campanha ? resposta({ campanha, opcoes }) : resposta({ erro: "Campanha não encontrada." }, 404);
  } catch {
    return resposta({ erro: "Não consegui carregar a campanha." }, 503);
  }
}

export async function PATCH(req: Request, { params }: Contexto) {
  if (!await getSessaoAdmin()) return resposta({ erro: "Sessão expirada." }, 401);
  const { id } = await params;
  const acao = acaoCampanhaSchema.safeParse((await req.json().catch(() => null))?.acao);
  if (!z.uuid().safeParse(id).success || !acao.success) return resposta({ erro: "Ação inválida." }, 400);
  try {
    const status = await rpcCampanhas<string | null>("campanha_whatsapp_controlar", { p_id: id, p_acao: acao.data });
    return status ? resposta({ status }) : resposta({ erro: "Campanha não encontrada." }, 404);
  } catch {
    return resposta({ erro: "Não consegui confirmar a ação. Confira o status e tente novamente." }, 503);
  }
}
