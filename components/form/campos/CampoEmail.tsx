"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { devoFocarSozinho, type CampoProps } from "../tipos";

export function CampoEmail({ passo, valor, onChange, onAvancar, erro }: CampoProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (devoFocarSozinho()) ref.current?.focus();
  }, [passo.id]);

  return (
    <Input
      ref={ref}
      // type="email" no mobile traz o teclado com @ e .com
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="next"
      placeholder="voce@email.com"
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
      className="h-14 rounded-none border-0 border-b-2 border-foreground/20 bg-transparent px-1 text-2xl shadow-none transition-colors placeholder:text-foreground/45 focus-visible:border-foreground focus-visible:ring-0 md:text-3xl"
    />
  );
}
