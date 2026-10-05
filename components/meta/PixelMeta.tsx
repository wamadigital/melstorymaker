import Script from "next/script";
import { preconnect } from "react-dom";
import { snippetPixel, type EventoInicial } from "@/lib/meta/snippet";
import { CopiaIniciais } from "./CopiaIniciais";

/** Id do Pixel e so digitos. Validar aqui impede que um valor torto na Vercel vire script quebrado -- ou injetado. */
const RE_PIXEL = /^\d{8,20}$/;

/**
 * Codigo base do Meta Pixel (PageView + o `fbq` que `rastrear()` usa).
 *
 * Entra SO nas telas do lead (o formulario e a LP `/casamento`), nunca no
 * layout raiz: o layout raiz cobre o
 * /admin, e cada visita da Mel ao painel viraria PageView -- enchendo o publico
 * de remarketing com a propria dona do negocio.
 *
 * `afterInteractive`: o script sai depois da hidratacao, quando o titulo da
 * abertura ja esta pintado. O LCP do formulario (< 2,5s em 4G) nao espera a
 * Meta. No formulario nada se perde com isso: antes da hidratacao nenhum
 * clique funciona, e o `fbq` so e chamado a partir de clique. Na LP os CTAs
 * sao `<a>` de verdade e funcionam antes da hidratacao -- por isso o fbclid
 * vai na URL do formulario (script inline em `app/casamento/page.tsx`), e nao
 * depende do cookie `_fbc` que este script grava.
 *
 * Sem o `<noscript>` do snippet original: o formulario nao funciona sem
 * JavaScript, entao o unico visitante sem JS que a imagem contaria e robo.
 *
 * O id vem do servidor como prop (`META_PIXEL_ID`), e nao de uma NEXT_PUBLIC:
 * o valor nunca entra no bundle do client, e sem a variavel -- dev, preview --
 * o componente nao renderiza nada e nenhum evento sai. No formulario a pagina
 * e dinamica e le a variavel a cada request; na `/casamento`, que e estatica,
 * ela e lida no build (na Vercel, trocar env ja exige redeploy de todo jeito).
 *
 * `eventosIniciais`: o que a pagina dispara ao carregar alem do PageView (a LP
 * manda `ViewContent`). Vai no mesmo snippet, ver `snippetPixel`. O PageView e
 * esses eventos ganham copia pelo servidor (`CopiaIniciais`), com o mesmo id.
 */
export function PixelMeta({
  pixelId,
  eventosIniciais,
}: {
  pixelId: string | undefined;
  eventosIniciais?: readonly EventoInicial[];
}) {
  const id = pixelId?.trim();
  if (!id || !RE_PIXEL.test(id)) return null;
  // A conexao com a Meta abre cedo, no <head>, enquanto o script em si so
  // entra depois da hidratacao: o fbevents.js chega sem esperar DNS e TLS.
  preconnect("https://connect.facebook.net");

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {snippetPixel(id, eventosIniciais)}
      </Script>
      <CopiaIniciais />
    </>
  );
}
