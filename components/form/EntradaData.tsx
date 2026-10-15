"use client";

import { useRef, type Ref, type KeyboardEventHandler } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { dataComPontos, dataDaEntrada, dataISOValida } from "@/lib/form/data";

/** Mesmo formato ao digitar e ao escolher no calendário nativo do aparelho. */
export function EntradaData({
  id, valor, onChange, rotulo, min, className, inputRef, onKeyDown, invalida,
}: {
  id?: string;
  valor: string;
  onChange: (valor: string) => void;
  rotulo: string;
  min?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  invalida?: boolean;
}) {
  const calendario = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <Input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd.mm.aaaa"
        maxLength={10}
        value={dataComPontos(valor)}
        aria-label={rotulo}
        aria-invalid={invalida}
        onChange={(e) => onChange(dataDaEntrada(e.target.value))}
        onKeyDown={onKeyDown}
        className={`${className ?? ""} pr-11`}
      />
      <input
        ref={calendario}
        type="date"
        min={min}
        value={dataISOValida(valor) ? valor : ""}
        aria-label={`Calendário: ${rotulo}`}
        tabIndex={-1}
        className="sr-only"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label={`Abrir calendário: ${rotulo}`}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => {
          const input = calendario.current;
          if (!input) return;
          try { input.showPicker(); } catch { input.focus(); input.click(); }
        }}
      >
        <CalendarDays className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
