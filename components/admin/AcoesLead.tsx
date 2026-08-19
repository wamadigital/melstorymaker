"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Mail, MessageCircle, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { linkPropostaWhatsApp } from "@/lib/whatsapp";

type Props = {
  id: string;
  nome: string;
  pdfUrl: string | null;
  whatsapp: string | null;
  temEmail: boolean;
};

/**
 * Menu de acoes na linha do lead.
 *
 * Enviar e-mail e excluir batem na API daqui mesmo, sem abrir o detalhe: sao as
 * duas coisas que a Mel faz em sequencia sobre varios leads. Editar navega,
 * porque editar exige a tela inteira.
 *
 * A exclusao pede confirmacao e e irreversivel -- nao ha lixeira nem backup no
 * plano gratuito, entao a confirmacao e a unica rede.
 */
export function AcoesLead({ id, nome, pdfUrl, whatsapp, temEmail }: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<null | "email" | "excluir">(null);

  async function enviarEmail() {
    setOcupado("email");
    try {
      const r = await fetch(`/api/admin/leads/${id}/enviar`, { method: "POST" });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.erro ?? "Não consegui enviar.");
      toast.success(`Proposta enviada para ${nome || "o lead"}.`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function excluir() {
    // window.confirm de proposito: exclusao e irreversivel e o dialogo nativo
    // nao tem como ser clicado por engano num toque perdido na lista.
    const certeza = window.confirm(
      `Excluir o lead ${nome || "sem nome"}?\n\nIsso apaga também a proposta em PDF. Não dá para desfazer.`,
    );
    if (!certeza) return;

    setOcupado("excluir");
    try {
      const r = await fetch(`/api/admin/leads/${id}`, { method: "DELETE" });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.erro ?? "Não consegui excluir.");
      toast.success(`Lead ${nome || ""} excluído.`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Ações do lead ${nome || "sem nome"}`}
        // stopPropagation: a linha inteira e um link para o detalhe, e abrir o
        // menu nao pode navegar junto.
        onClick={(e) => e.stopPropagation()}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
      >
        {ocupado ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MoreVertical className="size-4" />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuItem
          disabled={!pdfUrl || !temEmail || ocupado !== null}
          onClick={enviarEmail}
        >
          <Mail />
          Enviar e-mail
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!pdfUrl}
          onClick={() => {
            if (!pdfUrl) return;
            window.open(linkPropostaWhatsApp(whatsapp, pdfUrl), "_blank", "noopener");
          }}
        >
          <MessageCircle />
          Enviar WhatsApp
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => router.push(`/admin/leads/${id}`)}>
          <Pencil />
          Editar
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem destrutivo disabled={ocupado !== null} onClick={excluir}>
          <Trash2 />
          Excluir lead
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
