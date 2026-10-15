"use client";

import { Popover } from "@base-ui/react/popover";
import { MessageCircleCheck } from "lucide-react";
import { historicoWhatsApp } from "@/lib/admin/disparos-whatsapp";
import type { LeadCartao } from "@/lib/admin/tipos";
import { dataHoraLocal } from "@/lib/pdf/formatadores";

/** Só o histórico de envio/contato acende este sinal; ter telefone não basta. */
export function IndicadorWhatsApp({
  lead,
  somenteLeitura = false,
}: {
  lead: LeadCartao;
  /** A cópia durante o arraste é só visual, sem outro botão ou popup. */
  somenteLeitura?: boolean;
}) {
  const historico = historicoWhatsApp(lead);
  if (!historico.length) return null;

  const icone = <MessageCircleCheck aria-hidden="true" className="size-3.5" />;

  if (somenteLeitura) {
    return (
      <span aria-label="Tem histórico de mensagens no WhatsApp" className="flex size-6 items-center justify-center text-foreground/80">
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
        aria-label="Ver histórico de mensagens no WhatsApp"
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground/80 transition-colors outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {icone}
      </Popover.Trigger>
      {/* O card e a coluna cortam overflow. O portal mantém o histórico inteiro
          visível também na primeira/última coluna e no celular. */}
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="max-h-(--available-height) w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none">
            <Popover.Title className="mb-2 text-xs font-semibold">
              Mensagens no WhatsApp
            </Popover.Title>
            <ul className="space-y-2.5">
              {historico.map((envio) => (
                <li key={envio.tipo} className="space-y-0.5 text-xs">
                  <p className="font-medium">{envio.rotulo}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {envio.origem === "automatico" ? "Envio automático" : envio.origem === "sistema" ? "Enviado pelo sistema" : "Marcado pela Mel"}
                    {" · "}
                    <time dateTime={envio.enviadoEm}>{dataHoraLocal(envio.enviadoEm)}</time>
                  </p>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
