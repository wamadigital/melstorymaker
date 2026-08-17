import Link from "next/link";
import { BotaoSair } from "@/components/admin/BotaoSair";

/** Casca das telas autenticadas. Fora do grupo fica o /admin/login, sem casca. */
export default function LayoutPainel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
          <Link href="/admin" className="font-semibold">
            Propostas
          </Link>
          <BotaoSair />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
