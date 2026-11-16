import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";

const CONFIG = "whatsapp_lembretes_proposta_config";
const corpo = z.object({ ativa: z.boolean() }).strict();
const resposta = (dados: unknown, status = 200) =>
  NextResponse.json(dados, { status, headers: { "Cache-Control": "no-store" } });

async function configuracao(ativa?: boolean) {
  try {
    const tabela = supabaseAdmin().from(CONFIG);
    const consulta = ativa === undefined
      ? tabela.select("ativa").eq("id", 1)
      : tabela.update({ ativa }).eq("id", 1).select("ativa");
    const { data, error } = await consulta.abortSignal(AbortSignal.timeout(5_000)).single();
    if (!error && typeof data?.ativa === "boolean") return resposta({ ativa: data.ativa });
  } catch { /* Mantém o erro interno fora da resposta. */ }
  console.error("[admin] configuração de lembretes de proposta indisponível");
  return resposta({ erro: "Não consegui acessar a configuração dos lembretes." }, 503);
}

export async function GET() {
  if (!(await getSessaoAdmin())) return resposta({ erro: "Sessão expirada." }, 401);
  return configuracao();
}

export async function PATCH(req: Request) {
  if (!(await getSessaoAdmin())) return resposta({ erro: "Sessão expirada." }, 401);
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return resposta({ erro: "Formato inválido." }, 415);
  }
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return resposta({ erro: "Configuração inválida." }, 400);
  return configuracao(parsed.data.ativa);
}
