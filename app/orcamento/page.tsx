import { metadataFormulario, PaginaFormulario } from "../formulario/PaginaFormulario";

export const metadata = metadataFormulario;

// Mesmo motivo do /formulario: publico, nada para cachear entre leads.
export const dynamic = "force-dynamic";

/**
 * Link que a Mel manda para quem JA conversou com ela e so precisa preencher:
 * abre direto na escolha do evento, sem a tela das duas portas. A porta "Falar
 * com a Mel" ali seria voltar para a conversa de onde a pessoa acabou de vir.
 *
 * Pagina propria, e nao redirect para `/formulario?...`: o redirect custaria
 * uma ida e volta a mais no 4G antes da primeira pintura.
 *
 * Ignora `?evento=` de proposito: quem recebe este link ja conversa com a Mel,
 * e ele abre na escolha do evento, sem as portas que o `?evento` adapta.
 */
export default function Page() {
  return <PaginaFormulario inicio="categoria" />;
}
