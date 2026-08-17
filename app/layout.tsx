import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
