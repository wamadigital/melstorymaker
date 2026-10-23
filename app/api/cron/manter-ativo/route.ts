import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { esfriarParados } from "@/lib/supabase/esfriar";
import { encerrarEventosPassados } from "@/lib/supabase/encerrar-eventos";

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
 * mesmo nos dias em que ninguem abre o quadro. Também encerra os eventos
 * passados antes dessa transição, seguindo o calendário de São Paulo.
 *
 * Quem chama e o Vercel Cron. A Vercel injeta `Authorization: Bearer
 * $CRON_SECRET` na chamada; sem o segredo conferido, a rota fica publica e
 * qualquer um pode martelar o banco.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;

  // Falha FECHADA: sem segredo configurado a rota nao responde, em vez de
  // virar um endpoint aberto contra o banco de producao.
  if (!segredo) {
    return NextResponse.json(
      { erro: "CRON_SECRET nao configurada" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "nao autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // Consulta de verdade contra a tabela: e a atividade de banco que conta.
  // `head: true` traz so a contagem, sem transferir linha nenhuma.
  try {
    const db = supabaseAdmin();
    const { count, error } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .abortSignal(AbortSignal.timeout(5_000))
      .retry(false);
    if (error) {
      return NextResponse.json({ ok: false, erro: "Não consegui consultar a rotina de manutenção." }, {
        status: 503, headers: { "Cache-Control": "no-store" },
      });
    }

    const encerramento = await encerrarEventosPassados(db);
    if (encerramento.erro) {
      return NextResponse.json({ ok: false, erro: encerramento.erro }, {
        status: 503, headers: { "Cache-Control": "no-store" },
      });
    }

    // Não esfria um lead cujo evento já passou: o encerramento vem primeiro.
    const esfriados = await esfriarParados(Date.now());
    return NextResponse.json({ ok: true, leads: count ?? 0, encerrados: encerramento.ids.length, esfriados: esfriados.length }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, erro: "Não consegui executar a rotina de manutenção." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
