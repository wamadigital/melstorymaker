import type { Metadata } from "next";
import { FormularioClient } from "./FormularioClient";

export const metadata: Metadata = {
  title: "Vamos eternizar seu momento ✨ | Mel Simão Storymaker",
  description: "Algumas perguntinhas rápidas pra montar a proposta perfeita pro seu evento.",
};

// O formulario e publico e nao tem nada para cachear entre leads.
export const dynamic = "force-dynamic";

export default function PaginaFormulario() {
  // MEL_WHATSAPP e server-side (nao e NEXT_PUBLIC): chega ao client como prop,
  // so nesta pagina, em vez de virar variavel publica de build.
  const whatsappMel = process.env.MEL_WHATSAPP ?? "";

  return <FormularioClient whatsappMel={whatsappMel} />;
}
