import { NextResponse } from "next/server";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rpcCampanhas } from "@/lib/campanhas/banco";
import {
  consultaPublicoSchema, iniciarCampanhaSchema, LIMITE_PAGINA_CAMPANHAS, paginaCampanhaSchema,
  type Campanha, type PublicoCampanha,
} from "@/lib/campanhas/contrato";
import { configuracaoCampanhas } from "@/lib/campanhas/config";

const resposta = (corpo: object, status = 200) => NextResponse.json(corpo, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function GET(req: Request) {
  if (!await getSessaoAdmin()) return resposta({ erro: "Sessão expirada." }, 401);
  const params = new URL(req.url).searchParams;
  const opcoes = configuracaoCampanhas();
  const pagina = paginaCampanhaSchema.safeParse(params.get("pagina") ?? 0);
  if (!pagina.success) return resposta({ erro: "Página inválida." }, 400);
  try {
    const campanhas = await rpcCampanhas<Campanha[]>("campanha_whatsapp_progresso", {
      p_id: null, p_pagina: pagina.data, p_limite: Number(opcoes.enviosAtivos), p_cadencia: opcoes.cadencia,
    });
    return resposta({
      campanhas: campanhas.slice(0, LIMITE_PAGINA_CAMPANHAS),
      mais: campanhas.length > LIMITE_PAGINA_CAMPANHAS,
      opcoes,
    });
  } catch {
    return resposta({ erro: "Não consegui carregar as campanhas." }, 503);
  }
}

export async function POST(req: Request) {
  const admin = await getSessaoAdmin();
  if (!admin) return resposta({ erro: "Sessão expirada." }, 401);
  const dados = await req.json().catch(() => null);
  const opcoes = configuracaoCampanhas();
  if (dados?.acao === "teste") return resposta({ erro: "Atualize a página para abrir o envio de campanhas." }, 410);
  if (dados?.acao !== "iniciar") {
    const consulta = consultaPublicoSchema.safeParse(dados);
    if (!consulta.success) return resposta({ erro: consulta.error.issues[0].message }, 422);
    try {
      return resposta(await rpcCampanhas<PublicoCampanha>("campanha_whatsapp_publico", {
        p_filtros: consulta.data.filtros, p_modo: consulta.data.modo, p_pagina: consulta.data.pagina,
      }));
    } catch {
      return resposta({ erro: "Não consegui calcular o público da campanha." }, 503);
    }
  }

  const campanha = iniciarCampanhaSchema.safeParse(dados);
  if (!campanha.success) return resposta({ erro: campanha.error.issues[0].message }, 422);
  const { id, nome, modo, mensagens, filtros, revisao, intervalo, autorizacaoConfirmada } = campanha.data;
  try {
    const existente = await supabaseAdmin().from("campanhas_whatsapp").select("id").eq("id", id).maybeSingle();
    if (existente.error) throw new Error("campanha existente");
    if (existente.data) return resposta({ id });
    if (!opcoes.enviosAtivos) {
      return resposta({ erro: "Os envios de campanha estão pausados." }, 503);
    }
    const resultado = await rpcCampanhas<string>("campanha_whatsapp_iniciar", {
      p_id: id, p_autor: admin.id, p_nome: nome, p_modo: modo, p_filtros: { ...filtros, autorizacaoConfirmada },
      p_revisao: revisao, p_mensagens: mensagens, p_modelos: [], p_imagem: null, p_intervalo: intervalo,
    });
    if (resultado === "criada" || resultado === "existente") return resposta({ id });
    if (resultado === "confirmacao_necessaria") return resposta({ erro: "Confirme a autorização dos contatos na revisão." }, 422);
    return resposta({ erro: resultado === "publico_alterado"
      ? "O público mudou. Atualize a prévia e confira os destinatários novamente."
      : "A campanha precisa de pelo menos um destinatário apto." }, 409);
  } catch {
    return resposta({ erro: "Não consegui confirmar o início. Tente novamente nesta tela para recuperar a mesma campanha." }, 503);
  }
}
