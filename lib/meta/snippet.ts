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
 * `id` precisa vir validado por quem chama (só dígitos): ele entra cru.
 */
export function snippetPixel(id: string, eventosIniciais: readonly EventoInicial[] = []): string {
  const base =
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init','${id}');fbq('track','PageView');`;
  const extras = eventosIniciais.map((e) => `fbq(${js(e.tipo)},${js(e.nome)},${js(e.dados ?? {})});`).join("");
  return base + extras;
}
