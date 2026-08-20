import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { STATUS, type Status } from "@/lib/form/types";
import { MENSAGEM_RECUSA, recusarMovimento } from "@/lib/admin/status";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

// `z.enum(STATUS)` de proposito: valor novo no enum entra aqui sozinho.
//
// `de` e o status que o QUADRO via quando a Mel soltou o cartao. Serve de
// controle de concorrencia otimista: a aba dela pode estar velha (outra aba, ou
// o proprio envio de e-mail tendo movido o lead no meio tempo).
const corpo = z.object({ status: z.enum(STATUS), de: z.enum(STATUS).optional() });

/**
 * PATCH /api/admin/leads/[id]/status -- a Mel move o cartao no quadro.
 *
 * E a PRIMEIRA transicao de status por decisao humana neste sistema: as outras
 * tres sao consequencia de um fato (o lead criou, o lead enviou, o e-mail saiu).
 * Por isso mora numa rota so dela, com a matriz de transicao em
 * `lib/admin/status.ts` -- e nao dentro do PATCH de respostas, que tem contrato
 * proprio e viraria duas coisas na mesma requisicao.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  // Redundante com o middleware, de proposito: se o matcher mudar um dia, a
  // rota nao fica aberta em silencio.
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Payload inválido." }, { status: 400 });
  }
  const { status: para, de } = parsed.data;

  const { data: lead } = await supabaseAdmin()
    .from("leads")
    .select("id, status, nome_display, pdf_url, enviado_em")
    .eq("id", id)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const atual = lead.status as Status;

  // Duplo clique / drop repetido: o estado desejado ja existe. Mesmo criterio do
  // submit publico, que responde ok em vez de erro.
  if (atual === para) {
    return NextResponse.json({ ok: true, status: atual, enviado_em: lead.enviado_em });
  }

  if (de && de !== atual) {
    return NextResponse.json(
      { erro: "Esse lead mudou de coluna enquanto você arrastava. Atualizei a tela.", status: atual },
      { status: 409 },
    );
  }

  const recusa = recusarMovimento(atual, para, { temProposta: !!lead.pdf_url });
  if (recusa && recusa !== "mesmo_status") {
    return NextResponse.json({ erro: MENSAGEM_RECUSA[recusa] }, { status: 422 });
  }

  // `enviado_em` NUNCA e limpo ao SAIR de `enviado`: a proposta saiu de verdade,
  // e e-mail nao desenvia. Voltar o cartao para revisao e organizacao de
  // trabalho, nao desfazimento de fato.
  //
  // Ao ENTRAR em `enviado` sem `enviado_em`, carimba: o caso real e a Mel ter
  // mandado a proposta pelo WhatsApp, que neste produto e canal de primeira
  // classe. Sem o carimbo o detalhe mostraria "Enviado" sem data nenhuma.
  const patch: { status: Status; enviado_em?: string } = { status: para };
  if (para === "enviado" && !lead.enviado_em) patch.enviado_em = new Date().toISOString();

  // `.eq("status", atual)` e o guard de concorrencia no proprio UPDATE, mesmo
  // padrao do submit publico: zero linhas afetadas significa que alguem chegou
  // antes, e a resposta precisa ser 409, nao um "ok" mentiroso.
  const { data: salvo, error } = await supabaseAdmin()
    .from("leads")
    .update(patch)
    .eq("id", id)
    .eq("status", atual)
    .select("status, enviado_em")
    .maybeSingle();

  if (error) {
    console.error("[admin] falha ao mover status", error);
    return NextResponse.json({ erro: "Não consegui mover agora." }, { status: 500 });
  }

  if (!salvo) {
    return NextResponse.json(
      { erro: "Esse lead mudou de coluna enquanto você arrastava. Atualizei a tela." },
      { status: 409 },
    );
  }

  // Unica trilha de auditoria que existe (logs da Vercel). Este e o primeiro
  // endpoint que deixa uma pessoa reescrever o pipeline: vale a linha.
  console.log(`[admin] status ${id}: ${atual} -> ${para}`);

  return NextResponse.json({ ok: true, status: salvo.status, enviado_em: salvo.enviado_em });
}
