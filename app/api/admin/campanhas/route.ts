import { NextResponse } from "next/server";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { BUCKET_CAMPANHAS, rpcCampanhas } from "@/lib/campanhas/banco";
import {
  chaveModeloCampanha, consultaPublicoSchema, iniciarCampanhaSchema, MAX_IMAGEM_CAMPANHA, paginaCampanhaSchema,
  type Campanha, type PublicoCampanha,
} from "@/lib/campanhas/contrato";
import { configuracaoCampanhas, modelosAprovados } from "@/lib/campanhas/provedor";

export const maxDuration = 60;

const resposta = (corpo: object, status = 200) => NextResponse.json(corpo, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function GET(req: Request) {
  if (!await getSessaoAdmin()) return resposta({ erro: "Sessão expirada." }, 401);
  const params = new URL(req.url).searchParams;
  const { opcoes, meta } = configuracaoCampanhas();
  try {
    if (params.has("modelos")) {
      if (!meta) return resposta({ erro: "Provedor de campanhas indisponível." }, 503);
      return resposta({ modelos: await modelosAprovados(meta) });
    }
    const pagina = paginaCampanhaSchema.safeParse(params.get("pagina") ?? 0);
    if (!pagina.success) return resposta({ erro: "Página inválida." }, 400);
    const campanhas = await rpcCampanhas<Campanha[]>("campanha_whatsapp_progresso", {
      p_id: null, p_pagina: pagina.data, p_limite: meta?.limite ?? 0, p_cadencia: opcoes.cadencia,
    });
    return resposta({ campanhas: campanhas.slice(0, 25), mais: campanhas.length > 25, opcoes });
  } catch {
    return resposta({ erro: "Não consegui carregar as campanhas ou os modelos." }, 503);
  }
}

export async function POST(req: Request) {
  const admin = await getSessaoAdmin();
  if (!admin) return resposta({ erro: "Sessão expirada." }, 401);
  if (req.headers.get("content-type")?.startsWith("application/json")) {
    const consulta = consultaPublicoSchema.safeParse(await req.json().catch(() => null));
    if (!consulta.success) return resposta({ erro: consulta.error.issues[0].message }, 422);
    try {
      return resposta(await rpcCampanhas<PublicoCampanha>("campanha_whatsapp_publico", {
        p_filtros: consulta.data.filtros, p_modo: consulta.data.modo, p_pagina: consulta.data.pagina,
      }));
    } catch {
      return resposta({ erro: "Não consegui calcular o público da campanha." }, 503);
    }
  }

  const form = await req.formData().catch(() => null);
  let dados: unknown;
  try {
    dados = JSON.parse(String(form?.get("campanha")));
  } catch {
    return resposta({ erro: "Campanha inválida." }, 400);
  }
  const campanha = iniciarCampanhaSchema.safeParse(dados);
  if (!campanha.success) return resposta({ erro: campanha.error.issues[0].message }, 422);
  const { id, nome, modo, mensagens, modelosEscolhidos, filtros, revisao, intervalo } = campanha.data;
  const imagem = form?.get("imagem") ?? null;
  const { opcoes, meta } = configuracaoCampanhas();

  try {
    const db = supabaseAdmin();
    const existente = await db.from("campanhas_whatsapp").select("id").eq("id", id).maybeSingle();
    if (existente.error) throw new Error("campanha existente");
    if (existente.data) return resposta({ id });
    if (!opcoes.workerAtivo) return resposta({ erro: "O worker de campanhas está desativado." }, 503);
    if (modo !== "simulacao" && !meta) return resposta({ erro: "O provedor de WhatsApp está sem configuração." }, 503);

    if (imagem !== null && (!(imagem instanceof File) || imagem.size > MAX_IMAGEM_CAMPANHA
      || !["image/png", "image/jpeg"].includes(imagem.type))) {
      return resposta({ erro: "Use uma imagem PNG ou JPEG de até 3 MB." }, 422);
    }
    const arquivo = imagem instanceof File ? new Uint8Array(await imagem.arrayBuffer()) : null;
    if (arquivo && imagem instanceof File) {
      const assinatura = imagem.type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
      if (!assinatura.every((byte, i) => arquivo[i] === byte)) {
        return resposta({ erro: "O conteúdo da imagem não corresponde ao formato informado." }, 422);
      }
    }

    const catalogo = modo !== "simulacao" && meta ? await modelosAprovados(meta) : [];
    const modelos = mensagens.map((texto, i) => {
      const candidatos = catalogo.filter((m) => m.imagem === !!arquivo && m.texto === texto);
      return modelosEscolhidos[i] ? candidatos.find((m) => chaveModeloCampanha(m) === modelosEscolhidos[i])
        : candidatos.length === 1 ? candidatos[0] : undefined;
    });
    if (modo !== "simulacao" && modelos.some((m) => !m)) {
      return resposta({ erro: "Cada mensagem precisa corresponder a um modelo de marketing aprovado, com o mesmo tipo de imagem." }, 422);
    }

    const storage = db.storage.from(BUCKET_CAMPANHAS);
    let caminho: string | null = null;
    if (arquivo && imagem instanceof File) {
      caminho = `${id}/${crypto.randomUUID()}`;
      const upload = await storage.upload(caminho, arquivo, { contentType: imagem.type });
      if (upload.error) throw new Error("upload da imagem");
    }

    // Se a resposta do banco se perder, o objeto pode pertencer à campanha já salva.
    const resultado = await rpcCampanhas<string>("campanha_whatsapp_iniciar", {
      p_id: id, p_autor: admin.id, p_nome: nome, p_modo: modo, p_filtros: filtros,
      p_revisao: revisao, p_mensagens: mensagens, p_modelos: modo === "simulacao" ? [] : modelos,
      p_imagem: caminho, p_intervalo: intervalo,
    });
    if (caminho && resultado !== "criada") await storage.remove([caminho]).catch(() => null);
    if (resultado === "criada" || resultado === "existente") return resposta({ id });
    return resposta({ erro: resultado === "publico_alterado"
      ? "O público mudou. Atualize a prévia e confira os destinatários novamente."
      : "A campanha precisa de pelo menos um destinatário apto." }, 409);
  } catch {
    return resposta({ erro: "Não consegui confirmar o início. Tente novamente nesta tela para recuperar a mesma campanha." }, 503);
  }
}
