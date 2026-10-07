import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { esfriarParados } from "@/lib/supabase/esfriar";

/**
 * Mantem o projeto do Supabase acordado.
 *
 * No plano gratuito, o Supabase PAUSA o projeto depois de 7 dias com pouca
 * atividade de banco -- e um projeto pausado derruba o formulario inteiro sem
 * aviso: o lead abre o link do WhatsApp e ve erro. A doc diz que "algumas
 * requisicoes por dia ao longo da semana" ja bastam para escapar da pausa,
 * entao uma consulta diaria resolve.
 *
 * Isso NAO e monitoramento nem analytics (proibidos no MVP): e a rotina minima
 * que mantem a infraestrutura de pe. No dia em que a conta virar Pro, a consulta
 * de keep-alive pode sumir -- mas a rota NAO: desde 07/10/2026 ela tambem move
 * para "Esfriou" os leads parados (`esfriarParados`), para o banco ficar certo
 * mesmo nos dias em que ninguem abre o quadro.
 *
 * Quem chama e o Vercel Cron. A Vercel injeta `Authorization: Bearer
 * $CRON_SECRET` na chamada; sem o segredo conferido, a rota fica publica e
 * qualquer um pode martelar o banco.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;

  // Falha FECHADA: sem segredo configurado a rota nao responde, em vez de
  // virar um endpoint aberto contra o banco de producao.
  if (!segredo) {
    return NextResponse.json(
      { erro: "CRON_SECRET nao configurada" },
      { status: 503 },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "nao autorizado" }, { status: 401 });
  }

  // Consulta de verdade contra a tabela: e a atividade de banco que conta.
  // `head: true` traz so a contagem, sem transferir linha nenhuma.
  const { count, error } = await supabaseAdmin()
    .from("leads")
    .select("id", { count: "exact", head: true });

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }

  // A unica transicao de status automatica do sistema (lib/admin/esfriar.ts).
  const esfriados = await esfriarParados(Date.now());

  return NextResponse.json({ ok: true, leads: count ?? 0, esfriados: esfriados.length });
}
