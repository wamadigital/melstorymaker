"use client";

import { ChevronUp, Play, Volume2, VolumeX, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { EVENTO_LP } from "@/lib/meta/eventos";
import { rastrearComCopia } from "@/lib/meta/pixel";
import { cn } from "@/lib/utils";
import { CLASSE_CTA, hrefFormulario } from "./CtaFormulario";
import { avisarVisualizador, podeAutoplay, silenciar } from "./sinais";

export type ReelLp = {
  id: string;
  espaco: string;
  quando: string;
  video: string;
  preview: string;
  poster: string;
  temAudio: boolean;
};

/** Quanto do card precisa estar à vista para o preview dele tocar. */
const VISIVEL = 0.6;
/** Segurar o dedo por mais que isto pausa o Reel (como no Instagram). */
const SEGURAR_MS = 250;

/**
 * Galeria de Reels + visualizador em tela cheia, no mesmo componente porque o
 * toque no card precisa mexer, SINCRONAMENTE, no `<video>` do visualizador.
 *
 * Por que um `<video>` só no visualizador, e não um por slide: o WebKit pausa o
 * vídeo que ganha som fora de um gesto do usuário, e o fim de um swipe não é
 * gesto. Um elemento que já tocou com som dentro de um toque fica liberado, e
 * aí trocar de casamento é só trocar o `src`. Os slides são pôsteres; o vídeo
 * fica fixo por cima e só aparece com o slide parado.
 *
 * Na galeria, no máximo um preview com `src` por vez (o card mais visível). Ao
 * sair do card o `src` é removido, e não só pausado: `pause()` não para o
 * download nem libera o decodificador.
 */
export function GaleriaReels({ reels }: { reels: readonly ReelLp[] }) {
  const [lista, setLista] = useState(reels);
  const trilhoRef = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);
  const [galeriaVisivel, setGaleriaVisivel] = useState(false);
  const [autoplay, setAutoplay] = useState(false);

  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState(0);
  const [mudo, setMudo] = useState(false);
  const [semSom, setSemSom] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [mostrarVideo, setMostrarVideo] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rolagemRef = useRef<HTMLDivElement>(null);
  const atualRef = useRef(0);
  const querSomRef = useRef(true);
  const rastreados = useRef(new Set<string>());
  const fimRolagem = useRef<number | undefined>(undefined);
  const segurar = useRef<{ timer?: number; segurou: boolean }>({ segurou: false });
  /** O estado de verdade para timers e promises, que veem o `aberto` de uma renderização velha. */
  const abertoRef = useRef(false);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const cardDeOrigem = useRef<HTMLButtonElement | null>(null);

  // `?reel=<id>` (um por criativo do anúncio) põe o Reel que a pessoa acabou
  // de ver em primeiro. Lido no navegador porque a página é estática; a galeria
  // fica abaixo do hero, então a troca não mexe em nada que está na tela.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("reel");
    const i = id ? reels.findIndex((r) => r.id === id) : -1;
    if (i > 0) setLista([reels[i], ...reels.slice(0, i), ...reels.slice(i + 1)]);
    setAutoplay(podeAutoplay());
  }, [reels]);

  // Os pôsteres da galeria só entram depois do `load`, e então todos de uma
  // vez (eager). Antes, para não disputar banda com o LCP do hero: a galeria
  // fica abaixo da dobra, e ~450 KB de pôsteres baixando junto com o pôster do
  // hero eram o que mais pesava no LCP medido pelo Lighthouse. Eager, e não
  // lazy, porque o lazy-load do WebKit (até 2025) só carregava imagem de
  // carrossel quando ela já estava visível: o card entrava vazio no swipe.
  const [posteres, setPosteres] = useState(false);
  useEffect(() => {
    const liberar = () => setPosteres(true);
    if (document.readyState === "complete") liberar();
    else {
      window.addEventListener("load", liberar, { once: true });
      return () => window.removeEventListener("load", liberar);
    }
  }, []);

  // Preview: o card mais visível dentro do trilho, só com a galeria na tela.
  useEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const fracoes = new Map<number, number>();
    const cards = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) fracoes.set(Number((e.target as HTMLElement).dataset.indice), e.intersectionRatio);
        let melhor: number | null = null;
        let maior = VISIVEL;
        for (const [i, f] of fracoes) {
          if (f >= maior) {
            maior = f;
            melhor = i;
          }
        }
        setAtivo(melhor);
      },
      { root: trilho, threshold: [0, VISIVEL, 0.8, 1] },
    );
    trilho.querySelectorAll<HTMLElement>("[data-indice]").forEach((el) => cards.observe(el));
    const secao = new IntersectionObserver(([e]) => setGaleriaVisivel(e.isIntersecting), { threshold: 0.35 });
    secao.observe(trilho);
    return () => {
      cards.disconnect();
      secao.disconnect();
    };
  }, [lista]);

  const reelAtual = lista[atual];

  const rastrearMarco = useCallback((id: string, marco: "abriu" | "metade" | "fim") => {
    const chave = `${id}:${marco}`;
    if (rastreados.current.has(chave)) return;
    rastreados.current.add(chave);
    rastrearComCopia("trackCustom", EVENTO_LP.assistiuReel, { reel: id, marco });
  }, []);

  /** Toca o Reel `i` no vídeo do visualizador. Com som se a pessoa quer e o arquivo tem trilha. */
  const tocar = useCallback(
    (i: number) => {
      const v = videoRef.current;
      const r = lista[i];
      if (!v || !r) return;
      if (v.dataset.reel !== r.id) {
        setMostrarVideo(false);
        setProgresso(0);
        v.src = r.video;
        v.dataset.reel = r.id;
      }
      v.muted = !querSomRef.current || !r.temAudio;
      setMudo(v.muted);
      setSemSom(!r.temAudio);
      setPausado(false);
      // Só `NotAllowedError` é "som recusado". `AbortError` é o play() anterior
      // sendo interrompido pela troca de `src` (swipe antes de o Reel começar):
      // tratá-lo como recusa deixava MUDO o Reel para onde a pessoa deslizou.
      const doMesmoReel = () => abertoRef.current && v.dataset.reel === r.id;
      v.play().catch((e: unknown) => {
        if ((e as Error | undefined)?.name !== "NotAllowedError" || !doMesmoReel()) return;
        // Som recusado fora de gesto (ou modo economia): segue mudo e a tela
        // pede um toque para ouvir.
        v.muted = true;
        setMudo(true);
        v.play().catch((e2: unknown) => {
          if ((e2 as Error | undefined)?.name === "NotAllowedError" && doMesmoReel()) setPausado(true);
        });
      });
      rastrearMarco(r.id, "abriu");
    },
    [lista, rastrearMarco],
  );

  const fechar = useCallback(() => {
    abertoRef.current = false;
    // Timers pendentes de um swipe ou de um "segurar" tocariam o próximo Reel
    // com som por baixo da página já fechada.
    window.clearTimeout(fimRolagem.current);
    window.clearTimeout(segurar.current.timer);
    segurar.current.segurou = false;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      delete v.dataset.reel;
      v.load();
    }
    setAberto(false);
    setMostrarVideo(false);
    document.documentElement.classList.remove("lp-travado");
    avisarVisualizador(false);
  }, []);

  // O foco volta ao card que abriu (teclado e leitor de tela). Num effect, e
  // não dentro de `fechar`: até esta renderização a galeria ainda está `inert`,
  // e foco em elemento inerte não pega.
  useEffect(() => {
    if (!aberto) cardDeOrigem.current?.focus({ preventScroll: true });
  }, [aberto]);

  /** Chamado DENTRO do toque no card: é o gesto que libera o som no iOS. */
  function abrir(i: number, card: HTMLButtonElement) {
    const v = videoRef.current;
    const rolagem = rolagemRef.current;
    // Já aberto (Enter/Espaço no card que ficou focado por trás): não empilha
    // outra entrada no histórico.
    if (!v || !rolagem || abertoRef.current) return;
    abertoRef.current = true;
    cardDeOrigem.current = card;
    querSomRef.current = true;
    atualRef.current = i;
    setAtual(i);
    setAberto(true);
    document.documentElement.classList.add("lp-travado");
    avisarVisualizador(true);
    // Uma entrada no histórico, sem URL: o "voltar" do Android fecha o
    // visualizador em vez de sair da página.
    window.history.pushState({ visualizador: true }, "");
    rolagem.scrollTo({ top: i * rolagem.clientHeight, behavior: "instant" as ScrollBehavior });
    tocar(i);
    // Foco dentro do diálogo (depois do play, que precisa ser síncrono no toque).
    requestAnimationFrame(() => fecharRef.current?.focus({ preventScroll: true }));
  }

  // Voltar do navegador (e o X, que chama history.back) fecha.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.documentElement.classList.contains("lp-travado")) fechar();
    };
    // Volta pelo bfcache (o lead foi ao formulário e voltou): começa limpo.
    const aoMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) fechar();
    };
    window.addEventListener("popstate", aoVoltar);
    window.addEventListener("pageshow", aoMostrar);
    return () => {
      window.removeEventListener("popstate", aoVoltar);
      window.removeEventListener("pageshow", aoMostrar);
    };
  }, [fechar]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.history.back();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto]);

  // Swipe: some o vídeo enquanto rola (os pôsteres acompanham o dedo) e, com
  // a rolagem parada, toca o slide que ficou na tela.
  function aoRolar() {
    const rolagem = rolagemRef.current;
    if (!rolagem || !aberto) return;
    setMostrarVideo(false);
    window.clearTimeout(fimRolagem.current);
    fimRolagem.current = window.setTimeout(() => {
      if (!abertoRef.current) return;
      const i = Math.round(rolagem.scrollTop / rolagem.clientHeight);
      if (i !== atualRef.current) {
        atualRef.current = i;
        setAtual(i);
        tocar(i);
      } else {
        setMostrarVideo(!videoRef.current?.paused);
      }
    }, 120);
  }

  // Toque: liga/desliga o som. Segurar: pausa enquanto o dedo estiver na tela.
  function aoApertar() {
    segurar.current.segurou = false;
    segurar.current.timer = window.setTimeout(() => {
      segurar.current.segurou = true;
      videoRef.current?.pause();
      setPausado(true);
    }, SEGURAR_MS);
  }
  function aoSoltar() {
    window.clearTimeout(segurar.current.timer);
    if (segurar.current.segurou) {
      videoRef.current?.play().catch(() => {});
      setPausado(false);
    }
  }
  /**
   * Toque no Reel: se estava pausado (o sistema pausa sozinho, por exemplo
   * numa ligação), só retoma, sem mexer no som; tocando, liga/desliga o som.
   */
  function alternarSom() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      return;
    }
    if (semSom) return;
    v.muted = !v.muted;
    querSomRef.current = !v.muted;
    setMudo(v.muted);
  }
  /** O clique que encerra um "segurar" não é toque: consome a marca e não mexe no som. */
  function aoTocarPoster() {
    if (segurar.current.segurou) {
      segurar.current.segurou = false;
      return;
    }
    alternarSom();
  }

  function irParaFormulario() {
    rastrearComCopia("trackCustom", EVENTO_LP.cliqueCta, { pagina: "casamento", posicao: "visualizador" }, { urgente: true });
    // `replace`: a entrada do visualizador no histórico não sobra embaixo do
    // formulário (voltar dele cai na LP, não num visualizador fechado).
    window.location.replace(hrefFormulario("visualizador", window.location.search));
  }

  const tocaPreview = galeriaVisivel && autoplay && !aberto;

  return (
    <>
      <div
        ref={trilhoRef}
        inert={aberto}
        className="lp-sem-barra flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 pb-2"
      >
        {lista.map((r, i) => (
          <button
            key={r.id}
            type="button"
            data-indice={i}
            onClick={(e) => abrir(i, e.currentTarget)}
            className="relative aspect-[9/16] w-[64%] max-w-64 shrink-0 snap-start overflow-hidden rounded-md bg-marca-medio text-left transition-transform duration-200 select-none active:scale-[0.98] [-webkit-touch-callout:none]"
          >
            {posteres && (
              <Image
                src={r.poster}
                alt=""
                width={432}
                height={768}
                unoptimized
                draggable={false}
                loading="eager"
                fetchPriority="low"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
            )}
            {tocaPreview && ativo === i && <Preview src={r.preview} />}
            {/* O nome acessível é o texto visível com um prefixo só para leitor
                de tela: um aria-label próprio esconderia o que está escrito no
                card (quem usa comando de voz fala o que vê). */}
            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-marca-escuro/90 via-marca-escuro/50 to-transparent px-3 pb-3 pt-12">
              <span className="sr-only">Assistir o Reel do casamento: </span>
              <span className="text-base font-bold text-marca-creme">{r.espaco}</span>
              <span className="text-sm text-marca-areia">{r.quando}</span>
            </span>
            <span className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-md bg-marca-escuro/60 text-marca-creme">
              <Play aria-hidden className="size-4 fill-current" />
            </span>
          </button>
        ))}
      </div>

      {/* Visualizador. Sempre montado e escondido com `visibility` (não
          `display: none`): o vídeo precisa existir no toque para o play com
          som valer, e o `estilo:verificar` precisa enxergar os controles. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reels de casamento"
        aria-hidden={!aberto}
        inert={!aberto}
        className={cn(
          "lp-escuro fixed inset-0 z-50 bg-marca-escuro transition-opacity duration-200",
          aberto ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <div
          ref={rolagemRef}
          onScroll={aoRolar}
          className="lp-sem-barra h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {lista.map((r, i) => (
            <div key={r.id} className="relative h-dvh snap-start [scroll-snap-stop:always]">
              {/* O pôster é a área de toque: liga/desliga o som, segurar pausa. */}
              {/* Sem `-webkit-touch-callout`, segurar o dedo abre o menu de imagem
                  do iOS (Salvar/Copiar) e o toque vira `pointercancel`. */}
              <button
                type="button"
                onClick={aoTocarPoster}
                onPointerDown={aoApertar}
                onPointerUp={aoSoltar}
                onPointerCancel={aoSoltar}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={mudo ? "Ligar o som" : "Desligar o som"}
                className="absolute inset-0 h-full w-full select-none [-webkit-touch-callout:none] [-webkit-user-drag:none]"
              >
                {/* Só depois do `load` (o visualizador fica montado desde o
                    início, e pôster eager aqui entraria no HTML disputando banda
                    com o LCP) e só o slide atual e os vizinhos. */}
                {posteres && Math.abs(i - atual) <= 1 && (
                  <Image
                    src={r.poster}
                    alt=""
                    fill
                    unoptimized
                    draggable={false}
                    loading="eager"
                    sizes="100vw"
                    className="pointer-events-none object-cover"
                  />
                )}
              </button>
            </div>
          ))}
        </div>

        <video
          ref={videoRef}
          playsInline
          preload="none"
          aria-hidden
          onPlaying={() => setMostrarVideo(true)}
          onPlay={() => setPausado(false)}
          onPause={() => setPausado(true)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (!v.duration) return;
            const f = v.currentTime / v.duration;
            setProgresso(f);
            if (f >= 0.5 && reelAtual) rastrearMarco(reelAtual.id, "metade");
            // 95% e não o `ended`: quem desliza para o próximo nos últimos
            // segundos (os Reels terminam no logo) assistiu o casamento inteiro.
            if (f >= 0.95 && reelAtual) rastrearMarco(reelAtual.id, "fim");
          }}
          onEnded={() => {
            const rolagem = rolagemRef.current;
            if (rolagem && atualRef.current < lista.length - 1) {
              rolagem.scrollTo({ top: (atualRef.current + 1) * rolagem.clientHeight, behavior: "smooth" });
            }
          }}
          className={cn(
            "pointer-events-none fixed inset-0 h-dvh w-full object-cover transition-opacity duration-200",
            mostrarVideo ? "opacity-100" : "opacity-0",
          )}
        />

        {/* Controles por cima de tudo. O contêiner deixa o toque passar para o
            pôster; só os botões o capturam. */}
        {/* Degradês de leitura: os controles ficam sobre o vídeo, que pode ser
            claro (vestido, cerimônia de dia) bem onde está o texto. */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-28 bg-gradient-to-b from-marca-escuro/70 to-transparent" />
        <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 h-96 bg-gradient-to-t from-marca-escuro/90 via-marca-escuro/70 to-transparent" />
        <div className="pointer-events-none fixed inset-0 flex flex-col justify-between pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between px-3">
            <button
              ref={fecharRef}
              type="button"
              onClick={() => window.history.back()}
              aria-label="Fechar"
              className="pointer-events-auto flex size-11 items-center justify-center rounded-md bg-marca-escuro/60 text-marca-creme"
            >
              <X aria-hidden className="size-6" />
            </button>
            {!semSom && (
              <button
                type="button"
                onClick={alternarSom}
                aria-label={mudo ? "Ligar o som" : "Desligar o som"}
                className="pointer-events-auto flex h-11 items-center gap-2 rounded-md bg-marca-escuro/60 px-3 text-sm font-bold text-marca-creme"
              >
                {mudo ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
                {mudo ? "Toque para ouvir" : "Com som"}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 px-4">
            {reelAtual && (
              <p className="flex flex-col [text-shadow:0_1px_3px_rgb(var(--marca-escuro-rgb)/0.9)]">
                <span className="text-lg font-bold text-marca-creme">{reelAtual.espaco}</span>
                <span className="text-sm text-marca-creme/90">
                  {reelAtual.quando}
                  {pausado ? " · pausado" : ""}
                </span>
              </p>
            )}
            <button
              type="button"
              onClick={irParaFormulario}
              className={cn(
                "pointer-events-auto inline-flex h-14 w-full items-center justify-center rounded-md px-6 text-lg font-bold transition-transform duration-200 active:scale-[0.98]",
                CLASSE_CTA.claro,
              )}
            >
              Consultar nossa data
            </button>
            <div className="h-1 w-full overflow-hidden bg-marca-creme/25" aria-hidden>
              <div className="h-full bg-marca-creme" style={{ width: `${Math.round(progresso * 1000) / 10}%` }} />
            </div>
            {atual < lista.length - 1 && (
              <p className="flex items-center justify-center gap-1 text-xs text-marca-areia" aria-hidden>
                <ChevronUp className="size-4" /> Deslize para ver o próximo casamento
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Preview mudo do card. Montado só para o card ativo e desmontado ao sair dele. */
function Preview({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    silenciar(v);
    v.src = src;
    v.play().catch(() => {});
    return () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [src]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      loop
      preload="auto"
      aria-hidden
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
