import { NextResponse, after } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { passosVisiveis } from "@/lib/form/engine";
import { validarPassos } from "@/lib/form/validacao";
import type { Respostas } from "@/lib/form/types";
import { colunasPromovidas, nomeContato } from "@/lib/leads";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";
import { notificarMel } from "@/lib/notifica/adapter";
import { mensagemNovoLead } from "@/lib/notifica/mensagem";
import { env } from "@/lib/env";
import { EVENTO, idEvento } from "@/lib/meta/eventos";
import { enviarConversao } from "@/lib/meta/conversoes";
import { enviarEventosCrmDoLead } from "@/lib/meta/crm";
import { origemDaRequisicao, rastreioDaRequisicao } from "@/lib/meta/rastreio";
import { atualizarVersaoLead, CAMPOS_VERSAO_LEAD, corpoBaseLead, mesmaVersaoLead } from "@/lib/form/versao-lead";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

const uuid = z.string().uuid();
const corpoSubmit = z.object({ base: corpoBaseLead.optional() });

/**
 * POST /api/leads/[id]/submit -- fecha o formulario (RF-07).
 *
 * Revalida tudo no servidor: a validacao do client existe para dar feedback
 * bonito, nao para garantir nada.
 */
export async function POST(req: Request, { params }: Ctx) {
  const ip = ipDaRequisicao(req);
  if (excedeuLimite(`submit:${ip}`, LIMITES.submit.limite, LIMITES.submit.janelaMs)) {
    return NextResponse.json({ erro: "Muitas tentativas. Tenta de novo em instantes." }, { status: 429 });
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  // POST sem corpo continua valido para os clientes anteriores. O cliente novo
  // manda a ultima base confirmada, para nao fechar as respostas de outra aba.
  let json: unknown;
  try {
    const texto = await req.text();
    json = texto.trim() ? JSON.parse(texto) : {};
  } catch {
    json = null;
  }
  const parsed = corpoSubmit.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Payload inválido." }, { status: 400 });
  }

  const { data: lead, error: erroLeitura } = await supabaseAdmin()
    .from("leads")
    .select(CAMPOS_VERSAO_LEAD)
    .eq("id", id)
    .maybeSingle();

  if (erroLeitura) {
    console.error("[leads] falha ao ler lead para submit", erroLeitura);
    return NextResponse.json({ erro: "Não consegui enviar agora." }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  // Reenvio do mesmo formulario (duplo clique, retomada) nao e erro: se ja
  // passou por aqui, o estado desejado ja existe.
  if (lead.status !== "incompleto") {
    if (parsed.data.base && !mesmaVersaoLead(parsed.data.base, lead)) {
      return NextResponse.json(
        { erro: "Esse formulário já foi enviado com outras respostas. Seu rascunho continua neste aparelho.", codigo: "conflito_respostas" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, status: lead.status });
  }
  if (parsed.data.base && !mesmaVersaoLead(parsed.data.base, lead)) {
    return NextResponse.json(
      { erro: "Esse formulário mudou em outra tela. Suas respostas continuam neste aparelho.", codigo: "conflito_respostas" },
      { status: 409 },
    );
  }

  const respostas = (lead.respostas ?? {}) as Respostas;
  const erros = validarPassos(passosVisiveis(lead.categoria, respostas), respostas);

  if (Object.keys(erros).length > 0) {
    return NextResponse.json(
      { erro: "Faltou responder alguma coisa.", campos: erros },
      { status: 422 },
    );
  }

  const promovidas = colunasPromovidas(lead.categoria, respostas);
  const escrita = await atualizarVersaoLead(lead, { status: "aguardando_revisao", ...promovidas });

  if (escrita.tipo === "erro") {
    console.error("[leads] falha no submit", escrita.erro);
    return NextResponse.json({ erro: "Não consegui enviar agora." }, { status: 500 });
  }

  if (escrita.tipo === "mudou") {
    // Outro submit venceu: devolve o estado atual, sem avisar a Mel nem mandar
    // CAPI de novo. Se foi um autosave, o que validamos ja nao e a versao atual.
    const atual = escrita.lead;
    if (atual && atual.status !== "incompleto") {
      const validada = parsed.data.base ?? { categoria: lead.categoria, respostas, passo_atual: lead.passo_atual };
      if (!mesmaVersaoLead(validada, atual)) {
        return NextResponse.json(
          { erro: "Esse formulário já foi enviado com outras respostas. Seu rascunho continua neste aparelho.", codigo: "conflito_respostas" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, status: atual.status });
    }
    return NextResponse.json(
      { erro: "Esse formulário mudou em outra tela. Suas respostas continuam neste aparelho.", codigo: "conflito_respostas" },
      { status: 409 },
    );
  }

  // Avisa a Mel DEPOIS de responder ao lead: after() roda pos-resposta, entao
  // gateway lento ou fora do ar nao atrasa nem quebra o submit. Dispara so
  // aqui, na transicao incompleto -> aguardando_revisao: a linha devolvida pelo
  // UPDATE escolhe o vencedor, inclusive quando duas leituras viram incompleto.
  after(async () => {
    await notificarMel(
      mensagemNovoLead(lead.categoria, respostas, `${env.APP_URL.replace(/\/+$/, "")}/admin`),
    );
  });

  // Meta Pixel: `SubmitApplication`, espelhando o que o navegador dispara com o
  // mesmo event_id. Mesmo guard da notificacao -- so na transicao de fato.
  // after() separado: um nao depende do outro terminar.
  const rastreio = rastreioDaRequisicao(req);
  const origem = origemDaRequisicao(req);
  after(async () => {
    await Promise.all([
      enviarEventosCrmDoLead(id),
      enviarConversao({
        nome: EVENTO.submit,
        id: idEvento("submit", id),
        origem: "website",
        url: origem.url,
        categoria: lead.categoria,
        pessoa: {
          leadId: id,
          email: promovidas.email,
          whatsapp: promovidas.whatsapp,
          nome: nomeContato(respostas),
          ...rastreio,
          ip: origem.ip,
          userAgent: origem.userAgent,
        },
      }),
    ]);
  });

  return NextResponse.json({ ok: true, status: "aguardando_revisao" });
}
