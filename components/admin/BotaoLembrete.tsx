"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ROTULO_LEMBRETE, TEMA_LEMBRETE, type Marco } from "@/lib/admin/lembretes";
import { linkLembreteWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  nome: string;
  marco: Marco;
  whatsapp: string | null;
  pdfUrl: string | null;
};

/**
 * Botao de cobranca no cartao do quadro. Abre a conversa do lead com a mensagem
 * pronta E carimba que a Mel cobrou -- os dois no mesmo clique, porque separar
 * daria um segundo passo que ninguem faz e o cartao ficaria vermelho para sempre.
 *
 * O `window.open` vem ANTES do fetch, e sincrono dentro do handler: navegador
 * bloqueia popup aberta depois de um await, e o clique perderia a janela.
 */
export function BotaoLembrete({ id, nome, marco, whatsapp, pdfUrl }: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const tema = TEMA_LEMBRETE[marco];

  async function marcar(marcado: boolean) {
    const r = await fetch(`/api/admin/leads/${id}/lembrete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marco, marcado }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.erro ?? "Não consegui marcar.");
    router.refresh();
  }

  async function cobrar() {
    window.open(linkLembreteWhatsApp(marco, whatsapp, pdfUrl), "_blank", "noopener");
    setOcupado(true);
    try {
      await marcar(true);
      toast.success(`Lembrete de ${marco} dias marcado para ${nome || "o lead"}.`, {
        // A marca acontece no clique, antes de a mensagem sair de fato. Se a Mel
        // abrir a conversa e desistir, este e o caminho de volta.
        action: {
          label: "Desfazer",
          onClick: () => {
            void marcar(false).catch((e: Error) => toast.error(e.message));
          },
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={cobrar}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5",
        "text-xs font-semibold transition-colors disabled:opacity-60",
        "border-current/25 bg-white/60 hover:bg-white",
        tema.texto,
      )}
    >
      {ocupado ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <MessageCircle className="size-3.5" />
      )}
      {ROTULO_LEMBRETE[marco]}
    </button>
  );
}
