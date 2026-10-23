import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";
import { urlDetalheLead, urlQuadroLeads, type FiltrosNavegacao, type VizinhosLead } from "@/lib/admin/navegacao";

export type NavegacaoNoDetalhe = VizinhosLead & { erro: string | null; filtros: FiltrosNavegacao };

export function NavegacaoLeads({ navegacao, bloqueio }: {
  navegacao: NavegacaoNoDetalhe;
  bloqueio?: string;
}) {
  const { anterior, proximo, filtros, erro, atualIncluido } = navegacao;
  const aviso = bloqueio ?? erro ?? (!atualIncluido ? "Este lead está fora dos filtros da lista." : null);
  const classeSeta = "inline-flex size-11 items-center justify-center rounded-md border transition-colors";

  function seta(vizinho: VizinhosLead["anterior"], lado: "anterior" | "proximo") {
    const rotulo = lado === "anterior" ? "Lead anterior" : "Próximo lead";
    const Icone = lado === "anterior" ? ChevronLeft : ChevronRight;
    return vizinho && !aviso ? (
      <Link
        href={urlDetalheLead(vizinho.id, filtros)}
        // Cada destino já consulta a sequência atual; não antecipar duas leituras completas.
        prefetch={false}
        aria-label={rotulo}
        title={`${rotulo}: ${vizinho.nome || "Sem nome"} · ${ROTULO_STATUS[vizinho.status]}`}
        className={`${classeSeta} hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring`}
      >
        <Icone className="size-5" aria-hidden />
      </Link>
    ) : (
      <button
        type="button"
        disabled
        aria-label={rotulo}
        title={aviso ?? (lado === "anterior" ? "Primeiro lead da sequência" : "Último lead da sequência")}
        className={`${classeSeta} cursor-default text-muted-foreground opacity-40`}
      >
        <Icone className="size-5" aria-hidden />
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Link href={urlQuadroLeads(filtros)} prefetch={false}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para a lista
        </Link>
        <nav aria-label="Navegar entre leads" className="flex shrink-0 gap-2">
          {seta(anterior, "anterior")}
          {seta(proximo, "proximo")}
        </nav>
      </div>
      {aviso && <p role="status" className="text-xs text-muted-foreground">{aviso}</p>}
    </div>
  );
}
