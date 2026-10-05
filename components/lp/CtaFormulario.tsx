"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { EVENTO_LP } from "@/lib/meta/eventos";
import { rastrearComCopia } from "@/lib/meta/pixel";
import { repassarQuery } from "@/lib/url";
import { cn } from "@/lib/utils";

export type PosicaoCta = "hero" | "galeria" | "pacotes" | "final" | "fixo" | "visualizador";

/**
 * Destino de todo CTA da LP: o formulário de sempre, em modo casamento, com a
 * query de quem chegou (`fbclid`, `utm_*`). O `cta=` vai na URL para que o
 * PageView do formulário prove de onde veio o clique mesmo quando o
 * `CliqueCTA` se perde na navegação.
 */
export function hrefFormulario(posicao: PosicaoCta, query: string = ""): string {
  return repassarQuery("/formulario", query, { evento: "casamento", cta: posicao });
}

export const CLASSE_CTA = {
  /** Sobre as faixas escuras: creme com texto escuro (14:1). */
  claro: "bg-marca-creme text-marca-escuro hover:bg-marca-areia",
  /** Sobre as faixas creme: terracota com texto creme (6,2:1). */
  terracota: "bg-marca-terracota text-marca-creme hover:bg-marca-medio",
} as const;

/**
 * O botão que leva ao formulário.
 *
 * `<a>` puro, e não `next/link`, de propósito: o `next/script` guarda o
 * snippet do Pixel pelo id, e uma navegação client-side para o formulário não
 * rodaria o snippet de novo -- o formulário ficaria sem PageView.
 *
 * O `href` do servidor não tem a query (a página é estática). Ela entra em
 * três momentos: no script inline do fim da página (antes da hidratação, para
 * quem toca no botão antes de o React acordar), num effect de montagem e no
 * clique. `data-cta` é o que o script procura; `suppressHydrationWarning`
 * porque o script muda o `href` antes de o React comparar.
 */
export function CtaFormulario({
  posicao,
  variante,
  children,
  className,
  id,
}: {
  posicao: PosicaoCta;
  variante: keyof typeof CLASSE_CTA;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.href = hrefFormulario(posicao, window.location.search);
  }, [posicao]);

  return (
    <a
      ref={ref}
      id={id}
      data-cta={posicao}
      href={hrefFormulario(posicao)}
      suppressHydrationWarning
      onClick={() => {
        if (ref.current) ref.current.href = hrefFormulario(posicao, window.location.search);
        // `urgente`: a página vai sair agora, a cópia não espera o lote.
        rastrearComCopia("trackCustom", EVENTO_LP.cliqueCta, { pagina: "casamento", posicao }, { urgente: true });
      }}
      className={cn(
        // `min-h` e não `h`: o CTA da galeria quebra em duas linhas a 360px.
        "inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-2 rounded-md px-6 py-3 text-center text-lg leading-tight font-bold transition-[background-color,transform] duration-200 active:scale-[0.98]",
        CLASSE_CTA[variante],
        className,
      )}
    >
      {children}
      <ArrowRight aria-hidden className="size-5 shrink-0" />
    </a>
  );
}
