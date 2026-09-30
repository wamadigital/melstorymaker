import { metadataFormulario, PaginaFormulario } from "./PaginaFormulario";

export const metadata = metadataFormulario;

// O formulario e publico e nao tem nada para cachear entre leads.
export const dynamic = "force-dynamic";

export default function Page() {
  return <PaginaFormulario inicio="boas_vindas" />;
}
