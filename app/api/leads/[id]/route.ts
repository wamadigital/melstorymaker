import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { idsValidos, limparRespostasOrfas, passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS, type Respostas } from "@/lib/form/types";
import { colunasPromovidas } from "@/lib/leads";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

const corpoPatch = z.object({
  respostas: z.record(z.string(), z.string()).optional(),
  passo_atual: z.string().optional(),
  categoria: z.enum(CATEGORIAS).optional(),
});

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
    .select("id, categoria, status, respostas")
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
    return NextResponse.json({ erro: "Esse formulário já foi enviado." }, { status: 409 });
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
  const mescladas: Respostas = { ...base };
  for (const [chave, valor] of Object.entries(recebidas)) {
    if (permitidos.has(chave)) mescladas[chave] = valor;
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

  const { error } = await supabaseAdmin()
    .from("leads")
    .update({ categoria, respostas, passo_atual, ...colunasPromovidas(respostas) })
    .eq("id", id)
    .eq("status", "incompleto");

  if (error) {
    console.error("[leads] falha no autosave", error);
    return NextResponse.json({ erro: "Não consegui salvar agora." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, categoria, respostas, passo_atual });
}
