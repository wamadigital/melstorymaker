import { NextResponse } from "next/server";
import { BUCKET_PROPOSTAS, supabaseAdmin, urlPublicaProposta } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { gerarProposta } from "@/lib/pdf/gerar";

type Ctx = { params: Promise<{ id: string }> };

// pdf-lib e puro JS, mas precisa do runtime Node (fs para ler a arte base).
export const runtime = "nodejs";
// Geracao com 3-4 paginas fica bem abaixo disso; a folga cobre arte pesada.
export const maxDuration = 60;

/**
 * POST /api/admin/leads/[id]/gerar-pdf -- RF-11 e RF-14.
 *
 * Regerar sobrescreve {leadId}.pdf no bucket. A URL fica estavel de proposito:
 * o link que a Mel ja mandou por WhatsApp continua valendo depois de uma
 * correcao de typo.
 */
export async function POST(_req: Request, { params }: Ctx) {
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;

  const { data: lead } = await supabaseAdmin()
    .from("leads")
    .select("id, categoria, respostas")
    .eq("id", id)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  try {
    const resultado = await gerarProposta(lead.categoria, lead.respostas ?? {});

    const { error: erroUpload } = await supabaseAdmin()
      .storage.from(BUCKET_PROPOSTAS)
      .upload(`${id}.pdf`, resultado.bytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (erroUpload) throw new Error(`Storage recusou o upload: ${erroUpload.message}`);

    const pdf_url = urlPublicaProposta(id);
    const pdf_gerado_em = new Date().toISOString();

    const { error: erroUpdate } = await supabaseAdmin()
      .from("leads")
      .update({ pdf_url, pdf_gerado_em })
      .eq("id", id);

    if (erroUpdate) throw new Error(erroUpdate.message);

    return NextResponse.json({
      ok: true,
      pdf_url,
      pdf_gerado_em,
      // Qual arte foi escolhida. Em aniversario isso depende da idade, entao a
      // Mel precisa poder conferir se saiu a infantil ou a de adulto.
      templateId: resultado.templateId,
      rotuloTemplate: resultado.rotuloTemplate,
      // O painel avisa a Mel quando o PDF nao esta fiel a arte final.
      usouPlaceholder: resultado.usouPlaceholder,
      usouFallbackDeFonte: resultado.usouFallbackDeFonte,
      tamanhoBytes: resultado.bytes.length,
    });
  } catch (e) {
    console.error("[admin] falha ao gerar PDF", e);
    return NextResponse.json({ erro: (e as Error).message }, { status: 500 });
  }
}
