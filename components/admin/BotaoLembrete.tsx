"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ROTULO_LEMBRETE, type Marco } from "@/lib/admin/lembretes";
import type { SolicitacaoWhatsApp } from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  nome: string;
  marco: Marco;
  /** Revisão exata da proposta, sem truncar os microssegundos do banco. */
  propostaEnviadoEm: string | null;
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
export function BotaoLembrete({ id, nome, marco, propostaEnviadoEm, classeTexto, solicitacao, confirmado = false }: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const cliqueEmCurso = useRef(false);
  const chaveServidor = `${id}:${marco}:${propostaEnviadoEm ?? ""}:${solicitacao?.estado ?? ""}:${solicitacao?.ocorrido_em ?? ""}:${solicitacao?.motivo ?? ""}:${solicitacao?.reenvioPermitido === true}`;
  type EstadoEnvio = "fila" | "enviando" | "enviado";
  const [local, setLocal] = useState<{ estado: EstadoEnvio; chaveServidor: string } | null>(null);
  const estadoServidor = solicitacao?.estado === "pendente" || solicitacao?.estado === "reservado" ? "fila"
    : solicitacao?.estado === "enviando" ? "enviando" : solicitacao?.estado === "enviado" ? "enviado" : null;
  // Uma atualização do servidor substitui o feedback otimista do POST. Assim
  // um cancelamento do worker permite que a ação reapareça. Outra proposta
  // ou outro marco também não herdam o estado otimista do envio anterior.
  const estado = confirmado ? "enviado" : local?.chaveServidor === chaveServidor ? local.estado : estadoServidor;
  const indeterminado = !confirmado && solicitacao?.estado === "indeterminado";
  const encerrado = solicitacao?.estado === "expirado" ||
    (solicitacao?.estado === "cancelado" && solicitacao.reenvioPermitido !== true);
  const motivo = solicitacao?.estado === "cancelado" && solicitacao.reenvioPermitido === true
    ? solicitacao.motivo ?? "Este envio foi cancelado antes de concluir." : null;
  const setEstado = (novo: EstadoEnvio) => setLocal({ estado: novo, chaveServidor });

  async function cobrar() {
    if (cliqueEmCurso.current || ocupado || estado || indeterminado || encerrado) return;
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
        toast.success(`Lembrete na fila para ${nome || "o lead"}. O envio depende do WhatsApp conectado.`);
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

  // O histórico no ícone do cartão é o único resumo dos envios. Esconder a
  // ação já no clique evita outro disparo enquanto o POST/worker responde;
  // nenhum texto ou botão desabilitado ocupa o lugar dela.
  if (ocupado || estado || indeterminado || encerrado) return null;

  // Com seis colunas, em 1280px o cartao tem ~121px de linha e "Relembrar
  // cliente" com o icone pede ~137px: quebraria em duas linhas. Abaixo de 140px
  // de largura o botao fica so com o texto, como o "WhatsApp" do `ChamarWhatsApp`
  // -- container query, porque quem manda e a largura do cartao, nao a da tela.
  const icone = "hidden size-3.5 shrink-0 @min-[8.75rem]:block";

  return (
    <div className="@container px-3 pb-3">
      <button
        type="button"
        onClick={cobrar}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5",
          "text-xs font-semibold whitespace-nowrap transition-colors",
          "border-current/25 bg-white/60 hover:bg-white",
          classeTexto,
        )}
      >
        <MessageCircle className={icone} />
        {ROTULO_LEMBRETE[marco]}
      </button>
      {motivo && <p className="mt-1 text-[0.6875rem] leading-snug text-muted-foreground" role="status">{motivo}</p>}
    </div>
  );
}
