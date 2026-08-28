import { NextResponse } from "next/server";
import {
  BUCKET_PROPOSTAS,
  garantirSlug,
  supabaseAdmin,
  urlPublicaProposta,
} from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { ArteFaltandoError, CamposFaltandoError, gerarProposta } from "@/lib/pdf/gerar";

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

    // O slug nasce aqui, na primeira geracao, e nunca muda: e ele que mantem
    // o link estavel quando a Mel regera o PDF depois de corrigir algo.
    const pdf_url = urlPublicaProposta(await garantirSlug(id));
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
      // Qual tabela de preco saiu. Depende do ano do evento, entao a Mel
      // confere na hora se a proposta foi precificada no ano certo.
      tabelaPreco: resultado.tabelaPreco,
      // O painel avisa a Mel quando o PDF nao esta fiel a arte final.
      usouPlaceholder: resultado.usouPlaceholder,
      usouFallbackDeFonte: resultado.usouFallbackDeFonte,
      tamanhoBytes: resultado.bytes.length,
    });
  } catch (e) {
    // Dado faltando nao e falha do sistema: e algo que a Mel resolve na tela.
    // 422 com a lista, para o painel dizer exatamente o que preencher.
    if (e instanceof CamposFaltandoError) {
      return NextResponse.json(
        { erro: "Faltam respostas para gerar a proposta.", campos: e.campos },
        { status: 422 },
      );
    }

    // Falta o ASSET da tabela de preco daquele ano -- nao ha o que a Mel digite
    // para resolver. O caminho do arquivo fica no log; a tela recebe o recado
    // em portugues, e nada e gravado: melhor nao gerar do que gerar com o
    // preco do ano errado.
    if (e instanceof ArteFaltandoError) {
      console.error("[admin] arte ausente ao gerar PDF", e.message);
      return NextResponse.json(
        {
          erro:
            `A arte com os preços da ${e.tabela} ainda não foi publicada no sistema. ` +
            `Enquanto isso, nenhuma proposta com data em ${e.tabela} pode ser gerada.`,
        },
        { status: 409 },
      );
    }

    console.error("[admin] falha ao gerar PDF", e);
    return NextResponse.json({ erro: (e as Error).message }, { status: 500 });
  }
}
