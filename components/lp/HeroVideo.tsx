"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ouvirVisualizador, podeAutoplay, silenciar, visualizadorAberto } from "./sinais";

/**
 * O quadro do hero: um recorte 4:3 nos noivos com cara de visor de câmera
 * (REC, contador, cantos de enquadramento) -- é o celular da Mel gravando.
 * Até 03/10/2026 o vídeo era o FUNDO da tela inteira, com o título por cima, e
 * as pétalas claras comiam a leitura do texto. Agora o texto fica no escuro
 * liso e o vídeo, no quadro. O visor é decoração (`aria-hidden`); quem lê tela
 * ouve o `alt` do pôster.
 *
 * O pôster é o LCP, o teaser mudo entra por cima depois.
 *
 * O HTML do servidor traz o `<video>` SEM `src`: com `autoplay` no HTML o
 * download do MP4 começaria no parse e disputaria banda com o pôster e as
 * fontes no 4G. O `src` só entra depois do `load` (e de um respiro do
 * navegador), e o vídeo só aparece quando
 * está de fato tocando -- até lá (ou para sempre, se o autoplay for recusado)
 * fica o pôster, que é o 1º quadro do teaser e não pula na troca.
 */
export function HeroVideo({ teaser, poster, alt }: { teaser: string; poster: string; alt: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [tocando, setTocando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const naTela = useRef(true);

  // O contador do REC corre enquanto o teaser toca e para com ele (fora da
  // tela, visualizador aberto). Conta o tempo assistido, não o `currentTime`:
  // o teaser tem 6 s em loop, e um contador que volta a zero entregaria o loop.
  useEffect(() => {
    if (!gravando) return;
    const id = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [gravando]);

  /** Toca só se faz sentido agora: com o hero na tela e o visualizador fechado. */
  const retomar = () => {
    const v = ref.current;
    if (!v?.src || !naTela.current || visualizadorAberto()) return;
    v.play().catch(() => {
      // Autoplay recusado (modo economia do iOS): o pôster fica.
    });
  };

  useEffect(() => {
    const v = ref.current;
    if (!v || !podeAutoplay()) return;
    const iniciar = () => {
      silenciar(v);
      v.src = teaser;
      retomar();
    };
    // Depois do `load` E de um respiro do navegador: os ~600 KB do teaser não
    // disputam banda com os pôsteres da galeria, que entram no `load`. Até lá
    // fica o pôster, que é o 1º quadro do teaser.
    let ocioso: number | undefined;
    const agendar = () => {
      ocioso =
        "requestIdleCallback" in window
          ? window.requestIdleCallback(iniciar, { timeout: 2000 })
          : (globalThis.setTimeout(iniciar, 1000) as unknown as number);
    };
    if (document.readyState === "complete") agendar();
    else window.addEventListener("load", agendar, { once: true });
    return () => {
      window.removeEventListener("load", agendar);
      if (ocioso === undefined) return;
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(ocioso);
      else globalThis.clearTimeout(ocioso);
    };
  }, [teaser]);

  // Fora da tela, ou com o visualizador aberto, o hero pausa. O navegador não
  // faz isso sozinho: a pausa automática de vídeo invisível (WebKit e
  // Chromium) só vale para quem tem o atributo `autoplay`, e este toca por
  // `play()`. Dois vídeos decodificando ao mesmo tempo é o que faz o WebKit
  // matar a aba por memória.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const obs = new IntersectionObserver(([e]) => {
      naTela.current = e.isIntersecting;
      if (e.isIntersecting) retomar();
      else v.pause();
    });
    obs.observe(v);
    const parar = ouvirVisualizador((aberto) => {
      if (aberto) v.pause();
      else retomar();
    });
    return () => {
      obs.disconnect();
      parar();
    };
    // `retomar` só lê refs e o estado do visualizador: o observer não precisa
    // ser recriado a cada renderização.
  }, []);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-marca-medio">
      {/* `priority` no Next 15 não põe `fetchpriority`: é este o LCP. */}
      <Image
        src={poster}
        alt={alt}
        fill
        priority
        fetchPriority="high"
        unoptimized
        sizes="(min-width: 640px) 536px, calc(100vw - 40px)"
        className="object-cover"
      />
      <video
        ref={ref}
        muted
        playsInline
        loop
        preload="none"
        aria-hidden
        onPlaying={() => {
          setTocando(true);
          setGravando(true);
        }}
        onPause={() => setGravando(false)}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
          tocando ? "opacity-100" : "opacity-0",
        )}
      />
      <Visor segundos={segundos} gravando={gravando} />
    </div>
  );
}

/** "00:00:07". */
function timecode(total: number): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(Math.floor(total / 3600))}:${dois(Math.floor(total / 60) % 60)}:${dois(total % 60)}`;
}

/** A moldura de câmera por cima do vídeo. Só decoração. */
function Visor({ segundos, gravando }: { segundos: number; gravando: boolean }) {
  const canto = "absolute size-6 border-marca-creme/90";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 text-xs font-bold tracking-wider text-marca-creme [text-shadow:0_1px_3px_rgb(var(--marca-escuro-rgb)/0.9)]"
    >
      <span className={cn(canto, "left-3 top-3 border-l-2 border-t-2")} />
      <span className={cn(canto, "right-3 top-3 border-r-2 border-t-2")} />
      <span className={cn(canto, "bottom-3 left-3 border-b-2 border-l-2")} />
      <span className={cn(canto, "bottom-3 right-3 border-b-2 border-r-2")} />
      <span className="absolute left-6 top-5 flex items-center gap-1.5">
        <span
          className={cn(
            "size-2.5 rounded-md bg-marca-terracota ring-1 ring-marca-creme/80",
            gravando && "animate-pulse motion-reduce:animate-none",
          )}
        />
        REC
      </span>
      {/* A DM Sans não tem algarismo de largura fixa (`tabular-nums` não faz
          nada nela): cada dígito numa caixa da mesma largura, senão o contador
          treme de lado a cada segundo. */}
      <span className="absolute right-6 top-5 flex">
        {[...timecode(segundos)].map((c, i) =>
          c === ":" ? (
            <span key={i}>:</span>
          ) : (
            <span key={i} className="inline-block w-[0.76em] text-center">
              {c}
            </span>
          ),
        )}
      </span>
    </div>
  );
}
