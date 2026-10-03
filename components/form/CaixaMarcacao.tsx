"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Caixa de marcar com o raio e a tinta do app. O `<input>` nativo continua la,
 * so com `appearance-none`: teclado (espaco marca), leitor de tela e o toque no
 * rotulo funcionam sem JS a mais. O desenho e nosso porque a caixa nativa do
 * iOS e do Android nao segue o raio de 6px nem a paleta.
 *
 * `onEnter`: Enter numa caixa de marcar nao faz nada no navegador. No
 * formulario ele avanca, como nos campos de texto -- quem marcou pelo teclado
 * nao precisa ir ate o botao.
 */
export function CaixaMarcacao({
  id,
  rotulo,
  marcado,
  onAlternar,
  onEnter,
  className,
}: {
  id: string;
  rotulo: string;
  marcado: boolean;
  onAlternar: (marcado: boolean) => void;
  onEnter?: () => void;
  className?: string;
}) {
  return (
    // `htmlFor` e nao o input aninhado sozinho: a regra global de cursor de mao
    // pega `label[for]`, e o rotulo inteiro e alvo de toque.
    <label
      htmlFor={id}
      className={cn("flex w-fit items-center gap-3 select-none has-checked:text-foreground", className)}
    >
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={marcado}
          onChange={(e) => onAlternar(e.target.checked)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          className="peer size-5 appearance-none rounded-md border-2 border-foreground/40 bg-card transition-colors outline-none hover:border-foreground checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Check
          aria-hidden="true"
          strokeWidth={3.5}
          className="pointer-events-none absolute inset-0 m-auto size-3.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
        />
      </span>
      {rotulo}
    </label>
  );
}
