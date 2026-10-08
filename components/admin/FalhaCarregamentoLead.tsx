"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Mantém a falha de consulta distinta do 404 e oferece retentativa da leitura. */
export function FalhaCarregamentoLead() {
  const router = useRouter();
  const [atualizando, iniciar] = useTransition();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-2">
        Voltar para a lista
      </Link>
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <p role="alert" className="text-sm text-destructive">
          Não consegui carregar este lead agora. Tente de novo em instantes.
        </p>
        <Button size="sm" variant="outline" disabled={atualizando} onClick={() => iniciar(() => router.refresh())}>
          {atualizando ? "Carregando…" : "Tentar de novo"}
        </Button>
      </div>
    </div>
  );
}
