import { NextResponse } from "next/server";
import { BUCKET_PROPOSTAS, supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { criarMailAdapter } from "@/lib/mail/adapter";
import { LIMITE_ANEXO_BYTES, montarEmail, NOME_ANEXO } from "@/lib/mail/templates";
import { nomeContato, nomeDisplay } from "@/lib/leads";
import { linkWhatsAppMel } from "@/lib/whatsapp";
import type { Lead } from "@/lib/form/types";

type Ctx = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/leads/[id]/enviar -- RF-12.
 *
 * Human-in-the-loop: e a UNICA porta de saida de e-mail para o lead, e so abre
 * por clique da Mel no painel. Nao existe envio automatico apos o submit.
 */
export async function POST(_req: Request, { params }: Ctx) {
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;

  const { data } = await supabaseAdmin()
    .from("leads")
    .select("id, categoria, status, respostas, nome_display, email, pdf_url")
    .eq("id", id)
    .maybeSingle();

  const lead = data as Pick<
    Lead,
    "id" | "categoria" | "status" | "respostas" | "nome_display" | "email" | "pdf_url"
  > | null;

  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }
  if (!lead.email) {
    return NextResponse.json({ erro: "Esse lead não deixou e-mail." }, { status: 422 });
  }
  if (!lead.pdf_url) {
    return NextResponse.json({ erro: "Gere a proposta antes de enviar." }, { status: 422 });
  }

  try {
    // Baixa do Storage em vez de regerar: o anexo fica identico, byte a byte,
    // ao PDF que a Mel acabou de conferir no preview e ao que esta no link.
    const { data: arquivo, error: erroDownload } = await supabaseAdmin()
      .storage.from(BUCKET_PROPOSTAS)
      .download(`${id}.pdf`);

    if (erroDownload || !arquivo) {
      throw new Error(`Não encontrei o PDF no Storage: ${erroDownload?.message ?? "sem arquivo"}`);
    }

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    // Acima do limite o anexo cai e vai so o link (mitigacao do PRD secao 16).
    const comAnexo = bytes.length <= LIMITE_ANEXO_BYTES;

    const email = montarEmail(lead.categoria, {
      nomeContato: nomeContato(lead.respostas ?? {}),
      nomeDisplay: nomeDisplay(lead),
      pdfUrl: lead.pdf_url,
      linkWhatsAppMel: linkWhatsAppMel(env.MEL_WHATSAPP),
      comAnexo,
    });

    const mail = await criarMailAdapter();
    await mail.send({
      to: lead.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: comAnexo ? [{ filename: NOME_ANEXO, content: bytes }] : undefined,
    });

    const enviado_em = new Date().toISOString();
    const { error } = await supabaseAdmin()
      .from("leads")
      .update({ status: "enviado", enviado_em })
      .eq("id", id);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      enviado_em,
      comAnexo,
      // Em dry run nada saiu de verdade: o painel precisa dizer isso.
      dryRun: env.MAIL_DRY_RUN,
    });
  } catch (e) {
    console.error("[admin] falha ao enviar e-mail", e);
    return NextResponse.json({ erro: (e as Error).message }, { status: 500 });
  }
}
