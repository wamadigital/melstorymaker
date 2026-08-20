"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CATEGORIAS, type Categoria } from "@/lib/form/types";
import { rotuloCategoria } from "@/lib/admin/rotulos";
import { cn } from "@/lib/utils";

type Filtro = Categoria | "todas";

// Os chips filtravam por STATUS; agora as colunas do quadro SAO o status, entao
// filtrar por status seria pedir para esconder uma coluna inteira. Categoria e o
// recorte que sobra e que a Mel usa de verdade ("so os casamentos").
const ABAS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  ...CATEGORIAS.map((c) => ({ valor: c as Filtro, rotulo: rotuloCategoria(c) })),
];

/**
 * Filtro e busca vivem na URL, nao no estado do componente: assim a Mel pode
 * favoritar "so casamentos" e o botao voltar do navegador funciona.
 */
export function FiltrosLeads({
  categoriaAtual,
  termoAtual,
}: {
  categoriaAtual: Filtro;
  termoAtual: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // usePathname e nao "/admin" cravado: com a rota hardcoded, mover a pagina
  // quebraria a busca em silencio, sem erro de tipo.
  const caminho = usePathname();
  const [termo, setTermo] = useState(termoAtual);

  // Debounce: buscar a cada tecla dispararia um request por letra digitada.
  useEffect(() => {
    if (termo === termoAtual) return;

    const t = setTimeout(() => {
      const proximos = new URLSearchParams(params.toString());
      if (termo.trim()) proximos.set("q", termo.trim());
      else proximos.delete("q");
      router.replace(`${caminho}?${proximos.toString()}`);
    }, 300);

    return () => clearTimeout(t);
  }, [termo, termoAtual, params, router, caminho]);

  function trocarCategoria(valor: Filtro) {
    const proximos = new URLSearchParams(params.toString());
    if (valor === "todas") proximos.delete("categoria");
    else proximos.set("categoria", valor);
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar por nome"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          className="h-10 pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {ABAS.map((aba) => (
          <button
            key={aba.valor}
            type="button"
            onClick={() => trocarCategoria(aba.valor)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              categoriaAtual === aba.valor
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            {aba.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
