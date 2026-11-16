"use client";

import { Popover } from "@base-ui/react/popover";
import { Switch } from "@base-ui/react/switch";
import { Settings } from "lucide-react";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ENDPOINT = "/api/admin/lembretes-proposta/automacao";

export function ConfiguracaoLembretesProposta() {
  const [ativa, setAtiva] = useState<boolean | null>(null);
  const [operacao, setOperacao] = useState<"consulta" | "salvamento" | null>(null);
  const [erro, setErro] = useState(false);
  const emAndamento = useRef(false);

  async function atualizar(novaAtiva?: boolean) {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setErro(false);
    setOperacao(novaAtiva === undefined ? "consulta" : "salvamento");

    try {
      const resposta = await fetch(ENDPOINT, novaAtiva === undefined ? { cache: "no-store" } : {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativa: novaAtiva }),
      });
      if (!resposta.ok) throw new Error("Configuração indisponível");

      const config: { ativa?: unknown } | null = await resposta.json();
      if (typeof config?.ativa !== "boolean") throw new Error("Configuração inválida");
      setAtiva(config.ativa);
    } catch {
      setAtiva(null);
      setErro(true);
    } finally {
      emAndamento.current = false;
      setOperacao(null);
    }
  }

  return (
    <Popover.Root onOpenChange={(aberto) => { if (aberto) void atualizar(); }}>
      <Popover.Trigger
        type="button"
        aria-label="Configurar lembretes automáticos"
        className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }), "size-11 sm:size-9")}
      >
        <Settings aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-80 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none">
            <Popover.Title className="text-sm font-semibold">Lembretes automáticos</Popover.Title>
            <Popover.Description className="text-xs leading-relaxed text-muted-foreground">
              Em Esfriou, o sistema envia “Relembrar cliente” 15 minutos após o prazo de 7 dias
              e “Última tentativa” 15 minutos após a liberação. Conversas recentes bloqueiam o envio.
            </Popover.Description>
            {ativa !== null && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm" aria-hidden="true">{ativa ? "Ativados" : "Desativados"}</span>
                <Switch.Root
                  checked={ativa}
                  readOnly={operacao !== null}
                  aria-label="Ativar lembretes automáticos"
                  onCheckedChange={(marcado) => void atualizar(marcado)}
                  className="relative flex h-7 w-12 shrink-0 items-center rounded-full border border-muted-foreground bg-muted p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[checked]:border-primary data-[checked]:bg-primary"
                >
                  <Switch.Thumb className="size-5 rounded-full border bg-background shadow-sm transition-transform data-[checked]:translate-x-5" />
                </Switch.Root>
              </div>
            )}
            {operacao && (
              <p role="status" className="text-xs text-muted-foreground">
                {operacao === "salvamento" ? "Salvando configuração…" : "Consultando configuração…"}
              </p>
            )}
            {erro && (
              <div className="space-y-2">
                <p role="alert" className="text-xs text-destructive">Não consegui confirmar a configuração.</p>
                <button
                  type="button"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  onClick={() => void atualizar()}
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
