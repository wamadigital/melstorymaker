"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarDays, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIODOS, ROTULO_PERIODO, ehPeriodo, type Periodo } from "@/lib/admin/periodo";
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
  periodoAtual,
}: {
  categoriaAtual: Filtro;
  termoAtual: string;
  periodoAtual: Periodo;
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

  function trocarPeriodo(valor: string | null) {
    const proximos = new URLSearchParams(params.toString());
    // "Todo o periodo" e o padrao, e padrao nao ocupa a URL.
    if (valor && ehPeriodo(valor) && valor !== "todo") proximos.set("periodo", valor);
    else proximos.delete("periodo");
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  return (
    <div className="space-y-3">
      {/* Periodo na mesma linha da busca, estreito e a direita: e um recorte
          de apoio, a busca continua sendo o campo principal. */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            // "Buscar nome" e nao "Buscar por nome": com o periodo ao lado, a
            // frase longa cortava no meio em 360-375px.
            placeholder="Buscar nome"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            className="h-10 pl-9"
          />
        </div>

        {/* `items` faz o gatilho mostrar o rotulo ("Esta semana"), e nao o
            valor da URL ("semana"). */}
        <Select items={ROTULO_PERIODO} value={periodoAtual} onValueChange={trocarPeriodo}>
          <SelectTrigger
            aria-label="Período de chegada do lead"
            className="w-36 shrink-0 data-[size=default]:h-10 sm:w-44"
          >
            {/* Icone so com folga: a 360px a busca precisa da largura. */}
            <CalendarDays className="hidden text-muted-foreground sm:block" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODOS.map((p) => (
              <SelectItem key={p} value={p}>
                {ROTULO_PERIODO[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
