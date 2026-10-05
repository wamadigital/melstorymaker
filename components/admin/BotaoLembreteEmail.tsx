"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, MailOpen } from "lucide-react";
import { toast } from "sonner";
import {
  legendaLembreteEmail,
  ROTULO_LEMBRETE_EMAIL,
  type EstadoLembreteEmail,
} from "@/lib/admin/lembrete-email";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  /** Para onde vai. Aparece no toast: e ali que a Mel confere o endereco. */
  email: string;
  estado: Extract<EstadoLembreteEmail, { visivel: true }>;
};

/**
 * "Lembrar por e-mail", no cartao de "Novo" que tem e-mail.
 *
 * O clique ENVIA, sem confirmacao -- foi o pedido do owner --, e o botao trava
 * por 7 dias. A trava de verdade e do servidor; aqui ela so evita o clique que
 * ele recusaria. Entre a resposta e o `router.refresh()` trazer o carimbo do
 * banco, quem segura o botao e a transicao: sem ela, um segundo clique nessa
 * janela voltaria com 409 logo depois do toast de sucesso.
 */
export function BotaoLembreteEmail({ id, email, estado }: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [atualizando, iniciar] = useTransition();

  const travado = !estado.liberado;
  const ocupado = enviando || atualizando;
  const legenda = legendaLembreteEmail(estado);
  const idLegenda = `lembrete-email-${id}`;

  async function enviar() {
    setEnviando(true);
    try {
      const r = await fetch(`/api/admin/leads/${id}/lembrete-email`, { method: "POST" });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 409 = o lead mudou: outra aba ja mandou, ou ele saiu de "Novo". A
        // tela se acerta com o banco junto com o aviso.
        if (r.status === 409) iniciar(() => router.refresh());
        throw new Error(json.erro ?? "Não consegui enviar o lembrete.");
      }

      if (json.dryRun) {
        toast.warning("MAIL_DRY_RUN está ligado: o lembrete foi só registrado no log, não enviado.");
      } else {
        toast.success(`Lembrete enviado para ${email}.`);
      }
      iniciar(() => router.refresh());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={travado || ocupado}
        onClick={enviar}
        aria-describedby={legenda ? idLegenda : undefined}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5",
          "text-xs font-semibold transition-colors",
          "border-border bg-background hover:bg-muted",
          "disabled:opacity-60 disabled:hover:bg-background",
        )}
      >
        {ocupado ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : travado ? (
          <MailCheck className="size-3.5" />
        ) : (
          <MailOpen className="size-3.5" />
        )}
        {travado ? ROTULO_LEMBRETE_EMAIL.enviado : ROTULO_LEMBRETE_EMAIL.enviar}
      </button>

      {legenda && (
        <p id={idLegenda} className="text-center text-[0.6875rem] text-muted-foreground">
          {legenda}
        </p>
      )}
    </div>
  );
}
