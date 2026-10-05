// Regras de quando a LP conta rolagem, secao vista e tempo (eventos de
// `EVENTO_LP`). Puras, para os limites serem testados sem navegador; quem
// liga nos eventos do DOM e `components/lp/RastreioLp.tsx`.

/** Profundidades de rolagem, em % da pagina. 90 e nao 100: o rodape quase nunca aparece inteiro. */
export const PROFUNDIDADES = [25, 50, 75, 90] as const;

/** Segundos com a aba VISIVEL. 15 separa quem bateu e voltou de quem ficou. */
export const SEGUNDOS = [15, 30, 60, 120] as const;

/** Quanto da pagina ja passou pela tela, em % (0 a 100). */
export function profundidadeVista(rolagem: number, alturaTela: number, alturaPagina: number): number {
  if (alturaPagina <= 0) return 0;
  return Math.min(100, Math.max(0, ((rolagem + alturaTela) / alturaPagina) * 100));
}

/** Os marcos de `marcos` que `valor` ja alcancou. */
export function marcosAlcancados(valor: number, marcos: readonly number[]): number[] {
  return marcos.filter((m) => valor >= m);
}

/**
 * Secao "vista": metade dela na tela, ou, se ela e mais alta que a tela, meia
 * tela dela. So "metade da secao" nunca contaria a galeria ou o FAQ abertos
 * num celular, que passam de duas telas.
 */
export function secaoVista(alturaVisivel: number, alturaSecao: number, alturaTela: number): boolean {
  if (alturaSecao <= 0 || alturaVisivel <= 0) return false;
  return alturaVisivel >= Math.min(alturaSecao, alturaTela) * 0.5;
}

/** "Quanto custa?" -> "quanto_custa". Vai no `AbriuDuvida` e no `data-duvida` do FAQ. */
export function slugPergunta(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50)
    .replace(/_+$/, "");
}
