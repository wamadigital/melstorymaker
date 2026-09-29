import Script from "next/script";

/** Id do Pixel e so digitos. Validar aqui impede que um valor torto na Vercel vire script quebrado -- ou injetado. */
const RE_PIXEL = /^\d{8,20}$/;

/**
 * Codigo base do Meta Pixel (PageView + o `fbq` que `rastrear()` usa).
 *
 * Entra SO nas telas do lead, nunca no layout raiz: o layout raiz cobre o
 * /admin, e cada visita da Mel ao painel viraria PageView -- enchendo o publico
 * de remarketing com a propria dona do negocio.
 *
 * `afterInteractive`: o script sai depois da hidratacao, quando o titulo da
 * abertura ja esta pintado. O LCP do formulario (< 2,5s em 4G) nao espera a
 * Meta. Nada se perde com isso: antes da hidratacao nenhum clique funciona, e o
 * `fbq` so e chamado a partir de clique.
 *
 * Sem o `<noscript>` do snippet original: o formulario nao funciona sem
 * JavaScript, entao o unico visitante sem JS que a imagem contaria e robo.
 *
 * O id vem do servidor como prop (`META_PIXEL_ID`, lido em runtime), e nao de
 * uma NEXT_PUBLIC: trocar o Pixel nao exige rebuild, e sem a variavel -- dev,
 * preview -- o componente nao renderiza nada e nenhum evento sai.
 */
export function PixelMeta({ pixelId }: { pixelId: string | undefined }) {
  const id = pixelId?.trim();
  if (!id || !RE_PIXEL.test(id)) return null;

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`}
    </Script>
  );
}
