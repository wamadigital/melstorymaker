"use client";

import { normalizarOpcoes } from "@/lib/form/engine";
import { OpcaoEscolha } from "../OpcaoEscolha";
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
    <div role="radiogroup" aria-label={passo.pergunta} className="flex w-full max-w-md flex-col gap-2.5">
      {opcoes.map((opcao, i) => (
        <OpcaoEscolha
          key={opcao.valor}
          role="radio"
          aria-checked={valor === opcao.valor}
          letra={String.fromCharCode(65 + i)}
          rotulo={opcao.rotulo}
          selecionada={valor === opcao.valor}
          onClick={() => escolher(opcao.valor)}
        />
      ))}
    </div>
  );
}
