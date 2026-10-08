import "server-only";
import { z } from "zod";
import { CATEGORIAS, type Categoria, type Respostas, type Status } from "@/lib/form/types";
import { estadosIguais } from "@/lib/form/snapshot";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** A versao que o navegador recebeu no ultimo ACK, sem relogio ou coluna nova. */
export const corpoBaseLead = z.object({
  categoria: z.enum(CATEGORIAS),
  respostas: z.record(z.string(), z.string()),
  passo_atual: z.string().nullable(),
});

export type BaseLead = z.infer<typeof corpoBaseLead>;
export type VersaoLead = {
  categoria: Categoria;
  respostas: Respostas | null;
  passo_atual: string | null;
};

/** JSONb nao depende da ordem das chaves; uma resposta removida tambem e mudanca. */
export function mesmaVersaoLead(base: BaseLead, lead: VersaoLead): boolean {
  return estadosIguais(base, { ...lead, respostas: lead.respostas ?? {} });
}

export type LeadParaEscrita = VersaoLead & {
  id: string;
  status: Status;
  updated_at: string;
};

export const CAMPOS_VERSAO_LEAD = "id, categoria, status, respostas, passo_atual, updated_at";

type ResultadoEscrita =
  | { tipo: "salvo"; lead: LeadParaEscrita }
  | { tipo: "mudou"; lead: LeadParaEscrita | null }
  | { tipo: "erro"; erro: unknown };

/**
 * O JSON completo fica no corpo, nunca na URL do PostgREST. O timestamp lido
 * pelo servidor condiciona a escrita; nao faz parte da base do navegador.
 * Rastreio tambem altera esse timestamp: zero linhas exige uma nova leitura e
 * a comparacao das respostas antes de repetir. Erro de escrita nao e repetido,
 * porque a gravacao pode ter ocorrido e perdido somente sua resposta.
 */
export async function atualizarVersaoLead(
  inicial: LeadParaEscrita,
  valores: Record<string, unknown>,
): Promise<ResultadoEscrita> {
  const base: BaseLead = { categoria: inicial.categoria, respostas: inicial.respostas ?? {}, passo_atual: inicial.passo_atual };
  let versao = inicial;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data: salvo, error } = await supabaseAdmin()
      .from("leads")
      .update(valores)
      .eq("id", inicial.id)
      .eq("status", "incompleto")
      .eq("updated_at", versao.updated_at)
      .select(CAMPOS_VERSAO_LEAD)
      .maybeSingle();
    if (error) return { tipo: "erro", erro: error };
    if (salvo) return { tipo: "salvo", lead: salvo as LeadParaEscrita };

    const { data: atual, error: erroLeitura } = await supabaseAdmin()
      .from("leads")
      .select(CAMPOS_VERSAO_LEAD)
      .eq("id", inicial.id)
      .maybeSingle();
    if (erroLeitura) return { tipo: "erro", erro: erroLeitura };
    if (!atual || atual.status !== "incompleto" || !mesmaVersaoLead(base, atual)) {
      return { tipo: "mudou", lead: atual as LeadParaEscrita | null };
    }
    versao = atual as LeadParaEscrita;
  }
  return { tipo: "erro", erro: new Error("O lead recebeu outras atualizações durante as três tentativas de salvar.") };
}
