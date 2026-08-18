import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * DM Sans, a fonte da marca -- a mesma que a arte do PDF usa. Servida do nosso
 * proprio dominio, nao do Google Fonts: o cenario de uso e o navegador in-app
 * do WhatsApp em 4G, e uma ida a um terceiro atrasaria o primeiro texto.
 *
 * `display: swap` mostra o texto na fonte do sistema enquanto a nossa carrega,
 * em vez de deixar a tela em branco -- o LCP do formulario e requisito de
 * produto (< 2,5s em 4G).
 */
const dmSans = localFont({
  src: [
    { path: "../assets/fonts/DMSans-Light.ttf", weight: "300", style: "normal" },
    { path: "../assets/fonts/DMSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "../assets/fonts/DMSans-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
  // Sem isso, o fallback tem metricas diferentes e a tela "pula" quando a DM
  // Sans entra. O ajuste alinha o desenho das duas.
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Mel Simão | Storymaker",
  description: "Propostas personalizadas para eternizar o seu momento.",
};

// O cenario principal de uso e o navegador in-app do WhatsApp, que respeita
// mal o viewport padrao. viewportFit=cover evita a barra do iOS comendo o CTA.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={dmSans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
