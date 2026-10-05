import "server-only";
import { ipDaRequisicao } from "@/lib/rate-limit";

/**
 * Identificadores de clique/navegador da Meta, lidos dos cookies primarios que
 * o proprio Pixel grava em melstorymaker.com.br:
 *
 * - `_fbp`: o navegador. Existe sempre que o Pixel carregou.
 * - `_fbc`: o CLIQUE no anuncio (carrega o `fbclid`). E o que liga um evento
 *   do quadro, dias depois, ao anuncio que trouxe o lead.
 *
 * Sao guardados no lead (`rastreio`) porque os eventos do quadro saem quando a
 * Mel move o cartao -- nessa hora o request e do navegador DELA, e os cookies
 * do lead ja nao estao ao alcance.
 */
export type Rastreio = { fbp?: string; fbc?: string };

/** Origem do request do LEAD. Nunca usar nas rotas do painel: ali ip e navegador sao os da Mel. */
export type Origem = { ip?: string; userAgent?: string; url?: string };

/**
 * O que vai para a coluna `rastreio`: os cookies MAIS o navegador e o ip do
 * lead no momento da criacao.
 *
 * Navegador e ip entram porque os eventos do quadro saem como evento de SITE
 * (ver `montarEventoDeStatus`), e a Meta recusa evento de site sem navegador.
 * Na hora do arraste o request e o da Mel -- o unico navegador do lead que
 * existe e o que ficou guardado aqui.
 */
export type RastreioGuardado = Rastreio & { ua?: string; ip?: string };

// Formato documentado pela Meta: fb.<subdominio>.<timestamp>.<valor>. Cookie e
// dado do cliente e vai para o banco; o que nao bate com o formato fica de fora.
const RE_FBP = /^fb\.\d\.\d{10,}\.\d+$/;
const RE_FBC = /^fb\.\d\.\d{10,}\.[\w-]+$/;
const TAMANHO_MAXIMO = 500;

function lerCookie(req: Request, nome: string): string | undefined {
  const cabecalho = req.headers.get("cookie");
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave !== nome) continue;
    try {
      return decodeURIComponent(resto.join("=")) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function valido(valor: string | undefined, re: RegExp): string | undefined {
  return valor && valor.length <= TAMANHO_MAXIMO && re.test(valor) ? valor : undefined;
}

function referer(req: Request): URL | null {
  const bruto = req.headers.get("referer");
  if (!bruto) return null;
  try {
    const url = new URL(bruto);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function rastreioDaRequisicao(req: Request, agoraMs: number = Date.now()): Rastreio {
  const fbp = valido(lerCookie(req, "_fbp"), RE_FBP);
  let fbc = valido(lerCookie(req, "_fbc"), RE_FBC);

  // O clique na URL vence o cookie quando e OUTRO clique, como o proprio
  // fbevents.js faz ao carregar. Dois casos:
  // - sem cookie: o Pixel nao carregou (bloqueador de anuncio, rede lenta), o
  //   caso que a Conversions API existe para cobrir;
  // - cookie de um clique ANTERIOR: quem volta por um anuncio novo de
  //   remarketing, e a copia saiu antes de o fbevents.js reescrever o cookie
  //   (no 4G ele chega depois do primeiro lote). Sem isto, o evento iria
  //   atribuido ao anuncio velho.
  // O fetch e o beacon sao same-origin, entao o Referer traz a URL inteira da
  // pagina, com o `fbclid` que o anuncio colou nela. Mesmo clique do cookie: o
  // cookie fica, com a data original. Formato montado como a Meta documenta
  // para `fbc` gerado no servidor.
  const fbclid = referer(req)?.searchParams.get("fbclid");
  if (fbclid && !fbc?.endsWith(`.${fbclid}`)) {
    fbc = valido(`fb.1.${agoraMs}.${fbclid}`, RE_FBC) ?? fbc;
  }

  return { ...(fbp && { fbp }), ...(fbc && { fbc }) };
}

export function origemDaRequisicao(req: Request): Origem {
  const ip = ipDaRequisicao(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const url = referer(req)?.toString();
  return {
    ...(ip !== "desconhecido" && { ip }),
    ...(userAgent && { userAgent }),
    ...(url && { url }),
  };
}

// IPv4 ou IPv6, sem porta. So o formato: quem manda no valor e o proxy da Vercel.
const RE_IP = /^[0-9a-fA-F:.]{3,45}$/;
// Navegador e texto livre do cliente; so corta lixo e tamanho.
const RE_UA = /^[\x20-\x7E]{1,500}$/;

/** Monta o objeto da coluna `rastreio` a partir do request de criacao do lead. */
export function paraGuardar(rastreio: Rastreio, origem: Origem): RastreioGuardado {
  const ua = valido(origem.userAgent, RE_UA);
  const ip = valido(origem.ip, RE_IP);
  return { ...rastreio, ...(ua && { ua }), ...(ip && { ip }) };
}

/**
 * Le o `rastreio` guardado no lead, tolerando lead antigo (null, ou so com
 * fbp/fbc) e jsonb torto. Devolve ja com os nomes de `Pessoa` (`userAgent`),
 * para espalhar direto no evento.
 */
export function rastreioGuardado(valor: unknown): Rastreio & Pick<Origem, "ip" | "userAgent"> {
  if (!valor || typeof valor !== "object") return {};
  const { fbp, fbc, ua, ip } = valor as Record<string, unknown>;
  return {
    ...(typeof fbp === "string" && valido(fbp, RE_FBP) && { fbp }),
    ...(typeof fbc === "string" && valido(fbc, RE_FBC) && { fbc }),
    ...(typeof ua === "string" && valido(ua, RE_UA) && { userAgent: ua }),
    ...(typeof ip === "string" && valido(ip, RE_IP) && { ip }),
  };
}
