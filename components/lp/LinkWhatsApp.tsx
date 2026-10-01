"use client";

import type { ReactNode } from "react";
import { EVENTO } from "@/lib/meta/eventos";
import { rastrear } from "@/lib/meta/pixel";
import { linkPrimeiroContato } from "@/lib/whatsapp";

/**
 * WhatsApp da Mel no rodapé da LP, com a mesma mensagem pronta da porta
 * "Falar com a Mel" em modo casamento, e o mesmo `Contact`.
 *
 * Sem número (`MEL_WHATSAPP` vazio) o link some, como a porta da esquerda
 * (regra 5b): um `wa.me` sem destinatário abre o seletor de conversas do
 * próprio lead, que não leva a lugar nenhum.
 */
export function LinkWhatsApp({ numero, className, children }: { numero: string; className?: string; children: ReactNode }) {
  if (!numero) return null;
  return (
    <a
      href={linkPrimeiroContato(numero, "casamento")}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => rastrear(EVENTO.contato, { content_category: "casamento" })}
      className={className}
    >
      {children}
    </a>
  );
}
