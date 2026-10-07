import Link from "next/link";
import { BotaoSair } from "@/components/admin/BotaoSair";
import { LogoMel } from "@/components/marca/LogoMel";
import { Toaster } from "@/components/ui/sonner";

/** Casca das telas autenticadas. Fora do grupo fica o /admin/login, sem casca. */
export default function LayoutPainel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        {/* max-w-screen-2xl (1536px) desde que o quadro tem SEIS colunas
            (07/10/2026): em 1280px cada uma ficaria com ~197px e os botoes dos
            cartoes nao caberiam. O header acompanha para alinhar com o
            conteudo; quem precisa de linha de leitura estreita (o detalhe do
            lead) limita por dentro. */}
        <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center justify-between px-5">
          {/* A assinatura da marca no lugar da palavra "Propostas". h-7 = 28px;
              a largura sai do viewBox, mantendo a proporcao 274x38. */}
          <Link href="/admin" aria-label="Ir para os leads">
            <LogoMel className="h-7 w-auto text-foreground" />
          </Link>
          <BotaoSair />
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl px-5 py-8">{children}</main>
      {/* Sem isto montado, toast() e um no-op silencioso: a Mel clicaria em
          "excluir" e nao veria confirmacao nenhuma. */}
      <Toaster position="top-center" />
    </div>
  );
}
