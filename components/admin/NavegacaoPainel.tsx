"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [{ href: "/admin", rotulo: "Leads" }, { href: "/campanhas", rotulo: "Campanhas" }];

export function NavegacaoPainel() {
  const caminho = usePathname();
  return (
    <nav aria-label="Painel" className="flex gap-0.5">
      {links.map(({ href, rotulo }) => {
        const ativo = caminho === href || caminho.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={ativo ? "page" : undefined}
            className={cn("rounded-md px-2 py-2 text-sm font-medium hover:bg-muted", ativo ? "bg-muted" : "text-muted-foreground")}>
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
