import { BUCKET_PROPOSTAS, supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ arquivo: string }> };

export const runtime = "nodejs";

/** O nome do arquivo e sempre `<uuid do lead>.pdf`. Nada mais e aceito. */
const NOME_VALIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

/**
 * GET /proposta/{leadId}.pdf
 *
 * Serve a proposta pelo dominio da Mel em vez do link cru do Storage. E o link
 * que vai por WhatsApp, entao ele aparece para o lead: `melstorymaker.com.br`
 * passa confianca, `hgjottqllwfqxodsqkgr.supabase.co` nao.
 *
 * Continua publico e sem sessao, como antes -- quem tem o link abre o PDF. A
 * URL segue estavel: regerar sobrescreve o mesmo arquivo no bucket e este
 * endereco nao muda (RF-14).
 *
 * Le pelo cliente de servico em vez de redirecionar para a URL publica do
 * Storage: um 302 devolveria o endereco do Supabase para a barra do navegador,
 * que e exatamente o que este proxy existe para esconder.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { arquivo } = await params;

  if (!NOME_VALIDO.test(arquivo)) {
    return new Response("Proposta não encontrada.", { status: 404 });
  }

  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET_PROPOSTAS)
    .download(arquivo);

  if (error || !data) {
    return new Response("Proposta não encontrada.", { status: 404 });
  }

  return new Response(await data.arrayBuffer(), {
    headers: {
      "content-type": "application/pdf",
      // inline: abre no visualizador do navegador em vez de baixar direto.
      // O lead costuma abrir isso no navegador in-app do WhatsApp.
      "content-disposition": `inline; filename="proposta.pdf"`,
      // Curto de proposito: a Mel regera o PDF depois de corrigir um typo e o
      // lead precisa ver a versao nova ao reabrir o mesmo link.
      "cache-control": "public, max-age=60, must-revalidate",
    },
  });
}
