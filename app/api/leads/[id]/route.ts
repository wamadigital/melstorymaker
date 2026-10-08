import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { idsValidos, limparRespostasOrfas, passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS, type Respostas } from "@/lib/form/types";
import { colunasPromovidas } from "@/lib/leads";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";
import { atualizarVersaoLead, CAMPOS_VERSAO_LEAD, corpoBaseLead, mesmaVersaoLead } from "@/lib/form/versao-lead";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

const corpoPatch = z.object({
  respostas: z.record(z.string(), z.string()).optional(),
  passo_atual: z.string().nullable().optional(),
  categoria: z.enum(CATEGORIAS).optional(),
  base: corpoBaseLead.optional(),
}).refine(
  (valor) => !valor.base || (valor.categoria !== undefined && valor.respostas !== undefined && Object.hasOwn(valor, "passo_atual")),
  { message: "Com base, envie categoria, respostas e passo_atual completos." },
);

/**
 * GET /api/leads/[id] -- retomada do formulario (RF-04).
 *
 * Devolve so o necessario para remontar a tela. O id e um uuid v4: nao e
 * segredo forte, mas tambem nao e enumeravel, e o payload nao expoe nada alem
 * do que o proprio lead digitou.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin()
    .from("leads")
    .select("id, categoria, status, respostas, passo_atual")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[leads] falha ao ler lead", error);
    return NextResponse.json({ erro: "Não consegui carregar agora." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  return NextResponse.json(data);
}

/**
 * PATCH /api/leads/[id] -- autosave a cada avanco de passo (RF-04).
 *
 * So aceita lead com status `incompleto`. Depois do submit o formulario esta
 * fechado: qualquer edicao passa a ser exclusividade do painel da Mel.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const ip = ipDaRequisicao(req);
  if (excedeuLimite(`autosave:${ip}`, LIMITES.autosave.limite, LIMITES.autosave.janelaMs)) {
    return NextResponse.json({ erro: "Muitas tentativas. Tenta de novo em instantes." }, { status: 429 });
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = corpoPatch.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Payload inválido." }, { status: 400 });
  }

  const { data: lead, error: erroLeitura } = await supabaseAdmin()
    .from("leads")
    .select(CAMPOS_VERSAO_LEAD)
    .eq("id", id)
    .maybeSingle();

  if (erroLeitura) {
    console.error("[leads] falha ao ler lead para autosave", erroLeitura);
    return NextResponse.json({ erro: "Não consegui salvar agora." }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }
  if (lead.status !== "incompleto") {
    return NextResponse.json({ erro: "Esse formulário já foi enviado.", codigo: "formulario_enviado" }, { status: 409 });
  }
  // Trocar de categoria zera o fluxo anterior mas preserva o contato ja digitado.
  const trocouCategoria = !!parsed.data.categoria && parsed.data.categoria !== lead.categoria;
  const categoria = parsed.data.categoria ?? lead.categoria;
  const base: Respostas = trocouCategoria
    ? Object.fromEntries(
        Object.entries((lead.respostas ?? {}) as Respostas).filter(([k]) =>
          k.startsWith("contato_"),
        ),
      )
    : ((lead.respostas ?? {}) as Respostas);

  // Whitelist: so entram chaves que existem no arvore.json desta categoria.
  // Sem isso, qualquer um injeta campo arbitrario no jsonb.
  const permitidos = idsValidos(categoria);
  const recebidas = parsed.data.respostas ?? {};
  // O cliente com base manda o snapshot inteiro: campos ausentes foram removidos
  // (inclusive ao trocar de categoria e voltar antes de a fila enviar). O
  // cliente anterior, sem base, continua podendo mandar apenas um delta.
  const mescladas: Respostas = parsed.data.base ? {} : { ...base };
  const recebidasValidas: Respostas = {};
  for (const [chave, valor] of Object.entries(recebidas)) {
    if (permitidos.has(chave)) {
      mescladas[chave] = valor;
      recebidasValidas[chave] = valor;
    }
  }

  const respostas = limparRespostasOrfas(categoria, mescladas);

  // Um passo_atual que nao existe mais (ex: sumiu com a ramificacao) volta pro
  // primeiro passo visivel, senao a retomada abre numa tela em branco.
  const visiveis = passosVisiveis(categoria, respostas);
  const passoPedido = parsed.data.passo_atual;
  const passo_atual =
    passoPedido && visiveis.some((p) => p.id === passoPedido)
      ? passoPedido
      : (visiveis[0]?.id ?? null);

  if (parsed.data.base && !mesmaVersaoLead(parsed.data.base, lead)) {
    // A escrita anterior pode ter sido gravada e perdido apenas a resposta.
    // Reconhece o replay exato sem nova escrita; uma resposta diferente continua
    // em conflito e nunca e reaplicada sobre a versao da outra aba.
    const snapshotCompleto = parsed.data.categoria && parsed.data.respostas && Object.hasOwn(parsed.data, "passo_atual");
    if (snapshotCompleto && mesmaVersaoLead({
      categoria,
      respostas: limparRespostasOrfas(categoria, recebidasValidas),
      passo_atual,
    }, lead)) {
      return NextResponse.json({ ok: true, categoria: lead.categoria, respostas: lead.respostas ?? {}, passo_atual: lead.passo_atual });
    }
    return NextResponse.json(
      { erro: "Esse formulário mudou em outra tela. Suas respostas continuam neste aparelho.", codigo: "conflito_respostas" },
      { status: 409 },
    );
  }

  const escrita = await atualizarVersaoLead(lead, { categoria, respostas, passo_atual, ...colunasPromovidas(categoria, respostas) });

  if (escrita.tipo === "erro") {
    console.error("[leads] falha no autosave", escrita.erro);
    return NextResponse.json({ erro: "Não consegui salvar agora." }, { status: 500 });
  }

  if (escrita.tipo === "mudou") {
    if (escrita.lead && escrita.lead.status !== "incompleto") {
      return NextResponse.json({ erro: "Esse formulário já foi enviado.", codigo: "formulario_enviado" }, { status: 409 });
    }
    return NextResponse.json(
      { erro: "Esse formulário mudou em outra tela. Suas respostas continuam neste aparelho.", codigo: "conflito_respostas" },
      { status: 409 },
    );
  }

  const salvo = escrita.lead;
  return NextResponse.json({ ok: true, categoria: salvo.categoria, respostas: salvo.respostas ?? {}, passo_atual: salvo.passo_atual });
}
