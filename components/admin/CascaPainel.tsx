import Link from "next/link";
import { BotaoAtualizar } from "@/components/admin/BotaoAtualizar";
import { BotaoSair } from "@/components/admin/BotaoSair";
import { NavegacaoPainel } from "@/components/admin/NavegacaoPainel";
import { LogoMel } from "@/components/marca/LogoMel";
import { Toaster } from "@/components/ui/sonner";

/** Casca compartilhada pelas telas autenticadas. */
export function CascaPainel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="flex min-h-14 flex-wrap items-center gap-x-3 px-5 sm:h-14 sm:flex-nowrap">
          <Link href="/admin" aria-label="Ir para os leads" className="my-2 shrink-0">
            <LogoMel className="h-auto w-36 text-foreground sm:h-7 sm:w-auto" />
          </Link>
          <div className="order-last basis-full pb-2 sm:order-none sm:basis-auto sm:pb-0">
            <NavegacaoPainel />
          </div>
          <div className="ml-auto flex min-h-14 items-center gap-2">
            <BotaoAtualizar />
            <BotaoSair />
          </div>
        </div>
      </header>
      <main className="w-full px-5 py-8">{children}</main>
      <Toaster position="top-center" />
    </div>
  );
}
