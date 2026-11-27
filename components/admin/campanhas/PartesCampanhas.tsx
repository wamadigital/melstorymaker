import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Paginacao({ pagina, mais, mudar }: { pagina: number; mais: boolean; mudar: (pagina: number) => void }) {
  if (!pagina && !mais) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={pagina === 0} onClick={() => mudar(pagina - 1)}>Anterior</Button>
      <span className="px-1 text-sm text-muted-foreground">Página {pagina + 1}</span>
      <Button type="button" variant="outline" disabled={!mais} onClick={() => mudar(pagina + 1)}>Próxima</Button>
    </div>
  );
}

export function Selecao({ className, ...props }: React.ComponentProps<"select">) {
  return <select {...props} className={cn("h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} />;
}

export function Campo({ titulo, children, htmlFor }: { titulo: string; children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="grid min-w-0 gap-1.5 text-sm font-medium"><span>{titulo}</span>{children}</label>;
}
