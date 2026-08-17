"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { devoFocarSozinho, type CampoProps } from "../tipos";

export function CampoNumero({ passo, valor, onChange, onAvancar, erro }: CampoProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (devoFocarSozinho()) ref.current?.focus();
  }, [passo.id]);

  return (
    <Input
      ref={ref}
      // type="text" com inputMode numeric, e nao type="number": o input
      // numerico do mobile traz setinhas de incremento, aceita "e"/"+"/"-" e
      // rola o valor no scroll. Aqui o lead digita dois digitos e avanca.
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      enterKeyHint="next"
      placeholder={passo.placeholder}
      value={valor}
      aria-invalid={!!erro}
      aria-label={passo.pergunta}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onAvancar();
        }
      }}
      className="h-14 rounded-2xl border-0 border-b-2 bg-transparent px-1 text-xl shadow-none focus-visible:ring-0 md:text-2xl"
    />
  );
}
