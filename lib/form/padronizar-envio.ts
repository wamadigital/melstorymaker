import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { colunasPromovidas } from "@/lib/leads";
import type { LeadParaEscrita } from "./versao-lead";
import { padronizarNomes, PadronizacaoNomesError } from "./padronizar-nomes";
import { estadosIguais } from "./snapshot";

/** Só o submit vencedor agenda. Correção não sobrescreve uma edição posterior. */
export async function padronizarRespostasEnviadas(
  lead: LeadParaEscrita,
  normalizar = padronizarNomes,
): Promise<"salvo" | "inalterado" | "mudou" | "falhou"> {
  if (lead.status !== "aguardando_revisao") return "mudou";
  try {
    const originais = lead.respostas ?? {};
    const respostas = await normalizar(lead.categoria, originais);
    if (estadosIguais(
      { categoria: lead.categoria, respostas: originais, passo_atual: lead.passo_atual },
      { categoria: lead.categoria, respostas, passo_atual: lead.passo_atual },
    )) return "inalterado";
    const { data, error } = await supabaseAdmin().from("leads")
      .update({ respostas, ...colunasPromovidas(lead.categoria, respostas) })
      .eq("id", lead.id).eq("status", "aguardando_revisao").eq("updated_at", lead.updated_at)
      .select("id").maybeSingle();
    if (error) throw new PadronizacaoNomesError("gravacao");
    return data ? "salvo" : "mudou";
  } catch (erro) {
    // Não logar erro do SDK, nomes ou respostas: ele pode incluir conteúdo.
    console.warn("[formulario:padronizacao]", erro instanceof PadronizacaoNomesError ? erro.codigo : "falha");
    return "falhou";
  }
}
