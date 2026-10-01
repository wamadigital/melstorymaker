// Sinais entre as ilhas da LP, sem estado global nem dependência nova: um
// evento no `window`. O visualizador de Reels avisa quando abre e fecha, e o
// hero, a galeria e a barra fixa reagem (pausar, sumir).

const EVENTO = "lp:visualizador";

/** O último estado avisado: quem começa a tocar depois (o hero, no `load`) precisa saber. */
let aberto = false;

export function avisarVisualizador(estado: boolean): void {
  aberto = estado;
  window.dispatchEvent(new CustomEvent<boolean>(EVENTO, { detail: estado }));
}

export function visualizadorAberto(): boolean {
  return aberto;
}

export function ouvirVisualizador(fn: (aberto: boolean) => void): () => void {
  const ouvinte = (e: Event) => fn((e as CustomEvent<boolean>).detail);
  window.addEventListener(EVENTO, ouvinte);
  return () => window.removeEventListener(EVENTO, ouvinte);
}

/**
 * Autoplay só quando faz sentido: quem pediu menos movimento ou está no modo
 * economia de dados (Android) fica com o pôster. O vídeo continua a um toque.
 */
export function podeAutoplay(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return conexao?.saveData !== true;
}

/**
 * Prepara um `<video>` para autoplay mudo. O React não escreve o atributo
 * `muted` no elemento, e o WebKit decide o autoplay por ele: sem isto o iOS
 * recusa o `play()`.
 */
export function silenciar(v: HTMLVideoElement): void {
  v.muted = true;
  v.defaultMuted = true;
  v.setAttribute("muted", "");
  v.setAttribute("playsinline", "");
}
