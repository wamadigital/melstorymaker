import { BUCKET_PROPOSTAS, supabaseAdmin } from "@/lib/supabase/admin";
import { RE_SLUG } from "@/lib/slug";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ slug: string }> };

export const runtime = "nodejs";

/**
 * GET /p/{slug} -- link publico da proposta.
 *
 * Curto porque vai por WhatsApp e e lido por gente. O slug resolve para o lead
 * e o arquivo vem do Storage; o endereco do Supabase nunca aparece para o lead.
 *
 * Publico e sem sessao, como o link do PDF sempre foi: quem tem o link, abre.
 * A URL e estavel -- regerar o PDF sobrescreve o objeto e mantem o slug (RF-14).
 */
export async function GET(req: Request, { params }: Ctx) {
  // Sem isto a rota e um oraculo: 4 caracteres dao 707 mil combinacoes e o
  // status code separa acerto de erro, entao varrer o espaco inteiro leva
  // horas. O limite nao torna o slug secreto -- torna a varredura cara.
  const ip = ipDaRequisicao(req);
  if (excedeuLimite(`proposta:${ip}`, LIMITES.proposta.limite, LIMITES.proposta.janelaMs)) {
    return new Response("Muitas tentativas. Tenta de novo em instantes.", {
      status: 429,
      headers: { "retry-after": "60" },
    });
  }

  const { slug } = await params;

  // Guarda antes do banco: recusa formato errado sem gastar consulta, e fecha
  // a porta para varredura com lixo no lugar do slug.
  if (!RE_SLUG.test(slug)) {
    return new Response("Proposta não encontrada.", { status: 404 });
  }

  const { data: lead } = await supabaseAdmin()
    .from("leads")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!lead) return new Response("Proposta não encontrada.", { status: 404 });

  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET_PROPOSTAS)
    .download(`${lead.id}.pdf`);

  if (error || !data) return new Response("Proposta não encontrada.", { status: 404 });

  return new Response(await data.arrayBuffer(), {
    headers: {
      "content-type": "application/pdf",
      // inline: abre no visualizador em vez de baixar. O lead costuma abrir
      // isso no navegador in-app do WhatsApp.
      "content-disposition": 'inline; filename="proposta.pdf"',
      // Curto de proposito: a Mel regera depois de corrigir um typo e o lead
      // precisa ver a versao nova ao reabrir o mesmo link.
      "cache-control": "public, max-age=60, must-revalidate",
      // O link e publico mas nao e para indexar: e a proposta de uma pessoa.
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
