import { after, NextResponse } from "next/server";
import { configCapi, enviarConversoes } from "@/lib/meta/conversoes";
import { MAX_CORPO, urlDoSite, validarCopias } from "@/lib/meta/copias";
import { origemDaRequisicao, rastreioDaRequisicao } from "@/lib/meta/rastreio";
import { excedeuLimite, ipDaRequisicao, LIMITES } from "@/lib/rate-limit";

/**
 * Copia pelo servidor (Conversions API) dos eventos que o Pixel dispara no
 * navegador: PageView, ViewContent, Contact e os personalizados da LP e do
 * formulario (`COPIAVEIS`, em `lib/meta/eventos.ts`). Pedido do owner em
 * 05/10/2026, para a leitura dos anuncios nao depender do navegador: no
 * bloqueador de anuncio e no navegador que corta cookie, so esta copia chega.
 *
 * Vai com o MESMO `event_id` do Pixel, e a Meta conta um so. O request e do
 * proprio visitante (`sendBeacon` da pagina), entao ip, navegador e os cookies
 * `_fbp`/`_fbc` sao os dele -- o mesmo raciocinio da criacao do lead.
 *
 * Para o site, sempre 204 e sem corpo: o navegador nao le a resposta (o beacon
 * nem deixa), e nada aqui pode virar erro na tela de ninguem. 4xx so para o
 * que o site nunca manda (outro site, corpo torto, rajada). O envio a Meta
 * roda no after().
 */
export async function POST(req: Request) {
  // Beacon de outro site nao escreve no Pixel. `Sec-Fetch-Site` todo navegador
  // atual manda; sem ele (cliente antigo, script) segue pelas outras travas.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return new NextResponse(null, { status: 403 });

  const { limite, janelaMs } = LIMITES.copiasMeta;
  if (excedeuLimite(`meta:${ipDaRequisicao(req)}`, limite, janelaMs)) {
    return new NextResponse(null, { status: 429 });
  }

  // Meta desligada (dev, preview): nem le o corpo.
  if (!configCapi()) return new NextResponse(null, { status: 204 });

  // Corpo grande demais e recusado antes de ser lido, quando o tamanho vem no
  // cabecalho (o beacon manda); o limite depois da leitura cobre o resto.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_CORPO * 4) {
    return new NextResponse(null, { status: 413 });
  }

  let corpo: unknown;
  try {
    const texto = await req.text();
    if (texto.length > MAX_CORPO) return new NextResponse(null, { status: 413 });
    corpo = JSON.parse(texto);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const host = new URL(req.url).host;
  const copias = validarCopias(corpo, host);
  if (!copias) return new NextResponse(null, { status: 400 });
  if (!copias.length) return new NextResponse(null, { status: 204 });

  // Lidos AGORA, do request do visitante; o after() roda depois da resposta.
  const rastreio = rastreioDaRequisicao(req);
  const origem = origemDaRequisicao(req);
  // Sem URL no evento, o Referer -- mas pelo mesmo crivo: um script pode mandar
  // qualquer Referer, e o que for de outro site nao vira `event_source_url` no
  // Pixel da Mel (cai na URL padrao do `enviarConversoes`).
  const pagina = urlDoSite(origem.url, host);
  after(() =>
    enviarConversoes(
      copias.map((c) => ({
        nome: c.nome,
        id: c.id,
        origem: "website" as const,
        url: c.url ?? pagina,
        dados: c.dados,
        pessoa: { ...rastreio, ip: origem.ip, userAgent: origem.userAgent },
      })),
    ),
  );

  return new NextResponse(null, { status: 204 });
}
