"use client";

import { ChevronDown } from "lucide-react";
import { TEMA_COLUNA, ROTULO_STATUS } from "@/lib/admin/rotulos";
import type { Status } from "@/lib/form/types";
import { cn } from "@/lib/utils";

type Props = {
  status: Status;
  total: number;
  /** Quantos cartoes vieram (pode ser menor que `total`, que e o count real). */
  mostrando: number;
  aberta: boolean;
  onAlternar: () => void;
  /** Cartao pairando sobre esta coluna. */
  alvo?: boolean;
  /** Ha um arraste em curso e esta coluna nao aceita o cartao. */
  apagada?: boolean;
  refDrop?: (el: HTMLElement | null) => void;
  children: React.ReactNode;
};

/**
 * Uma raia do quadro.
 *
 * Mobile: secao de accordion, empilhada -- nunca ha scroll horizontal, que e o
 * requisito de 360px do projeto. Desktop: coluna com cabecalho grudado e corpo
 * rolavel, sempre aberta (o `aberta` so vale no mobile, via CSS).
 */
export function ColunaKanban({
  status,
  total,
  mostrando,
  aberta,
  onAlternar,
  alvo = false,
  apagada = false,
  refDrop,
  children,
}: Props) {
  const tema = TEMA_COLUNA[status];
  const idCorpo = `coluna-${status}`;

  return (
    <section
      ref={refDrop}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border transition-all",
        alvo && "ring-2 ring-inset",
        alvo && tema.alvo,
        apagada && "opacity-50",
        "sm:h-[calc(100dvh-15rem)] sm:min-h-80",
      )}
    >
      <h2>
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={aberta}
          aria-controls={idCorpo}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
            tema.fundo,
            // No desktop a coluna e sempre aberta: o cabecalho vira so titulo,
            // sem afordancia de clique.
            "sm:pointer-events-none sm:cursor-default",
          )}
        >
          <span aria-hidden className={cn("size-2 shrink-0 rounded-sm", tema.ponto)} />
          <span className={cn("truncate text-sm font-semibold", tema.titulo)}>
            {ROTULO_STATUS[status]}
          </span>
          <span className="ml-auto rounded-md bg-black/5 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {total}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform sm:hidden",
              aberta && "rotate-180",
            )}
          />
        </button>
      </h2>

      <div
        id={idCorpo}
        className={cn(
          "space-y-2 p-2",
          // Rolagem so no desktop: no mobile quem rola e a pagina, senao a
          // secao viraria uma caixinha rolavel dentro de outra.
          "sm:flex-1 sm:overflow-y-auto sm:overscroll-contain",
          tema.corpo,
          !aberta && "hidden sm:block",
        )}
      >
        {children}

        {mostrando < total && (
          <p className="px-1 pt-1 text-center text-[0.6875rem] text-muted-foreground">
            Mostrando os {mostrando} mais recentes de {total} — use a busca para achar um lead
            antigo.
          </p>
        )}
      </div>
    </section>
  );
}
