"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Mail, MessageCircle, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROTULO_STATUS, TEMA_COLUNA } from "@/lib/admin/rotulos";
import { recusarMovimento } from "@/lib/admin/status";
import { STATUS, type Status } from "@/lib/form/types";
import { linkPropostaWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  nome: string;
  pdfUrl: string | null;
  whatsapp: string | null;
  temEmail: boolean;
  /** Coluna atual. Com ela (e `onMover`) o menu ganha o grupo "Mover para". */
  status?: Status;
  /** O quadro ja tem um request deste lead em voo. */
  ocupadoExterno?: boolean;
  onMover?: (para: Status) => void;
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
export function AcoesLead({
  id,
  nome,
  pdfUrl,
  whatsapp,
  temEmail,
  status,
  ocupadoExterno = false,
  onMover,
}: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<null | "email" | "excluir">(null);
  const travado = ocupado !== null || ocupadoExterno;

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
        {travado ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MoreVertical className="size-4" />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuItem disabled={!pdfUrl || !temEmail || travado} onClick={enviarEmail}>
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

        {/* Caminho sem gesto para mover o cartao. E o principal no celular (onde
            arrastar entre secoes distantes do accordion seria sofrido), o
            caminho de teclado, e a rede para os Androids que leem o long-press
            como scroll. */}
        {status && onMover && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>Mover para</DropdownMenuGroupLabel>
              {STATUS.map((destino) => {
                const recusa = recusarMovimento(status, destino, { temProposta: !!pdfUrl });
                return (
                  <DropdownMenuItem
                    key={destino}
                    // `mesmo_status` nao desabilita: o item marcado com o check
                    // e o que mostra onde o lead esta, e clicar nele e no-op.
                    disabled={(!!recusa && recusa !== "mesmo_status") || travado}
                    onClick={() => onMover(destino)}
                  >
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-sm", TEMA_COLUNA[destino].ponto)}
                    />
                    {ROTULO_STATUS[destino]}
                    {destino === status && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem destrutivo disabled={travado} onClick={excluir}>
          <Trash2 />
          Excluir lead
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
