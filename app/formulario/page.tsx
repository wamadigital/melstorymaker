import { isCategoria } from "@/lib/form/types";
import { metadataFormulario, PaginaFormulario } from "./PaginaFormulario";

export const metadata = metadataFormulario;

// O formulario e publico e nao tem nada para cachear entre leads.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * `?evento=<categoria>` e o "modo" da abertura: a LP `/casamento` manda para
 * `/formulario?evento=casamento`, e quem chega por ali ja disse qual e o
 * evento. As duas portas continuam, mas falando desse evento, e "Quero um
 * orcamento" pula a escolha da categoria.
 *
 * Lido AQUI, no servidor, e descido por prop -- nunca da URL no navegador
 * (regra 5e): o subtitulo da abertura muda com ele, e precisa estar no HTML
 * inicial e bater com o hidratado. Valor que nao e categoria e ignorado, e a
 * pagina abre como sempre.
 */
export default async function Page({ searchParams }: Props) {
  const { evento } = await searchParams;
  const categoria = typeof evento === "string" && isCategoria(evento) ? evento : undefined;
  return <PaginaFormulario inicio="boas_vindas" categoria={categoria} />;
}
