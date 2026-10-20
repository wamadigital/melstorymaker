import Link from "next/link";
import { BotaoSair } from "@/components/admin/BotaoSair";
import { LogoMel } from "@/components/marca/LogoMel";
import { Toaster } from "@/components/ui/sonner";

/** Casca das telas autenticadas. Fora do grupo fica o /admin/login, sem casca. */
export default function LayoutPainel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        {/* O quadro usa toda a largura da tela. O detalhe do lead mantém
            sua própria largura de leitura dentro do conteúdo. */}
        <div className="flex h-14 w-full items-center justify-between px-5">
          {/* A assinatura da marca no lugar da palavra "Propostas". h-7 = 28px;
              a largura sai do viewBox, mantendo a proporcao 274x38. */}
          <Link href="/admin" aria-label="Ir para os leads">
            <LogoMel className="h-7 w-auto text-foreground" />
          </Link>
          <BotaoSair />
        </div>
      </header>
      <main className="w-full px-5 py-8">{children}</main>
      {/* Sem isto montado, toast() e um no-op silencioso: a Mel clicaria em
          "excluir" e nao veria confirmacao nenhuma. */}
      <Toaster position="top-center" />
    </div>
  );
}
