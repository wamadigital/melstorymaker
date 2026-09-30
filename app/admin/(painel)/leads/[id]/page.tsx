import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerRegistro } from "@/lib/supabase/contratos";
import { iaDisponivel } from "@/lib/contrato/ia";
import { assinaturaConfigurada } from "@/lib/assinatura/adapter";
import { hojeEmSaoPaulo } from "@/lib/contrato/regras";
import type { RegistroContrato } from "@/lib/contrato/tipos";
import { env } from "@/lib/env";
import type { Lead } from "@/lib/form/types";
import { DetalheLead } from "@/components/admin/DetalheLead";

export default async function PaginaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data } = await supabaseAdmin().from("leads").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();

  // O contrato e lido a parte, e a falha dele NAO derruba o detalhe: a Mel
  // continua vendo o lead e a proposta. A secao de contrato recebe a flag e
  // mostra "nao consegui carregar" -- em vez de abrir o formulario
  // pre-preenchido, cujo "Salvar rascunho" sobrescreveria o contrato que existe.
  let registroContrato: RegistroContrato | null = null;
  let falhaAoLerContrato = false;
  try {
    registroContrato = await lerRegistro(id);
  } catch (e) {
    // So o id e o tipo do erro: a mensagem pode trazer pedaco do payload.
    console.error(`[contrato] ${id} nao consegui ler o registro do contrato`, (e as Error)?.name ?? "erro");
    falhaAoLerContrato = true;
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
        lead={data as Lead}
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
