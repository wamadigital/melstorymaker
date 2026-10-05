// Texto do snippet do Meta Pixel, separado do componente para poder ser
// testado sem React (`snippet.test.ts`).

export type EventoInicial = {
  /** `track` para evento padrão da Meta, `trackCustom` para personalizado. */
  tipo: "track" | "trackCustom";
  nome: string;
  dados?: Record<string, string>;
};

/**
 * Serializa um valor para dentro do script inline. `JSON.stringify` cuida das
 * aspas; o `<` vira `<` para que nenhum valor feche a tag `</script>`. Os
 * valores hoje são constantes do servidor, mas o snippet não pode depender
 * disso para estar correto.
 */
function js(valor: unknown): string {
  return JSON.stringify(valor).replace(/</g, "\\u003c");
}

/**
 * O snippet base da Meta, o `init` e o `PageView`, seguidos dos eventos que a
 * página dispara ao carregar.
 *
 * Os eventos iniciais vão NO MESMO script, logo depois do `PageView`, e não
 * num `useEffect`: o effect pode rodar antes de o `next/script` injetar o
 * snippet, e aí o `fbq` ainda não existe e o `rastrear` engole o evento em
 * silêncio. Aqui o `fbq` já está definido (a fila do stub guarda tudo até o
 * fbevents.js chegar).
 *
 * Cada um (o `PageView` inclusive) sai com um `eventID` gerado aqui e fica em
 * `window.__metaIniciais`, de onde o `CopiaIniciais` manda a cópia pelo
 * servidor com o mesmo id (a Meta deduplica). O evento `meta:iniciais` avisa
 * quem já estava montado: este script roda depois da hidratação.
 *
 * `id` precisa vir validado por quem chama (só dígitos): ele entra cru.
 */
export function snippetPixel(id: string, eventosIniciais: readonly EventoInicial[] = []): string {
  const base =
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init','${id}');`;
  const todos: EventoInicial[] = [{ tipo: "track", nome: "PageView" }, ...eventosIniciais];
  const disparos = todos
    .map((e) => `d(${js(e.tipo)},${js(e.nome)},${js(e.dados ?? {})});`)
    .join("");
  // `d` dispara com id e guarda para a cópia; tudo dentro de uma função para
  // não deixar variável solta no `window`.
  return (
    base +
    "(function(){var c=window.__metaIniciais=window.__metaIniciais||[];" +
    "function d(t,n,x){var i=n+'.'+Date.now().toString(36)+'.'+Math.random().toString(36).slice(2,10);" +
    "fbq(t,n,x,{eventID:i});c.push({nome:n,id:i,dados:x})}" +
    disparos +
    "try{window.dispatchEvent(new Event('meta:iniciais'))}catch(e){}})();"
  );
}
