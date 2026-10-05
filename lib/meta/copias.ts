// Validacao do que o navegador manda para `/api/meta/eventos`. Pura (sem rede
// nem env) para ser testada direto; quem chama e a rota.
//
// A rota e PUBLICA e o que ela recebe vai para o Pixel de producao. Tudo aqui
// existe para que um POST forjado nao consiga escrever no Pixel nada alem do
// que o proprio site escreveria: so os eventos de `COPIAVEIS`, so os
// parametros de cada um, valores curtos e sem caractere estranho, e URL do
// proprio site.
import { COPIAVEIS, MAX_COPIAS_POR_LOTE } from "@/lib/meta/eventos";

export type Copia = {
  nome: string;
  /** O MESMO `eventID` que o Pixel usou no navegador: e o que a Meta deduplica. */
  id: string;
  dados: Record<string, string>;
  /** A pagina em que o evento aconteceu (`event_source_url`). */
  url?: string;
};

/**
 * Corpo maximo aceito, em caracteres: o lote mais pesado que o site monta (25
 * eventos, cada um com URL do tamanho maximo e os parametros) cabe, e ainda
 * fica abaixo dos 64 KB que o `sendBeacon` e o `keepalive` aceitam.
 */
export const MAX_CORPO = 60_000;

// Gerado pelo navegador (`novoIdEvento`, ou o snippet): nome do evento, ponto,
// e um sufixo aleatorio.
const RE_ID = /^[A-Za-z0-9._-]{8,100}$/;
// Valores sao rotulos que o proprio site escreve (posicao do CTA, secao, id de
// Reel, slug da pergunta, numero de marco).
const RE_VALOR = /^[\p{L}\p{N}._ -]{1,60}$/u;
const MAX_URL = 2000;

function objeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A URL, se for http(s) do proprio site e de tamanho razoavel; senao nada. */
export function urlDoSite(bruto: unknown, host: string): string | undefined {
  if (typeof bruto !== "string" || bruto.length > MAX_URL) return undefined;
  try {
    const u = new URL(bruto);
    return (u.protocol === "https:" || u.protocol === "http:") && u.host === host ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function copia(v: unknown, host: string): Copia | null {
  if (!objeto(v)) return null;
  const { nome, id, dados, url } = v;
  if (typeof nome !== "string" || !Object.hasOwn(COPIAVEIS, nome)) return null;
  if (typeof id !== "string" || !RE_ID.test(id)) return null;

  const permitidos = COPIAVEIS[nome];
  const limpos: Record<string, string> = {};
  if (dados !== undefined) {
    if (!objeto(dados)) return null;
    for (const [chave, valor] of Object.entries(dados)) {
      // Parametro fora da lista, ou valor torto: o evento inteiro cai. O site
      // nunca manda isso, entao quem mandou nao e o site.
      if (!permitidos.includes(chave) || typeof valor !== "string" || !RE_VALOR.test(valor)) return null;
      limpos[chave] = valor;
    }
  }

  const pagina = urlDoSite(url, host);
  return { nome, id, dados: limpos, ...(pagina && { url: pagina }) };
}

/**
 * `{eventos: [...]}` -> as copias validas. `host` e o do proprio request: URL de
 * outro site nao vira `event_source_url` (cai para o Referer).
 *
 * Evento invalido e descartado sozinho, sem derrubar o lote; lote acima do teto
 * ou fora do formato devolve null.
 */
export function validarCopias(corpo: unknown, host: string): Copia[] | null {
  if (!objeto(corpo) || !Array.isArray(corpo.eventos)) return null;
  if (corpo.eventos.length === 0 || corpo.eventos.length > MAX_COPIAS_POR_LOTE) return null;
  const vistos = new Set<string>();
  const validas: Copia[] = [];
  for (const bruto of corpo.eventos) {
    const c = copia(bruto, host);
    if (!c || vistos.has(c.id)) continue;
    vistos.add(c.id);
    validas.push(c);
  }
  return validas;
}
