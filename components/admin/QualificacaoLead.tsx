"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { dataHoraLocal } from "@/lib/pdf/formatadores";

type Props = {
  id: string;
  qualificadoEm: string | null;
  temWhatsapp: boolean;
  ocupado: boolean;
  onOcupado: (ocupado: boolean) => void;
};

/** Uma marca explícita da Mel; nunca é inferida do formulário ou da proposta. */
export function QualificacaoLead({ id, qualificadoEm, temWhatsapp, ocupado, onOcupado }: Props) {
  const router = useRouter();
  const [confirmadoEm, setConfirmadoEm] = useState(qualificadoEm);
  const [vistoDoBanco, setVistoDoBanco] = useState(qualificadoEm);
  const [marcado, setMarcado] = useState(!!qualificadoEm);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Um refresh sincroniza só este campo. O estado das respostas em
  // DetalheLead permanece intacto, inclusive enquanto a marca falha.
  if (qualificadoEm !== vistoDoBanco && !salvando) {
    setVistoDoBanco(qualificadoEm);
    setConfirmadoEm(qualificadoEm);
    setMarcado(!!qualificadoEm);
  }

  async function alternar(proximo: boolean) {
    if (salvando || ocupado) return;
    const anterior = confirmadoEm;
    setMarcado(proximo);
    setSalvando(true);
    setErro(null);
    onOcupado(true);
    let recebidaDoServidor = false;
    try {
      const r = await fetch(`/api/admin/leads/${id}/qualificacao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualificado: proximo, base_qualificado_em: anterior }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && (json.qualificado_em === null || typeof json.qualificado_em === "string")) {
          setConfirmadoEm(json.qualificado_em);
          setMarcado(!!json.qualificado_em);
          recebidaDoServidor = true;
        } else {
          setMarcado(!!anterior);
        }
        throw new Error(json.erro ?? "Não consegui salvar a qualificação.");
      }
      if (json.qualificado_em !== null && typeof json.qualificado_em !== "string") {
        setMarcado(!!anterior);
        throw new Error("Não consegui confirmar a marcação. Tente de novo.");
      }
      setConfirmadoEm(json.qualificado_em);
      setMarcado(!!json.qualificado_em);
      recebidaDoServidor = true;
      router.refresh();
    } catch (e) {
      // Não limpar o erro ao editar outro campo nem descartar as respostas.
      // A próxima tentativa recebe a base confirmada, não um timestamp local.
      if (!recebidaDoServidor) setMarcado(!!anterior);
      setErro(e instanceof TypeError ? "Não consegui conectar. Tente marcar de novo." : (e as Error).message);
    } finally {
      setSalvando(false);
      onOcupado(false);
    }
  }

  const ajudaId = `qualificacao-ajuda-${id}`;
  const erroId = `qualificacao-erro-${id}`;
  return (
    <section aria-label="Qualificação do lead" className="space-y-2 rounded-lg border bg-card p-4">
      <label className="relative flex w-fit cursor-pointer items-center gap-2.5 text-sm font-medium">
        <span className="relative flex shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={marcado}
            disabled={salvando || ocupado || (!marcado && !temWhatsapp)}
            onChange={(e) => alternar(e.target.checked)}
            aria-describedby={`${ajudaId}${erro ? ` ${erroId}` : ""}`}
            className="peer size-5 appearance-none rounded-md border-2 border-foreground/40 bg-card transition-colors outline-none hover:border-foreground checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          />
          <Check aria-hidden="true" strokeWidth={3.5} className="pointer-events-none absolute size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100" />
        </span>
        Lead qualificado
        {salvando && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
      </label>
      <p id={ajudaId} className="text-xs leading-relaxed text-muted-foreground">
        Marque depois de confirmar o interesse, a data e o local e se o evento combina com o seu serviço.
        {!temWhatsapp && !marcado && " Salve um WhatsApp válido antes de marcar."}
      </p>
      {confirmadoEm && !salvando && <p className="text-xs text-muted-foreground">Qualificado em {dataHoraLocal(confirmadoEm)}.</p>}
      {erro && <p id={erroId} role="alert" className="text-sm text-destructive">{erro}</p>}
      {salvando && <span role="status" className="sr-only">Salvando qualificação.</span>}
    </section>
  );
}
