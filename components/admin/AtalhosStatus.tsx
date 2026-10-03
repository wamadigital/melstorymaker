"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLASSE_ATALHO, ROTULO_ATALHO, ROTULO_STATUS, TEMA_COLUNA } from "@/lib/admin/rotulos";
import { ATALHOS_STATUS, estadoDoAtalho, type AtalhoStatus } from "@/lib/admin/status";
import type { Status } from "@/lib/form/types";
import { cn } from "@/lib/utils";

/**
 * Mover o lead de coluna de dentro do detalhe, sem arrastar (pedido do owner em
 * 03/10/2026). Tres botoes, na cor da coluna de destino: azul para enviado,
 * verde para cliente, cinza para perdido.
 *
 * As regras sao as do quadro (`estadoDoAtalho` usa a mesma `recusarMovimento`):
 * o atalho nunca deixa o que o arraste recusaria. O da coluna atual aparece
 * marcado e sem acao, para a Mel ver onde o lead esta sem procurar o selo.
 *
 * Botao desabilitado nao mostra `title` (o Button do shadcn tem
 * `pointer-events: none` quando desabilitado): por isso o motivo do bloqueio
 * ("Gere a proposta antes...") vai escrito embaixo, e nao em tooltip.
 */
export function AtalhosStatus({
  status,
  temProposta,
  ocupado,
  movendo,
  onMover,
}: {
  status: Status;
  temProposta: boolean;
  /** Outra acao da pagina em andamento: tudo trava. */
  ocupado: boolean;
  /** Destino do movimento em andamento, para o spinner no botao certo. */
  movendo: AtalhoStatus | null;
  onMover: (para: AtalhoStatus) => void;
}) {
  const estados = ATALHOS_STATUS.map((para) => ({ para, ...estadoDoAtalho(status, para, { temProposta }) }));
  const bloqueios = [...new Set(estados.map((e) => e.bloqueio).filter((b): b is string => !!b))];

  return (
    <div className="space-y-1.5">
      <div role="group" aria-label="Mover o lead de coluna" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {estados.map(({ para, atual, bloqueio }) => (
          <Button
            key={para}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={atual}
            disabled={ocupado || atual || !!bloqueio}
            onClick={() => onMover(para)}
            className={cn(
              // Largura cheia no celular: empilhados, tres larguras diferentes
              // ficavam serrilhadas. Do `sm` para cima, lado a lado.
              "h-9 w-full justify-start gap-1.5 px-3 text-sm sm:h-8 sm:w-auto",
              CLASSE_ATALHO[para],
              // A coluna atual: mesma cor, sem acao. Opacidade cheia (o padrao
              // de desabilitado apagaria justamente o "voce esta aqui").
              atual && "disabled:opacity-100",
            )}
          >
            {movendo === para ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : atual ? (
              <Check className="size-3.5" />
            ) : (
              <span aria-hidden className={cn("size-2 shrink-0 rounded-sm", TEMA_COLUNA[para].ponto)} />
            )}
            {atual ? ROTULO_STATUS[para] : ROTULO_ATALHO[para]}
          </Button>
        ))}
      </div>
      {bloqueios.map((b) => (
        <p key={b} className="text-xs text-muted-foreground">
          {b}
        </p>
      ))}
    </div>
  );
}
