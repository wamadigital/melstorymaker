import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Lead } from "@/lib/form/types";
import { DetalheLead } from "@/components/admin/DetalheLead";

export default async function PaginaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data } = await supabaseAdmin().from("leads").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();

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

      <DetalheLead lead={data as Lead} />
    </div>
  );
}
