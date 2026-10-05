import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { criarMailAdapter } from "@/lib/mail/adapter";
import { montarEmailLembrete } from "@/lib/mail/templates";
import { estadoLembreteEmail } from "@/lib/admin/lembrete-email";
import { caminhoContinuar } from "@/lib/form/retomada";
import { nomeDisplay, primeiroNome } from "@/lib/leads";
import { dataHoraLocal } from "@/lib/pdf/formatadores";
import { linkWhatsAppMel } from "@/lib/whatsapp";
import type { Lead } from "@/lib/form/types";

type Ctx = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

const uuid = z.string().uuid();

type LeadLembrete = Pick<
  Lead,
  "id" | "categoria" | "status" | "respostas" | "nome_display" | "email" | "lembrete_email_em"
>;

/**
 * POST /api/admin/leads/[id]/lembrete-email -- a Mel chama de volta, por
 * e-mail, quem parou no meio do formulario.
 *
 * Sai SO pelo clique da Mel no botao do quadro (regra 4): nao existe lembrete
 * automatico nem agendado. Recusa fora de "Novo", sem e-mail e antes de 7 dias
 * do lembrete anterior -- a mesma conta do botao (`estadoLembreteEmail`),
 * repetida aqui porque botao desabilitado nao e trava.
 *
 * Nao mexe em status: o lead continua em "Novo", e e o formulario, se ele
 * voltar e terminar, que o leva para "Aguardando revisao".
 */
export async function POST(_req: Request, { params }: Ctx) {
  // Redundante com o middleware, de proposito: se o matcher mudar um dia, a
  // rota nao fica aberta em silencio.
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data, error: erroLeitura } = await db
    .from("leads")
    .select("id, categoria, status, respostas, nome_display, email, lembrete_email_em")
    .eq("id", id)
    .maybeSingle();

  if (erroLeitura) {
    console.error("[admin] falha ao ler lead para o lembrete por e-mail", erroLeitura);
    return NextResponse.json({ erro: "Não consegui carregar o lead agora." }, { status: 500 });
  }
  const lead = data as LeadLembrete | null;
  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }
  if (lead.status !== "incompleto") {
    return NextResponse.json(
      { erro: "Esse lead já saiu de Novo: o lembrete por e-mail é só para quem parou no formulário." },
      { status: 409 },
    );
  }
  if (!lead.email) {
    return NextResponse.json({ erro: "Esse lead não deixou e-mail." }, { status: 422 });
  }

  const agora = Date.now();
  const estado = estadoLembreteEmail(lead, lead.status, agora);
  if (estado.visivel && !estado.liberado) {
    return NextResponse.json(
      {
        erro: `Esse lead já recebeu um lembrete em ${dataHoraLocal(estado.ultimoEm)}. O próximo libera em ${dataHoraLocal(estado.liberaEm)}.`,
        lembrete_email_em: estado.ultimoEm,
      },
      { status: 409 },
    );
  }

  // Carimba ANTES de enviar, numa escrita condicional sobre o valor que acabou
  // de ser lido. Dois cliques seguidos, ou duas abas, chegam aqui com o mesmo
  // `lembrete_email_em`: so um acha a linha, e o outro recebe 409 em vez de
  // mandar um segundo e-mail. Enviar primeiro e carimbar depois deixaria essa
  // janela aberta durante todo o SMTP.
  const carimbo = new Date(agora).toISOString();
  const anterior = lead.lembrete_email_em;
  const reserva = db
    .from("leads")
    .update({ lembrete_email_em: carimbo })
    .eq("id", id)
    .eq("status", "incompleto");
  const { data: reservado, error: erroReserva } = await (
    anterior ? reserva.eq("lembrete_email_em", anterior) : reserva.is("lembrete_email_em", null)
  )
    .select("id")
    .maybeSingle();

  if (erroReserva) {
    console.error("[admin] falha ao reservar o lembrete por e-mail", erroReserva);
    return NextResponse.json({ erro: "Não consegui enviar agora. Tenta de novo?" }, { status: 500 });
  }
  if (!reservado) {
    return NextResponse.json(
      { erro: "Esse lead mudou enquanto você enviava. Recarregue a página." },
      { status: 409 },
    );
  }

  try {
    const email = montarEmailLembrete(lead.categoria, {
      primeiroNome: primeiroNome(lead),
      nomeDisplay: nomeDisplay(lead),
      linkContinuar: `${env.APP_URL.replace(/\/+$/, "")}${caminhoContinuar(id)}`,
      linkWhatsAppMel: linkWhatsAppMel(env.MEL_WHATSAPP),
    });

    const mail = await criarMailAdapter();
    await mail.send({ to: lead.email, subject: email.subject, html: email.html, text: email.text });
  } catch (e) {
    // O e-mail nao saiu: devolve a trava, senao o botao ficaria 7 dias dizendo
    // "Lembrete enviado". Condicional ao NOSSO carimbo, para nao apagar o de
    // um envio que outra aba tenha feito depois.
    const { error: erroDesfazer } = await db
      .from("leads")
      .update({ lembrete_email_em: anterior })
      .eq("id", id)
      .eq("lembrete_email_em", carimbo);
    if (erroDesfazer) {
      console.error(`[admin] lembrete por e-mail ${id}: não consegui destravar o botão`, erroDesfazer);
    }

    // O erro tecnico (SMTP, credencial) fica no log; na tela ele nao ajuda a
    // Mel em nada.
    console.error(`[admin] falha ao enviar lembrete por e-mail: ${id}`, e);
    return NextResponse.json(
      { erro: "Não consegui enviar o e-mail agora. Tenta de novo em instantes." },
      { status: 502 },
    );
  }

  // Trilha de auditoria: os logs da Vercel sao a unica que existe.
  console.log(`[admin] lembrete por e-mail enviado: ${id}`);

  return NextResponse.json({
    ok: true,
    lembrete_email_em: carimbo,
    // Em dry run nada saiu de verdade: o painel precisa dizer isso.
    dryRun: env.MAIL_DRY_RUN,
  });
}
