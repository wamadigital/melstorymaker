import { NextResponse } from "next/server";
import { autenticarWorker } from "@/lib/whatsapp-automacao/http";
import { BUCKET_CAMPANHAS, rpcCampanhas } from "@/lib/campanhas/banco";
import { configuracaoCampanhas, enviarModeloCampanha, modelosAprovados, type ResultadoCampanha } from "@/lib/campanhas/provedor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ModeloCampanha, ModoCampanha } from "@/lib/campanhas/contrato";

export const maxDuration = 60;

type Trabalho = {
  id: string; tentativa: number; telefone: string; modo: ModoCampanha;
  modelo: ModeloCampanha | null; imagem: string | null;
};

async function processar(trabalho: Trabalho, meta: ReturnType<typeof configuracaoCampanhas>["meta"]): Promise<ResultadoCampanha> {
  if (trabalho.modo === "simulacao") return { status: "simulado" };
  if (!meta || !trabalho.modelo || (trabalho.modo === "teste" && trabalho.telefone !== "5519988763916")) {
    return { status: "falha", motivo: "configuracao_provedor" };
  }

  const modelo = trabalho.modelo;
  try {
    const catalogo = await modelosAprovados(meta, modelo.nome);
    if (!catalogo.some((m) => m.nome === modelo.nome && m.idioma === modelo.idioma
      && m.texto === modelo.texto && m.imagem === modelo.imagem)) {
      return { status: "falha", motivo: "modelo_alterado" };
    }
  } catch {
    return { status: "falha", motivo: "catalogo_indisponivel" };
  }

  const db = supabaseAdmin();
  let imagem: string | undefined;
  if (trabalho.imagem) {
    const assinatura = await db.storage.from(BUCKET_CAMPANHAS).createSignedUrl(trabalho.imagem, 600);
    if (assinatura.error) return { status: "falha", motivo: "imagem_indisponivel" };
    imagem = assinatura.data.signedUrl;
  }

  const { data, error } = await db.from("campanha_whatsapp_consentimentos")
    .select("autorizado").eq("telefone", trabalho.telefone).maybeSingle();
  if (error) return { status: "falha", motivo: "consentimento_indisponivel" };
  if (!data?.autorizado) return { status: "ignorado", motivo: "consentimento_revogado" };
  return enviarModeloCampanha(meta, trabalho.telefone, trabalho.modelo, imagem);
}

export async function POST(req: Request) {
  const negado = autenticarWorker(req, process.env);
  if (negado) return negado;
  const { opcoes, meta } = configuracaoCampanhas();
  const headers = { "Cache-Control": "no-store" };
  if (!opcoes.workerAtivo) return NextResponse.json({ ativo: false }, { headers });
  try {
    const trabalho = await rpcCampanhas<Trabalho | null>("campanha_whatsapp_reivindicar", {
      p_limite: meta?.limite ?? 0, p_cadencia: opcoes.cadencia,
    });
    if (!trabalho) return NextResponse.json({ ativo: true, processado: false }, { headers });
    const resultado = await processar(trabalho, meta);
    const processado = await rpcCampanhas<boolean>("campanha_whatsapp_finalizar", {
      p_id: trabalho.id, p_tentativa: trabalho.tentativa, p_status: resultado.status,
      p_motivo: resultado.motivo ?? null, p_provedor_id: resultado.provedorId ?? null, p_espera: resultado.espera ?? 0,
    });
    return NextResponse.json({ ativo: true, processado }, { headers });
  } catch {
    return NextResponse.json({ erro: "Fila de campanhas indisponível." }, { status: 503, headers });
  }
}
