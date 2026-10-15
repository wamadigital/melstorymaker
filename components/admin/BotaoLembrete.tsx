"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ROTULO_LEMBRETE, type Marco } from "@/lib/admin/lembretes";
import type { SolicitacaoWhatsApp } from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  nome: string;
  marco: Marco;
  /** Tinta do texto, a mesma do cartao (`temaCobranca`): azul em Enviado, cinza em Esfriou. */
  classeTexto?: string;
  solicitacao?: SolicitacaoWhatsApp;
  /** Somente ACK confirmado da proposta vigente; nunca uma marcação manual. */
  confirmado?: boolean;
};

/**
 * O clique solicita o envio ao worker local. Enfileirar não confirma envio:
 * somente o ACK do WhatsApp atualiza os carimbos e o histórico do cartão.
 */
export function BotaoLembrete({ id, nome, marco, classeTexto, solicitacao, confirmado = false }: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const cliqueEmCurso = useRef(false);
  const chaveServidor = `${id}:${marco}:${solicitacao?.estado ?? ""}:${solicitacao?.ocorrido_em ?? ""}:${solicitacao?.motivo ?? ""}`;
  type EstadoEnvio = "fila" | "enviando" | "enviado";
  const [local, setLocal] = useState<{ estado: EstadoEnvio; chaveServidor: string } | null>(null);
  const estadoServidor = solicitacao?.estado === "pendente" || solicitacao?.estado === "reservado" ? "fila"
    : solicitacao?.estado === "enviando" ? "enviando" : solicitacao?.estado === "enviado" ? "enviado" : null;
  // Uma atualização do servidor substitui o feedback otimista do POST. Assim
  // um cancelamento do worker não deixa o botão preso em "Na fila".
  const estado = confirmado ? "enviado" : local?.chaveServidor === chaveServidor ? local.estado : estadoServidor;
  const indeterminado = !confirmado && solicitacao?.estado === "indeterminado";
  const motivo = solicitacao?.motivo ?? (indeterminado
    ? "O resultado deste envio precisa ser conferido no WhatsApp antes de outra tentativa."
    : solicitacao?.estado === "expirado" ? "O prazo deste envio expirou."
      : solicitacao?.estado === "cancelado" ? "Este envio foi cancelado antes de concluir." : null);
  const setEstado = (novo: EstadoEnvio) => setLocal({ estado: novo, chaveServidor });

  async function cobrar() {
    if (cliqueEmCurso.current || ocupado || estado || indeterminado) return;
    cliqueEmCurso.current = true;
    setOcupado(true);
    try {
      const r = await fetch(`/api/admin/leads/${id}/lembrete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marco }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.ok !== true) throw new Error(json.erro ?? "Não consegui solicitar o envio.");
      if (json.estado === "enviado") {
        setEstado("enviado");
        toast.success(`Lembrete de ${marco} dias já enviado para ${nome || "o lead"}.`);
      } else if (json.estado === "enviando") {
        setEstado("enviando");
        toast.info(`O lembrete está sendo enviado para ${nome || "o lead"}.`);
      } else if (json.estado === "pendente" || json.estado === "reservado") {
        setEstado("fila");
        toast.success(`Lembrete na fila para ${nome || "o lead"}. O envio depende do WhatsApp conectado no Mac.`);
      } else {
        throw new Error(json.erro ?? "O envio não foi confirmado. Atualize o cartão antes de tentar novamente.");
      }
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      cliqueEmCurso.current = false;
      setOcupado(false);
    }
  }

  // Com seis colunas, em 1280px o cartao tem ~121px de linha e "Relembrar
  // cliente" com o icone pede ~137px: quebraria em duas linhas. Abaixo de 140px
  // de largura o botao fica so com o texto, como o "WhatsApp" do `ChamarWhatsApp`
  // -- container query, porque quem manda e a largura do cartao, nao a da tela.
  const icone = "hidden size-3.5 shrink-0 @min-[8.75rem]:block";

  return (
    <div className="@container">
      <button
        type="button"
        disabled={ocupado || estado !== null || indeterminado}
        aria-busy={ocupado || estado === "enviando"}
        aria-label={estado === "enviado" ? `Lembrete de ${marco} dias enviado para ${nome || "o lead"}` : undefined}
        onClick={cobrar}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5",
          "text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-60",
          "border-current/25 bg-white/60 hover:bg-white",
          classeTexto,
        )}
      >
        {ocupado || estado === "enviando" ? (
          <Loader2 className={cn(icone, "animate-spin")} />
        ) : estado === "enviado" ? (
          <Check className={icone} />
        ) : estado === "fila" ? (
          <Clock3 className={icone} />
        ) : (
          <MessageCircle className={icone} />
        )}
        {indeterminado ? "Conferir envio" : estado === "fila" ? "Na fila" : estado === "enviando" ? "Enviando" : estado === "enviado" ? "Enviado" : ROTULO_LEMBRETE[marco]}
      </button>
      {motivo && !estado && <p className="mt-1 text-[0.6875rem] leading-snug text-muted-foreground" role="status">{motivo}</p>}
    </div>
  );
}
