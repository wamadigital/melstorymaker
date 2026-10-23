"use client";

import { Popover } from "@base-ui/react/popover";
import { MessageCircleCheck } from "lucide-react";
import { resumoEnviosWhatsApp } from "@/lib/admin/disparos-whatsapp";
import type { LeadCartao } from "@/lib/admin/tipos";

/** Checklist da proposta registrada no CRM e dos disparos confirmados. */
export function IndicadorWhatsApp({
  lead,
  somenteLeitura = false,
}: {
  lead: LeadCartao;
  /** A cópia durante o arraste é só visual, sem outro botão ou popup. */
  somenteLeitura?: boolean;
}) {
  const resumo = resumoEnviosWhatsApp(lead);
  if (!resumo.some((envio) => envio.enviado)) return null;

  const icone = <MessageCircleCheck aria-hidden="true" className="size-3.5" />;

  if (somenteLeitura) {
    return (
      <span aria-label="Tem envios registrados" className="flex size-6 items-center justify-center text-green-700 dark:text-green-400">
        {icone}
      </span>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        openOnHover
        delay={200}
        closeDelay={100}
        aria-label="Ver checklist de envios"
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-green-700/5 text-green-700 transition-colors outline-none hover:bg-green-700/10 focus-visible:ring-2 focus-visible:ring-ring dark:text-green-400"
      >
        {icone}
      </Popover.Trigger>
      {/* O card e a coluna cortam overflow. O portal mantém o histórico inteiro
          visível também na primeira/última coluna e no celular. */}
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="max-h-(--available-height) w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none">
            <Popover.Title className="sr-only">
              Checklist de envios
            </Popover.Title>
            <ul className="space-y-2">
              {resumo.map((envio) => (
                <li key={envio.tipo} className={`flex items-center gap-2 text-xs ${envio.enviado
                  ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
                  <span className={envio.enviado ? "line-through" : undefined}>{envio.rotulo}</span>
                  <span className="sr-only">{envio.enviado ? "Enviado" : "Não enviado"}</span>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
