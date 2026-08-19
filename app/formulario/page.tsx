import type { Metadata } from "next";
import { FormularioClient } from "./FormularioClient";

export const metadata: Metadata = {
  title: "Vamos eternizar seu momento ✨ | Mel Simão Storymaker",
  // Este e o texto da PREVIA do link no WhatsApp, que e como a Mel manda o
  // formulario. Mantido em sintonia com a copy de boas-vindas do
  // arvore.json -- ficou desencontrado quando a copy mudou.
  description:
    "Algumas perguntinhas rápidas para eu entender seu evento e preparar a proposta ideal.",
};

// O formulario e publico e nao tem nada para cachear entre leads.
export const dynamic = "force-dynamic";

export default function PaginaFormulario() {
  // MEL_WHATSAPP e server-side (nao e NEXT_PUBLIC): chega ao client como prop,
  // so nesta pagina, em vez de virar variavel publica de build.
  const whatsappMel = process.env.MEL_WHATSAPP ?? "";

  return <FormularioClient whatsappMel={whatsappMel} />;
}
