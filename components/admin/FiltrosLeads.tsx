"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { STATUS, type Status } from "@/lib/form/types";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";
import { cn } from "@/lib/utils";

type Filtro = Status | "todos";

const ABAS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  ...STATUS.map((s) => ({ valor: s as Filtro, rotulo: ROTULO_STATUS[s] })),
];

/**
 * Filtro e busca vivem na URL, nao no estado do componente: assim a Mel pode
 * favoritar "aguardando revisao" e o botao voltar do navegador funciona.
 */
export function FiltrosLeads({
  statusAtual,
  termoAtual,
}: {
  statusAtual: Filtro;
  termoAtual: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [termo, setTermo] = useState(termoAtual);

  // Debounce: buscar a cada tecla dispararia um request por letra digitada.
  useEffect(() => {
    if (termo === termoAtual) return;

    const t = setTimeout(() => {
      const proximos = new URLSearchParams(params.toString());
      if (termo.trim()) proximos.set("q", termo.trim());
      else proximos.delete("q");
      router.replace(`/admin?${proximos.toString()}`);
    }, 300);

    return () => clearTimeout(t);
  }, [termo, termoAtual, params, router]);

  function trocarStatus(valor: Filtro) {
    const proximos = new URLSearchParams(params.toString());
    if (valor === "todos") proximos.delete("status");
    else proximos.set("status", valor);
    router.replace(`/admin?${proximos.toString()}`);
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
            onClick={() => trocarStatus(aba.valor)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              statusAtual === aba.valor
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
