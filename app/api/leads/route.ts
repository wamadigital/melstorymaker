import { NextResponse, after } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { idsValidos, limparRespostasOrfas, passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS, type Respostas } from "@/lib/form/types";
import { colunasPromovidas, nomeContato } from "@/lib/leads";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";
import { EVENTO, idEvento } from "@/lib/meta/eventos";
import { enviarConversao } from "@/lib/meta/conversoes";
import { guardarRastreio } from "@/lib/meta/lead";
import { origemDaRequisicao, paraGuardar, rastreioDaRequisicao } from "@/lib/meta/rastreio";

// `respostas` e opcional no schema mas nao na pratica: o formulario so chama
// esta rota no PRIMEIRO avanco, ja com o WhatsApp respondido. Opcional aqui
// porque a rota e contrato de API, e recusar um corpo so com a categoria seria
// quebrar quem ja usa -- inclusive o e2e.
const corpo = z.object({
  categoria: z.enum(CATEGORIAS),
  respostas: z.record(z.string(), z.string()).optional(),
  passo_atual: z.string().nullable().optional(),
  tentativa_id: z.string().uuid().optional(),
});

const camposCriacao = "id, categoria, passo_atual, respostas, status";

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

  const promovidas = colunasPromovidas(categoria, respostas);
  const { data, error } = await supabaseAdmin()
    .from("leads")
    .insert({
      ...(parsed.data.tentativa_id && { id: parsed.data.tentativa_id }),
      categoria,
      status: "incompleto",
      respostas,
      passo_atual,
      // Promovidas ja na criacao: e o que faz o telefone aparecer na lista do
      // painel sem esperar o proximo autosave.
      ...promovidas,
    })
    .select(camposCriacao)
    .single();

  if (error) {
    // O mesmo UUID torna a repeticao segura mesmo se o INSERT anterior ocorreu
    // e somente a resposta se perdeu. Nunca fazer upsert: respostas e status
    // podem ter avancado depois da primeira tentativa.
    if (error.code === "23505" && parsed.data.tentativa_id) {
      const { data: existente, error: erroRecuperacao } = await supabaseAdmin()
        .from("leads")
        .select(camposCriacao)
        .eq("id", parsed.data.tentativa_id)
        .maybeSingle();
      if (existente && !erroRecuperacao) {
        // Recuperacao tem a mesma superficie do GET publico pelo UUID. Somente
        // a criacao vencedora agenda rastreio e Lead; repeticao nao tem efeitos.
        return NextResponse.json(existente);
      }
      console.error("[leads] falha ao recuperar tentativa de criacao", erroRecuperacao ?? error);
    } else {
      console.error("[leads] falha ao criar lead", error);
    }
    return NextResponse.json({ erro: "Não consegui salvar agora. Tenta de novo?" }, { status: 500 });
  }

  // Meta Pixel (CLAUDE.md, "Meta Pixel"): o `Lead` sai aqui, no nascimento do
  // lead, com o mesmo event_id que o navegador usa -- a Meta conta um so. Lido
  // do request AGORA, antes do after(): e o request do proprio lead, com os
  // cookies do Pixel, o ip e o navegador dele.
  const rastreio = rastreioDaRequisicao(req);
  const origem = origemDaRequisicao(req);
  after(async () => {
    await guardarRastreio(data.id, paraGuardar(rastreio, origem));
    await enviarConversao({
      nome: EVENTO.lead,
      id: idEvento("lead", data.id),
      origem: "website",
      url: origem.url,
      categoria,
      pessoa: {
        leadId: data.id,
        email: promovidas.email,
        whatsapp: promovidas.whatsapp,
        nome: nomeContato(respostas),
        ...rastreio,
        ip: origem.ip,
        userAgent: origem.userAgent,
      },
    });
  });

  return NextResponse.json(data, { status: 201 });
}
