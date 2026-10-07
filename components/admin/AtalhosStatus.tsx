"use client";

import { ArrowRight, Loader2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLASSE_PERDIDO, CLASSE_PROXIMO_PASSO, ROTULO_ATALHO } from "@/lib/admin/rotulos";
import { estadoDoAtalho, proximoPasso, type AtalhoStatus } from "@/lib/admin/status";
import type { Status } from "@/lib/form/types";
import { cn } from "@/lib/utils";

type PropsMover = {
  status: Status;
  /** Outra acao da pagina em andamento: tudo trava. */
  ocupado: boolean;
  /** Destino do movimento em andamento, para o spinner no botao certo. */
  movendo: AtalhoStatus | null;
  onMover: (para: AtalhoStatus) => void;
};

/**
 * Mover o lead de coluna de dentro do detalhe, sem arrastar. Ate 07/10/2026
 * eram tres botoes lado a lado, um por destino, na tinta de cada coluna; o
 * owner achou confuso e pediu um passo so: o botao mostra o que vem a seguir no
 * funil (`proximoPasso`), em verde solido. "Lead perdido" e a saida do funil e
 * mora no canto do cabecalho (`BotaoPerdido`).
 *
 * As regras sao as do quadro (`estadoDoAtalho` usa a mesma `recusarMovimento`):
 * o botao nunca deixa o que o arraste recusaria. Botao desabilitado nao mostra
 * `title` (o Button do shadcn tem `pointer-events: none` quando desabilitado):
 * por isso o motivo do bloqueio ("Gere a proposta antes...") vai escrito
 * embaixo, e nao em tooltip.
 */
export function ProximoPasso({ status, temProposta, ocupado, movendo, onMover }: PropsMover & { temProposta: boolean }) {
  const para = proximoPasso(status);
  // "Virou cliente" e o fim do funil: nao ha passo, e o selo ao lado do nome ja
  // diz onde o lead esta.
  if (!para) return null;
  const { bloqueio } = estadoDoAtalho(status, para, { temProposta });

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        disabled={ocupado || !!bloqueio}
        onClick={() => onMover(para)}
        // Largura cheia no celular, que e onde a Mel mais abre o lead: o botao
        // e a acao principal da tela e precisa ser o alvo mais facil.
        className={cn("h-10 w-full gap-2 px-4 text-sm sm:w-auto", CLASSE_PROXIMO_PASSO)}
      >
        {movendo === para ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {ROTULO_ATALHO[para]}
      </Button>
      {bloqueio && <p className="text-xs text-muted-foreground">{bloqueio}</p>}
    </div>
  );
}

/**
 * "Lead perdido", no canto do cabecalho, onde antes ficava o "Excluir lead"
 * (que desceu para o fim da pagina). Sem confirmacao, como o arraste para a
 * coluna no quadro. Some quando o lead ja esta perdido -- o selo ao lado do
 * nome diz isso, e um botao travado repetindo o selo seria ruido.
 */
export function BotaoPerdido({ status, ocupado, movendo, onMover, className }: PropsMover & { className?: string }) {
  if (status === "perdido") return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={ocupado}
      onClick={() => onMover("perdido")}
      className={cn("h-8 gap-1.5 px-3 text-sm", CLASSE_PERDIDO, className)}
    >
      {movendo === "perdido" ? <Loader2 className="size-4 animate-spin" /> : <UserX className="size-4" />}
      {ROTULO_ATALHO.perdido}
    </Button>
  );
}
