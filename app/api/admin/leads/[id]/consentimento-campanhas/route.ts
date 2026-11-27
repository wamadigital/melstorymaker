import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { consentimentoCampanhaSchema } from "@/lib/campanhas/contrato";
import { normalizarNumero } from "@/lib/whatsapp";
import { validarTelefoneBr } from "@/lib/form/validacao";

type Contexto = { params: Promise<{ id: string }> };
const resposta = (corpo: object, status = 200) => NextResponse.json(corpo, {
  status, headers: { "Cache-Control": "no-store" },
});

async function contato(params: Contexto["params"]) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabaseAdmin().from("leads").select("whatsapp").eq("id", id).maybeSingle();
  if (error) throw new Error("consulta do contato");
  if (!data?.whatsapp || validarTelefoneBr(data.whatsapp)) return null;
  return normalizarNumero(data.whatsapp);
}

export async function GET(_req: Request, { params }: Contexto) {
  if (!await getSessaoAdmin()) return resposta({ erro: "Sessão expirada." }, 401);
  try {
    const telefone = await contato(params);
    if (!telefone) return resposta({ erro: "O card precisa ter um WhatsApp válido." }, 422);
    const { data, error } = await supabaseAdmin().from("campanha_whatsapp_consentimentos")
      .select("autorizado,evidencia,registrado_em").eq("telefone", telefone).maybeSingle();
    if (error) throw new Error("consulta do consentimento");
    return resposta({ telefone, consentimento: data });
  } catch {
    return resposta({ erro: "Não consegui carregar o consentimento de campanhas." }, 503);
  }
}

export async function PUT(req: Request, { params }: Contexto) {
  const admin = await getSessaoAdmin();
  if (!admin) return resposta({ erro: "Sessão expirada." }, 401);
  const dados = consentimentoCampanhaSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return resposta({ erro: "Informe a origem da autorização ou do pedido de descadastro." }, 422);
  try {
    const telefone = await contato(params);
    if (!telefone || telefone !== dados.data.telefone) {
      return resposta({ erro: "O telefone do card mudou. Reabra o registro de consentimento." }, 409);
    }
    const gravado = await supabaseAdmin().from("campanha_whatsapp_consentimentos")
      .upsert({ ...dados.data, registrado_por: admin.id, registrado_em: new Date().toISOString() })
      .select("autorizado,evidencia,registrado_em").single();
    if (gravado.error) throw new Error("gravação do consentimento");
    return resposta({ telefone, consentimento: gravado.data });
  } catch {
    return resposta({ erro: "Não consegui salvar o consentimento." }, 503);
  }
}
