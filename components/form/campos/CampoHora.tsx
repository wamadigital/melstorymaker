"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { devoFocarSozinho, type CampoProps } from "../tipos";

export function CampoHora({ passo, valor, onChange, onAvancar, erro }: CampoProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (devoFocarSozinho()) ref.current?.focus();
  }, [passo.id]);

  return (
    <Input
      ref={ref}
      // Guarda "19:30" (HH:mm). A formatacao pt-BR "19h30" acontece so na borda,
      // no PDF -- nunca no banco.
      type="time"
      value={valor}
      aria-invalid={!!erro}
      aria-label={passo.pergunta}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onAvancar();
        }
      }}
      className="h-14 w-full rounded-2xl border-0 border-b-2 bg-transparent px-1 text-xl shadow-none focus-visible:ring-0 md:text-2xl"
    />
  );
}
