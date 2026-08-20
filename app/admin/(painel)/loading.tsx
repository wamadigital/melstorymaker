import { STATUS } from "@/lib/form/types";
import { TEMA_COLUNA } from "@/lib/admin/rotulos";
import { cn } from "@/lib/utils";

/**
 * Esqueleto do quadro. Antes o painel nao tinha loading nenhum: trocar de filtro
 * congelava a tela ate o servidor responder, sem nada dizendo que algo acontecia.
 */
export default function CarregandoQuadro() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-32 animate-pulse rounded-md bg-foreground/10" />
      <div className="h-10 w-full animate-pulse rounded-lg bg-foreground/5" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATUS.map((status) => (
          <div key={status} className="overflow-hidden rounded-lg border">
            <div className={cn("h-11", TEMA_COLUNA[status].fundo)} />
            <div className={cn("space-y-2 p-2", TEMA_COLUNA[status].corpo)}>
              <div className="h-20 animate-pulse rounded-lg bg-card" />
              <div className="h-20 animate-pulse rounded-lg bg-card" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
