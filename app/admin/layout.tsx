import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Painel | Mel Simão Storymaker",
  // O painel nunca deve aparecer em busca.
  robots: { index: false, follow: false },
};

// O painel sempre reflete o estado atual do banco: nada aqui pode ser cacheado.
export const dynamic = "force-dynamic";

// Sem casca visual aqui de proposito: o /admin/login nao leva cabecalho nem
// botao de sair. A casca do painel vive no grupo (painel).
export default function LayoutAdmin({ children }: { children: React.ReactNode }) {
  return children;
}
