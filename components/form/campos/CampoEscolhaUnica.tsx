"use client";

import { normalizarOpcoes } from "@/lib/form/engine";
import { cn } from "@/lib/utils";
import type { CampoProps } from "../tipos";

export function CampoEscolhaUnica({ passo, valor, onChange, onAvancar }: CampoProps) {
  // normalizarOpcoes resolve as duas formas que convivem no arvore.json:
  // objetos {valor, rotulo} na categoria e strings puras dentro de `fluxos`.
  const opcoes = normalizarOpcoes(passo.opcoes);

  function escolher(v: string) {
    onChange(v);
    // Avanco imediato no clique (estilo Typeform). O valor vai explicito porque
    // o estado do React so atualiza no proximo render.
    onAvancar(v);
  }

  return (
    <div role="radiogroup" aria-label={passo.pergunta} className="flex flex-col gap-3">
      {opcoes.map((opcao) => {
        const selecionada = valor === opcao.valor;
        return (
          <button
            key={opcao.valor}
            type="button"
            role="radio"
            aria-checked={selecionada}
            onClick={() => escolher(opcao.valor)}
            className={cn(
              "w-full rounded-2xl border px-5 py-4 text-left text-lg transition-colors",
              // Alvo de toque confortavel a 360px, sem depender de hover.
              "min-h-14 active:scale-[0.99]",
              selecionada
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/40 hover:bg-accent",
            )}
          >
            {opcao.rotulo}
          </button>
        );
      })}
    </div>
  );
}
