import type { Metadata } from "next";
import { PixelMeta } from "@/components/meta/PixelMeta";
import { FormularioClient, type TelaInicial } from "./FormularioClient";

/**
 * Compartilhado por `/formulario` e `/orcamento`: as duas URLs sao o mesmo
 * formulario e mudam so a tela em que ele abre.
 */
export const metadataFormulario: Metadata = {
  title: "Vamos eternizar seu momento ✨ | Mel Simão Storymaker",
  // Este e o texto da PREVIA do link no WhatsApp, que e como a Mel manda o
  // formulario. Mantido em sintonia com a copy de boas-vindas do
  // arvore.json -- ficou desencontrado quando a copy mudou.
  description:
    "Algumas perguntinhas rápidas para eu entender seu evento e preparar a proposta ideal.",
};

export function PaginaFormulario({ inicio }: { inicio: TelaInicial }) {
  // MEL_WHATSAPP e server-side (nao e NEXT_PUBLIC): chega ao client como prop,
  // so nesta pagina, em vez de virar variavel publica de build.
  const whatsappMel = process.env.MEL_WHATSAPP ?? "";

  return (
    <>
      {/* Mesmo motivo do MEL_WHATSAPP: lido em runtime, sem virar NEXT_PUBLIC. */}
      <PixelMeta pixelId={process.env.META_PIXEL_ID} />
      <FormularioClient whatsappMel={whatsappMel} inicio={inicio} />
    </>
  );
}
