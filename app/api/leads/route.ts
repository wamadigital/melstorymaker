import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { idsValidos, limparRespostasOrfas, passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS, type Respostas } from "@/lib/form/types";
import { colunasPromovidas } from "@/lib/leads";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";

// `respostas` e opcional no schema mas nao na pratica: o formulario so chama
// esta rota no PRIMEIRO avanco, ja com o WhatsApp respondido. Opcional aqui
// porque a rota e contrato de API, e recusar um corpo so com a categoria seria
// quebrar quem ja usa -- inclusive o e2e.
const corpo = z.object({
  categoria: z.enum(CATEGORIAS),
  respostas: z.record(z.string(), z.string()).optional(),
  passo_atual: z.string().optional(),
});

/**
 * POST /api/leads -- cria o lead no primeiro avanco do formulario (RF-02).
 *
 * Nasce com o WhatsApp DENTRO, e nao na escolha da categoria: quem so tocou
 * numa categoria e fechou a aba nao deixa registro nenhum. Lead parcial
 * continua sendo lead -- o corte nao e o termino do formulario, e sim ter como
 * falar com a pessoa. Sem telefone o registro so enche a coluna "Novo" de
 * gente que a Mel nao consegue alcancar.
 */
export async function POST(req: Request) {
  const ip = ipDaRequisicao(req);
  if (excedeuLimite(`criar:${ip}`, LIMITES.criarLead.limite, LIMITES.criarLead.janelaMs)) {
    return NextResponse.json({ erro: "Muitas tentativas. Tenta de novo em instantes." }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = corpo.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Categoria inválida." }, { status: 400 });
  }

  const { categoria } = parsed.data;

  // Mesma whitelist do autosave: so entra chave que existe no arvore.json desta
  // categoria. Sem isso, qualquer um injeta campo arbitrario no jsonb ja na
  // criacao -- e a criacao e publica.
  const permitidos = idsValidos(categoria);
  const recebidas = parsed.data.respostas ?? {};
  const mescladas: Respostas = {};
  for (const [chave, valor] of Object.entries(recebidas)) {
    if (permitidos.has(chave)) mescladas[chave] = valor;
  }
  const respostas = limparRespostasOrfas(categoria, mescladas);

  // Passo pedido que nao existe volta para o primeiro visivel, igual ao PATCH:
  // senao a retomada abriria numa tela em branco.
  const visiveis = passosVisiveis(categoria, respostas);
  const pedido = parsed.data.passo_atual;
  const passo_atual =
    pedido && visiveis.some((p) => p.id === pedido) ? pedido : (visiveis[0]?.id ?? null);

  const { data, error } = await supabaseAdmin()
    .from("leads")
    .insert({
      categoria,
      status: "incompleto",
      respostas,
      passo_atual,
      // Promovidas ja na criacao: e o que faz o telefone aparecer na lista do
      // painel sem esperar o proximo autosave.
      ...colunasPromovidas(categoria, respostas),
    })
    .select("id, categoria, passo_atual")
    .single();

  if (error) {
    console.error("[leads] falha ao criar lead", error);
    return NextResponse.json({ erro: "Não consegui salvar agora. Tenta de novo?" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
