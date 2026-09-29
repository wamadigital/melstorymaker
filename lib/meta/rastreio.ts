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

  // Sem o cookie mas com o clique na URL: o Pixel nao carregou (bloqueador de
  // anuncio, rede lenta) e e justamente o caso que a Conversions API existe
  // para cobrir. O fetch do formulario e same-origin, entao o Referer traz a
  // URL inteira da pagina, com o `fbclid` que o anuncio colou nela. Formato
  // montado como a Meta documenta para `fbc` gerado no servidor.
  if (!fbc) {
    const fbclid = referer(req)?.searchParams.get("fbclid");
    if (fbclid) fbc = valido(`fb.1.${agoraMs}.${fbclid}`, RE_FBC);
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

/** Le o `rastreio` guardado no lead, tolerando lead antigo (null) e jsonb torto. */
export function rastreioGuardado(valor: unknown): Rastreio {
  if (!valor || typeof valor !== "object") return {};
  const { fbp, fbc } = valor as Record<string, unknown>;
  return {
    ...(typeof fbp === "string" && valido(fbp, RE_FBP) && { fbp }),
    ...(typeof fbc === "string" && valido(fbc, RE_FBC) && { fbc }),
  };
}
