import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerRegistro } from "@/lib/supabase/contratos";
import { iaDisponivel } from "@/lib/contrato/ia";
import { assinaturaConfigurada } from "@/lib/assinatura/adapter";
import { hojeEmSaoPaulo } from "@/lib/contrato/regras";
import { carregarDetalhe } from "@/lib/admin/detalhe";
import { lerComRetentativa } from "@/lib/supabase/consulta";
import { env } from "@/lib/env";
import type { Lead } from "@/lib/form/types";
import { DetalheLead } from "@/components/admin/DetalheLead";
import { FalhaCarregamentoLead } from "@/components/admin/FalhaCarregamentoLead";

export default async function PaginaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const resultado = await carregarDetalhe({
    lerLead: () => lerComRetentativa<Lead>(`detalhe ${id}`, () =>
      supabaseAdmin().from("leads").select("*").eq("id", id).maybeSingle(),
    ),
    lerContrato: () => lerRegistro(id),
  });

  if (resultado.estado === "erro") {
    // Nada do payload entra no log ou na tela. O erro de SELECT já foi
    // registrado por lerComRetentativa; aqui cobre também falhas lançadas.
    console.error(`[admin] ${id}: não consegui carregar o lead`, (resultado.erro as Error)?.name ?? "consulta");
    return <FalhaCarregamentoLead />;
  }
  if (resultado.estado === "ausente") notFound();

  const { lead, registroContrato, falhaAoLerContrato, erroContrato } = resultado;
  if (falhaAoLerContrato) {
    // O contrato falhou: mantém lead/proposta acessíveis e bloqueia a seção
    // de contrato em vez de oferecer um rascunho que sobrescreva o existente.
    console.error(`[contrato] ${id} nao consegui ler o registro do contrato`, (erroContrato as Error)?.name ?? "erro");
  }

  return (
    // O layout do painel agora e largo por causa do quadro; o detalhe e texto
    // para ler e corrigir, entao recupera aqui a propria medida.
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Voltar para a lista
      </Link>

      <DetalheLead
        lead={lead}
        registroContrato={registroContrato}
        falhaAoLerContrato={falhaAoLerContrato}
        // "Hoje" em Sao Paulo, calculado AQUI: o servidor da Vercel roda em UTC
        // e, depois das 21h de Brasilia, um toISOString ja seria amanha.
        hojeISO={hojeEmSaoPaulo(Date.now())}
        iaDisponivel={iaDisponivel()}
        assinaturaConfigurada={assinaturaConfigurada()}
        assinaturaDryRun={env.ASSINATURA_DRY_RUN}
      />
    </div>
  );
}
