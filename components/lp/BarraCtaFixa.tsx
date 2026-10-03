"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CtaFormulario } from "./CtaFormulario";
import { ouvirVisualizador } from "./sinais";

/**
 * Barra de CTA no rodapé da tela.
 *
 * Aparece sempre que o CTA do hero não está INTEIRO na tela: depois que ele
 * sai por cima e também antes de ele entrar por baixo -- em celular baixo
 * (iPhone SE, Android 360x640) a barra do navegador do Instagram empurra o
 * botão do hero para fora da primeira tela. Some quando o CTA final entra, ou
 * quando o visualizador de Reels está aberto: dois botões iguais empilhados,
 * ou um botão por cima do vídeo, só atrapalham.
 *
 * Sempre montada e escondida com `visibility`, não desmontada: o
 * `estilo:verificar` precisa enxergá-la, e montar/desmontar a cada rolagem
 * faria o botão piscar.
 */
export function BarraCtaFixa({ idHero, idFinal }: { idHero: string; idFinal: string }) {
  const [heroInteiro, setHeroInteiro] = useState(true);
  const [finalNaTela, setFinalNaTela] = useState(false);
  const [visualizador, setVisualizador] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(idHero);
    const final = document.getElementById(idFinal);
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (e.target === hero) setHeroInteiro(e.intersectionRatio >= 0.99);
          if (e.target === final) setFinalNaTela(e.isIntersecting);
        }
      },
      { threshold: [0, 0.99, 1] },
    );
    if (hero) obs.observe(hero);
    if (final) obs.observe(final);
    const parar = ouvirVisualizador(setVisualizador);
    return () => {
      obs.disconnect();
      parar();
    };
  }, [idHero, idFinal]);

  const mostrar = !heroInteiro && !finalNaTela && !visualizador;

  return (
    <div
      aria-hidden={!mostrar}
      inert={!mostrar}
      className={cn(
        "lp-escuro fixed inset-x-0 bottom-0 z-40 flex justify-center border-t border-marca-creme/15 bg-marca-escuro/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 transition-[opacity,transform,visibility] duration-300",
        mostrar ? "visible translate-y-0 opacity-100" : "invisible translate-y-full opacity-0",
      )}
    >
      <CtaFormulario posicao="fixo" variante="claro">
        Consultar nossa data
      </CtaFormulario>
    </div>
  );
}
