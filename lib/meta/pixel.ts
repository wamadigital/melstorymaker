// Disparo do Meta Pixel no navegador. O script base e carregado por
// `components/meta/PixelMeta.tsx`, so nas telas do lead (formulario e LP).
import { MAX_COPIAS_POR_LOTE } from "@/lib/meta/eventos";

type CopiaPendente = { nome: string; id: string; dados: Record<string, string> };

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    /** Eventos que o snippet disparou ao carregar, esperando a copia do servidor (`snippetPixel`). */
    __metaIniciais?: CopiaPendente[];
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
 * vezes. E o caminho do `Lead` e do `SubmitApplication`, cuja copia sai das
 * rotas do lead; todo o resto usa `rastrearComCopia`.
 */
export function rastrear(evento: string, dados?: Record<string, string>, eventId?: string): void {
  try {
    if (typeof window === "undefined" || typeof window.fbq !== "function") return;
    window.fbq("track", evento, dados ?? {}, eventId ? { eventID: eventId } : undefined);
  } catch {
    // Silencioso de proposito: o lead nao tem o que fazer com erro de rastreio.
  }
}

/** `<Evento>.<aleatorio>`: unico por disparo, e o mesmo nos dois caminhos. */
export function novoIdEvento(evento: string): string {
  const aleatorio =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
  return `${evento}.${aleatorio}`;
}

/**
 * Evento do Pixel COM copia pelo servidor (Conversions API, rota
 * `/api/meta/eventos`), mesmo `eventID` nos dois -- a Meta conta um so, e quem
 * tem o Pixel bloqueado continua contado pela copia.
 *
 * So eventos de `COPIAVEIS` (a rota recusa os outros). `tipo` e `track` para os
 * padrao da Meta e `trackCustom` para os personalizados.
 *
 * `urgente`: o clique vai sair da pagina (CTA do formulario), entao a copia
 * sai agora, sem esperar o lote.
 *
 * Sem `fbq` na pagina nao sai nada, nem a copia: e o sinal de que esta pagina
 * nao tem Pixel (dev, preview). O stub do snippet existe mesmo quando o
 * bloqueador derruba o fbevents.js, entao a copia continua saindo nesse caso,
 * que e o que ela existe para cobrir.
 */
export function rastrearComCopia(
  tipo: "track" | "trackCustom",
  evento: string,
  dados: Record<string, string> = {},
  opcoes: { urgente?: boolean } = {},
): void {
  try {
    if (typeof window === "undefined" || typeof window.fbq !== "function") return;
    const id = novoIdEvento(evento);
    window.fbq(tipo, evento, dados, { eventID: id });
    copiarParaServidor({ nome: evento, id, dados }, opcoes.urgente);
  } catch {
    // Mesmo motivo do `rastrear`.
  }
}

// ------------------------------------------------------------- fila de copias

const ROTA = "/api/meta/eventos";
/** Junta os eventos de um momento (rolar dispara varios) num envio so. */
const ESPERA_LOTE_MS = 2000;
/**
 * Ate quando, desde a abertura da pagina, um lote espera o fbevents.js carregar.
 * E ele que grava o `_fbp` (o que liga o evento do servidor ao navegador da
 * pessoa) e que reescreve o `_fbc` quando ela volta por um anuncio novo. Sem a
 * espera, a primeira copia sairia sem `_fbp` (primeira visita) ou com o clique
 * do anuncio anterior (remarketing). Bloqueado, ele nunca carrega, e o lote sai
 * no teto.
 */
const ESPERA_PIXEL_MS = 5000;

type CopiaComUrl = CopiaPendente & { url: string };
const fila: CopiaComUrl[] = [];
let timer: number | undefined;
let saidaInstalada = false;

/** Coloca um evento ja disparado no Pixel na fila da copia pelo servidor. */
export function copiarParaServidor(copia: CopiaPendente, urgente = false): void {
  try {
    fila.push({ ...copia, url: window.location.href });
    instalarSaida();
    if (urgente) enviarFila(true);
    else agendar();
  } catch {
    // Mesmo motivo do `rastrear`.
  }
}

function agendar(): void {
  if (timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    enviarFila(false);
  }, ESPERA_LOTE_MS);
}

/** O stub do snippet so enfileira; o `callMethod` e do fbevents.js, quando ele ja rodou. */
function pixelCarregado(): boolean {
  const fbq = window.fbq as { callMethod?: unknown } | undefined;
  return typeof fbq?.callMethod === "function";
}

/** `forcar`: manda mesmo sem o fbevents.js (a pagina esta saindo, ou o clique navega). */
function enviarFila(forcar: boolean): void {
  if (!fila.length) return;
  if (!forcar && !pixelCarregado() && performance.now() < ESPERA_PIXEL_MS) {
    agendar();
    return;
  }
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  while (fila.length) {
    const corpo = JSON.stringify({ eventos: fila.splice(0, MAX_COPIAS_POR_LOTE) });
    // `sendBeacon` sobrevive a navegacao e ao fechar da aba, que e quando o
    // ultimo lote sai. `text/plain` e nao JSON: tipo "simples", que nenhum
    // navegador recusa no beacon. Falhou (fila do navegador cheia, API
    // ausente): `fetch` com `keepalive`, que tambem sobrevive a saida.
    let foi = false;
    try {
      foi = navigator.sendBeacon?.(ROTA, new Blob([corpo], { type: "text/plain;charset=UTF-8" })) ?? false;
    } catch {
      foi = false;
    }
    if (!foi) {
      void fetch(ROTA, { method: "POST", body: corpo, keepalive: true, credentials: "same-origin" }).catch(() => {});
    }
  }
}

/** Ao sair (trocar de aba, fechar, navegar), o que estiver na fila sai junto. */
function instalarSaida(): void {
  if (saidaInstalada) return;
  saidaInstalada = true;
  window.addEventListener("pagehide", () => enviarFila(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") enviarFila(true);
  });
}
