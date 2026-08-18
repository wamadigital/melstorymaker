"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { mascararTelefone } from "@/lib/form/validacao";
import { devoFocarSozinho, type CampoProps } from "../tipos";

export function CampoTelefone({ passo, valor, onChange, onAvancar, erro }: CampoProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (devoFocarSozinho()) ref.current?.focus();
  }, [passo.id]);

  return (
    <Input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      enterKeyHint="done"
      placeholder={passo.mascara?.replace(/0/g, "9") ?? "(99) 99999-9999"}
      value={valor}
      aria-invalid={!!erro}
      aria-label={passo.pergunta}
      // Mascara aplicada a cada tecla: o lead ve (19) 99999-8888 enquanto digita.
      onChange={(e) => onChange(mascararTelefone(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onAvancar();
        }
      }}
      className="h-14 rounded-none border-0 border-b-2 border-foreground/20 bg-transparent px-1 text-2xl shadow-none transition-colors placeholder:text-foreground/45 focus-visible:border-foreground focus-visible:ring-0 md:text-3xl"
    />
  );
}
