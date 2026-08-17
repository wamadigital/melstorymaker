"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { criarClienteNavegador } from "@/lib/supabase/client";

export function BotaoSair() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={ocupado}
      onClick={async () => {
        setOcupado(true);
        await criarClienteNavegador().auth.signOut();
        // refresh() derruba o cache de Server Component: sem isso a lista de
        // leads continua na tela mesmo sem sessao.
        router.replace("/admin/login");
        router.refresh();
      }}
    >
      <LogOut className="mr-1.5 size-4" />
      Sair
    </Button>
  );
}
