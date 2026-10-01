import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Os PDFs base e as fontes da marca sao lidos do disco em runtime (fs), sem
  // import estatico. O file tracing da Vercel so inclui o que enxerga nos
  // imports, entao sem esta lista as rotas de PDF funcionam local e quebram em
  // producao com ENOENT. Em Next 15 esta chave e top-level (saiu de experimental).
  outputFileTracingIncludes: {
    "/api/admin/leads/[id]/gerar-pdf": ["./assets/**/*"],
    "/admin/debug-template": ["./assets/**/*"],
    // O contrato nao tem arte de fundo: so as fontes. Sem elas o PDF sai em
    // Helvetica (fallback) e o painel avisa -- funciona, mas nao e a marca.
    "/api/admin/leads/[id]/contrato/pdf": ["./assets/fonts/**/*"],
  },
  // A midia da LP (`npm run lp:reels`) tem o hash do conteudo no nome: arquivo
  // novo = nome novo, entao pode ficar em cache para sempre. O prefixo e
  // `/midia/` e NAO `/casamento/` de proposito: `/casamento/:path*` casaria com
  // a propria pagina, e o navegador do Instagram guardaria o HTML por um ano --
  // depois de um deploy ele apontaria para chunks que nao existem mais.
  async headers() {
    return [
      {
        source: "/midia/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
