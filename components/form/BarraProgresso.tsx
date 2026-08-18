"use client";

import { m } from "framer-motion";

/**
 * O total muda com a ramificacao (responder making_of = "Nao" tira um passo),
 * entao o denominador vem sempre recalculado do engine, nunca fixo.
 */
export function BarraProgresso({ atual, total }: { atual: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;

  return (
    <div
      // bg-foreground/15, nao bg-muted: na paleta preto + #F1F1F1 o muted e
      // IGUAL ao fundo, e a trilha sumiria -- so o trecho preenchido apareceria.
      className="h-1 w-full overflow-hidden rounded-md bg-foreground/15"
      role="progressbar"
      aria-valuenow={atual}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={`Pergunta ${atual} de ${total}`}
    >
      <m.div
        className="h-full bg-primary"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      />
    </div>
  );
}
