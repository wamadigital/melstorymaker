"use client";

import { useEffect } from "react";
import { copiarParaServidor } from "@/lib/meta/pixel";

/**
 * Manda pelo servidor a cópia dos eventos que o snippet do Pixel disparou ao
 * carregar (o `PageView` e, na LP, o `ViewContent`), com o mesmo `eventID`.
 *
 * O snippet roda depois da hidratação (`afterInteractive`), então este effect
 * pode chegar antes dele: por isso lê `window.__metaIniciais` agora E quando o
 * snippet avisar (`meta:iniciais`). Esvaziar a lista ao ler é o que impede a
 * cópia dupla (o effect roda duas vezes no modo estrito do React).
 */
export function CopiaIniciais() {
  useEffect(() => {
    const copiar = () => {
      const pendentes = window.__metaIniciais;
      if (!pendentes?.length) return;
      window.__metaIniciais = [];
      for (const e of pendentes) copiarParaServidor(e);
    };
    copiar();
    window.addEventListener("meta:iniciais", copiar);
    return () => window.removeEventListener("meta:iniciais", copiar);
  }, []);
  return null;
}
