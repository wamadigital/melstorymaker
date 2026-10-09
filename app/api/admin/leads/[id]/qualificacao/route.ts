import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { enviarEventosCrmDoLead } from "@/lib/meta/crm";
import { tratarQualificacao } from "./_handler";

export const maxDuration = 60;

/** PATCH autenticado; qualificação manual não troca a raia do Kanban. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return tratarQualificacao(req, ctx, {
    sessao: getSessaoAdmin,
    banco: supabaseAdmin,
    agendar: after,
    enviar: enviarEventosCrmDoLead,
  });
}
