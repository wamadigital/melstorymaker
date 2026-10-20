"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Recarga completa para o painel aberto como aplicativo, sem barra do navegador. */
export function BotaoAtualizar() {
  function atualizar() {
    // refresh() do App Router preserva o JavaScript que ja esta aberto.
    // A URL unica busca um documento novo, com os assets da versao publicada.
    // Mantem filtros/ancora, login e a protecao beforeunload de dados nao salvos.
    const destino = new URL(window.location.href);
    destino.searchParams.set("_atualizar", Date.now().toString());
    window.location.replace(destino.href);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 sm:hidden"
      aria-label="Atualizar aplicativo"
      title="Atualizar aplicativo"
      onClick={atualizar}
    >
      <RotateCw aria-hidden="true" className="size-4" />
    </Button>
  );
}
