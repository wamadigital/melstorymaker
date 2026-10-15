"use client";

import { useEffect, useRef } from "react";
import { EntradaData } from "../EntradaData";
import { dataMinima } from "@/lib/form/engine";
import { devoFocarSozinho, type CampoProps } from "../tipos";

export function CampoData({ passo, valor, onChange, onAvancar, erro }: CampoProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (devoFocarSozinho()) ref.current?.focus();
  }, [passo.id]);

  return (
    <EntradaData
      inputRef={ref}
      min={dataMinima(passo)}
      valor={valor}
      invalida={!!erro}
      rotulo={passo.pergunta}
      onChange={onChange}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onAvancar();
        }
      }}
      className="h-14 w-full rounded-none border-0 border-b-2 border-foreground/20 bg-transparent px-1 text-2xl shadow-none transition-colors placeholder:text-foreground/45 focus-visible:border-foreground focus-visible:ring-0 md:text-3xl"
    />
  );
}
