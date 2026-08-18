"use client";

import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** "A", "B", "C"... — o badge de tecla no canto esquerdo, estilo Typeform. */
  letra: string;
  rotulo: string;
  selecionada?: boolean;
};

/**
 * Botao de opcao no vocabulario visual do Typeform: caixa clara com borda,
 * badge de letra a esquerda e check implicito na versao selecionada. Usado
 * tanto na escolha de categoria quanto nas perguntas `escolha_unica` -- e o
 * que mantem as duas telas com a mesma cara.
 *
 * A letra e so visual (aria-hidden): leitor de tela ja anuncia o rotulo, e o
 * formulario nao tem atalho de teclado por letra -- o cenario real e toque.
 */
export function OpcaoEscolha({ letra, rotulo, selecionada = false, className, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-base transition-colors md:text-lg",
        "active:scale-[0.99] disabled:opacity-60",
        selecionada
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/25 bg-card hover:border-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold",
          selecionada
            ? "border-transparent bg-primary-foreground text-primary"
            : "border-foreground/30 bg-background",
        )}
      >
        {letra}
      </span>
      {rotulo}
    </button>
  );
}
