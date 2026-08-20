"use client";

import { useDroppable } from "@dnd-kit/core";
import { ROTULO_STATUS, TEMA_COLUNA } from "@/lib/admin/rotulos";
import { recusarMovimento } from "@/lib/admin/status";
import { STATUS, type Status } from "@/lib/form/types";
import { cn } from "@/lib/utils";

/**
 * Alvos de drop fixos no topo, so no celular e so durante o arraste.
 *
 * Existe porque no mobile as colunas viram um accordion empilhado: arrastar da
 * primeira secao ate a quarta dependeria do auto-scroll do dnd-kit, que e
 * reconhecidamente lento em mobile (issue #1992). Com a faixa, o alvo esta
 * sempre a meia tela do dedo e nenhum arraste precisa rolar nada.
 *
 * Se um dia a faixa se provar instavel num Android real, o caminho e desligar o
 * arraste no mobile inteiro (nao passar `handle` ao CartaoLead quando compacto):
 * o item "Mover para" do menu de acoes ja cobre 100% dos movimentos, sem gesto.
 */
export function FaixaDestinos({
  visivel,
  de,
  temProposta,
}: {
  visivel: boolean;
  de: Status | null;
  temProposta: boolean;
}) {
  if (!visivel || !de) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 top-0 z-40 grid grid-cols-4 gap-1.5 border-b p-2",
        "bg-background/95 backdrop-blur sm:hidden",
      )}
    >
      {STATUS.map((status) => (
        <ChipDestino key={status} status={status} de={de} temProposta={temProposta} />
      ))}
    </div>
  );
}

function ChipDestino({
  status,
  de,
  temProposta,
}: {
  status: Status;
  de: Status;
  temProposta: boolean;
}) {
  const recusa = recusarMovimento(de, status, { temProposta });
  const proibido = !!recusa && recusa !== "mesmo_status";
  const tema = TEMA_COLUNA[status];

  // Nunca `disabled`: o closestCorners elegeria o chip vizinho e o cartao cairia
  // na coluna errada em silencio. Recebendo o drop, `mover()` recusa e explica.
  const { setNodeRef, isOver } = useDroppable({ id: `destino:${status}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-center",
        tema.fundo,
        proibido && "opacity-40",
        isOver && !proibido && "ring-2 ring-inset",
        isOver && !proibido && tema.alvo,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-sm", tema.ponto)} />
      <span className={cn("text-[0.625rem] leading-tight font-medium", tema.titulo)}>
        {ROTULO_STATUS[status]}
      </span>
    </div>
  );
}
