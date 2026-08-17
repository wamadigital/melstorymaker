import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Os PDFs base e as fontes da marca sao lidos do disco em runtime (fs), sem
  // import estatico. O file tracing da Vercel so inclui o que enxerga nos
  // imports, entao sem esta lista as rotas de PDF funcionam local e quebram em
  // producao com ENOENT. Em Next 15 esta chave e top-level (saiu de experimental).
  outputFileTracingIncludes: {
    "/api/admin/leads/[id]/gerar-pdf": ["./assets/**/*"],
    "/admin/debug-template": ["./assets/**/*"],
  },
};

export default nextConfig;
