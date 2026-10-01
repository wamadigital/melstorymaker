// Repasse de query string entre páginas do lead. Sem "server-only": a raiz usa
// no servidor (redirect) e a LP no navegador (href do CTA).

/** O que dá para receber como query: a string de `location.search`, o `searchParams` de uma página ou um URLSearchParams. */
export type QueryEntrada = string | URLSearchParams | Record<string, string | string[] | undefined>;

function paraParams(query: QueryEntrada): URLSearchParams {
  if (typeof query === "string" || query instanceof URLSearchParams) return new URLSearchParams(query);
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) {
    for (const v of Array.isArray(valor) ? valor : valor ? [valor] : []) params.append(chave, v);
  }
  return params;
}

/**
 * `destino` com a query de quem chegou e mais os `fixos`.
 *
 * A query vai junto porque anúncio chega com `fbclid` e `utm_*` na URL, e é o
 * `fbclid` que liga o lead ao clique quando o Pixel está bloqueado: o
 * `rastreio.ts` o lê do Referer do formulário. Página que descarta a query no
 * meio do caminho (o redirect da raiz fazia isso) entrega o lead sem
 * atribuição.
 *
 * Os `fixos` usam `set`, e não `append`: ganham de qualquer valor de mesmo nome
 * que vier na query. Sem isso, `/casamento?evento=debutante` mandaria dois
 * `evento` para o formulário.
 */
export function repassarQuery(destino: string, query: QueryEntrada, fixos: Record<string, string> = {}): string {
  const params = paraParams(query);
  for (const [chave, valor] of Object.entries(fixos)) params.set(chave, valor);
  const qs = params.toString();
  return qs ? `${destino}?${qs}` : destino;
}
