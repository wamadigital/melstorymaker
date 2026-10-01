"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ouvirVisualizador, podeAutoplay, silenciar, visualizadorAberto } from "./sinais";

/**
 * Fundo do hero: o pôster é o LCP, o teaser mudo entra por cima depois.
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
  const naTela = useRef(true);

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
    <>
      {/* `priority` no Next 15 não põe `fetchpriority`: é este o LCP. */}
      <Image src={poster} alt={alt} fill priority fetchPriority="high" unoptimized sizes="100vw" className="object-cover" />
      <video
        ref={ref}
        muted
        playsInline
        loop
        preload="none"
        aria-hidden
        onPlaying={() => setTocando(true)}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
          tocando ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );
}
