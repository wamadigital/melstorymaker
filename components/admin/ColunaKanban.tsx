"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { TEMA_COLUNA, ROTULO_STATUS } from "@/lib/admin/rotulos";
import { TAMANHO_LOTE_KANBAN } from "@/lib/admin/paginacao-kanban";
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
  carregando?: boolean;
  erroCarga?: string;
  onCarregarMais?: () => void;
  /** Não alterar a lista embaixo de um cartão sendo arrastado. */
  cargaPausada?: boolean;
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
  carregando = false,
  erroCarga,
  onCarregarMais,
  cargaPausada = false,
  children,
}: Props) {
  const tema = TEMA_COLUNA[status];
  const idCorpo = `coluna-${status}`;
  const sentinelaRef = useRef<HTMLDivElement>(null);
  const carregarRef = useRef(onCarregarMais);
  const temMais = mostrando < total;
  const permiteCarga = !!onCarregarMais;

  useEffect(() => { carregarRef.current = onCarregarMais; }, [onCarregarMais]);

  useEffect(() => {
    const alvo = sentinelaRef.current;
    if (!alvo || !temMais || !permiteCarga || carregando || erroCarga || cargaPausada ||
      typeof IntersectionObserver === "undefined") return;
    let ativo = true;
    // A viewport também considera o recorte das colunas roláveis no desktop.
    // No celular acompanha a página; display:none do accordion não intersecta.
    const observador = new IntersectionObserver((entradas) => {
      if (ativo && entradas.some((entrada) => entrada.isIntersecting)) carregarRef.current?.();
    }, { root: null, rootMargin: "0px 0px 120px 0px", threshold: 0 });
    observador.observe(alvo);
    return () => { ativo = false; observador.disconnect(); };
  }, [temMais, permiteCarga, mostrando, total, carregando, erroCarga, cargaPausada, aberta]);

  return (
    <section
      ref={refDrop}
      className={cn(
        "flex min-w-[248px] flex-col overflow-hidden rounded-lg border transition-all",
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
          {/* O título completo continua disponível mesmo quando truncado. */}
          <span title={ROTULO_STATUS[status]} className={cn("truncate text-sm font-semibold", tema.titulo)}>
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
        aria-busy={carregando || undefined}
        className={cn(
          "space-y-2 p-2",
          // Rolagem so no desktop: no mobile quem rola e a pagina, senao a
          // secao viraria uma caixinha rolavel dentro de outra.
          "sm:flex-1 sm:overflow-y-auto sm:overscroll-y-contain",
          tema.corpo,
          !aberta && "hidden sm:block",
        )}
      >
        {children}

        {(temMais || carregando || erroCarga || total > TAMANHO_LOTE_KANBAN) && (
          <div ref={sentinelaRef} data-carregar-coluna={status} className="space-y-2 px-1 py-2 text-center">
            <p className="text-[0.6875rem] text-muted-foreground">
              Mostrando {mostrando} de {total}
            </p>
            {carregando ? (
              <p role="status" className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                Carregando mais cards…
              </p>
            ) : erroCarga ? (
              <p role="alert" className="text-xs text-destructive">{erroCarga}</p>
            ) : null}
            {!carregando && onCarregarMais && (temMais || erroCarga) && (
              <button
                type="button"
                onClick={onCarregarMais}
                disabled={cargaPausada}
                aria-label={`${erroCarga ? "Tentar novamente em" : "Carregar mais cards de"} ${ROTULO_STATUS[status]}`}
                className="min-h-11 rounded-md px-3 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              >
                {erroCarga ? "Tentar novamente" : "Carregar mais"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
