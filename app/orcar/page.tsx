import { metadataFormulario, PaginaFormulario } from "../formulario/PaginaFormulario";

export const metadata = metadataFormulario;
export const dynamic = "force-dynamic";

/** Contato já aberto no WhatsApp: a Mel envia a primeira proposta manualmente. */
export default function Page() {
  return <PaginaFormulario inicio="categoria" origemFormulario="orcar" />;
}
