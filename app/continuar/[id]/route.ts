import { z } from "zod";
import { CHAVE_LEAD } from "@/lib/form/retomada";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

/**
 * GET /continuar/[id] -- o link "continuar de onde parou" do lembrete por
 * e-mail.
 *
 * A retomada do formulario e pelo localStorage do navegador em que o lead
 * comecou (`CHAVE_LEAD`). Quem abre o e-mail esta quase sempre em OUTRO: o
 * formulario foi preenchido no navegador do Instagram ou do WhatsApp, e o link
 * do e-mail abre no do Gmail. Mandar direto para /formulario recomecaria do
 * zero. Esta pagina grava o id no navegador de quem clicou e segue para o
 * formulario, que faz o resto como sempre fez: confere o status, abre na
 * pergunta em que o lead parou e, se ele ja tiver enviado, comeca do zero.
 *
 * Pagina de passagem, e nao `?lead=` no /formulario, por causa da Meta. O id e
 * a chave de escrita do autosave publico enquanto o lead esta em "Novo", e o
 * Pixel manda a URL da pagina e o referrer em todo evento. Aqui nao ha Pixel, e
 * o `no-referrer` faz o /formulario abrir com `document.referrer` vazio: o id
 * fica entre o e-mail do lead e o nosso servidor.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;

  // Id torto vai para o formulario do zero, sem passar pela pagina: nada que
  // veio na URL e ecoado dentro de um <script>.
  if (!uuid.safeParse(id).success) {
    return Response.redirect(new URL("/formulario", req.url), 307);
  }

  // try/catch porque navegador com armazenamento bloqueado lanca no setItem:
  // ai o formulario abre do zero, que e o melhor que da para fazer.
  const gravar = `try{localStorage.setItem(${JSON.stringify(CHAVE_LEAD)},${JSON.stringify(id)})}catch(e){}`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Mel Simão | Storymaker</title>
</head>
<body>
<script>${gravar};location.replace("/formulario")</script>
<noscript><a href="/formulario">Continuar meu orçamento</a></noscript>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Uma resposta por lead: nada de CDN guardando a de um para servir a outro.
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
