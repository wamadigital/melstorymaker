// Disparo do Meta Pixel no navegador. O script base e carregado por
// `components/meta/PixelMeta.tsx`, so nas telas do lead (formulario e LP).

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * No-op quando o Pixel nao esta na pagina (sem META_PIXEL_ID, em dev e no
 * painel) e quando o bloqueador de anuncio derrubou o script. Rastreio NUNCA
 * pode quebrar o formulario: o try/catch cobre ate um fbq adulterado por
 * extensao do navegador.
 *
 * `eventId` e o mesmo que o servidor manda pela Conversions API
 * (`idEvento`, em `lib/meta/eventos.ts`) -- sem ele a Meta conta o lead duas
 * vezes.
 */
export function rastrear(evento: string, dados?: Record<string, string>, eventId?: string): void {
  try {
    if (typeof window === "undefined" || typeof window.fbq !== "function") return;
    window.fbq("track", evento, dados ?? {}, eventId ? { eventID: eventId } : undefined);
  } catch {
    // Silencioso de proposito: o lead nao tem o que fazer com erro de rastreio.
  }
}

/**
 * Evento PERSONALIZADO (`trackCustom`), com o mesmo no-op seguro do `rastrear`.
 *
 * Usado so pela LP (`EVENTO_LP`): clique no CTA e Reel assistido, que servem a
 * publico de remarketing e a diagnostico do anuncio -- nao a painel de funil
 * (regra 8). Sem `eventId`: nenhum deles tem copia no servidor para deduplicar.
 */
export function rastrearPersonalizado(evento: string, dados?: Record<string, string>): void {
  try {
    if (typeof window === "undefined" || typeof window.fbq !== "function") return;
    window.fbq("trackCustom", evento, dados ?? {});
  } catch {
    // Mesmo motivo do `rastrear`.
  }
}
