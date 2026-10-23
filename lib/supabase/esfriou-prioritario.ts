import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Categoria } from "@/lib/form/types";
import { COLUNAS_CARTAO, type LeadCartao } from "@/lib/admin/tipos";
import { compararCartoesNaColuna } from "@/lib/admin/ordem";
import { supabaseAdmin } from "./admin";
import { lerComRetentativa } from "./consulta";
import { lerDisparosWhatsApp } from "./disparos-whatsapp";
import { lerTestesWhatsApp } from "./testes-whatsapp";
import { aplicarBuscaLeads } from "./busca-leads";

const TAMANHO_PAGINA = 200;
type Entrada = { termo: string; categoria?: Categoria; desde: string | null; agoraMs: number; limite: number };
export type ResultadoEsfriou = {
  data: LeadCartao[] | null;
  count: number | null;
  error: { message: string; code?: string } | null;
  erroDisparos: boolean;
};

/** Seleciona os prioritários ANTES do corte de 50; um vermelho antigo não pode sumir. */
export async function lerEsfriouPrioritario(entrada: Entrada, cliente?: SupabaseClient): Promise<ResultadoEsfriou> {
  const db = cliente ?? supabaseAdmin();
  let melhores: LeadCartao[] = [];
  let count: number | null = null;
  let erroDisparos = false;
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const resposta = await lerComRetentativa("prioridade Esfriou", () => {
      let consulta = db.from("leads").select(COLUNAS_CARTAO, { count: "exact" }).eq("status", "esfriou")
        .order("created_at", { ascending: false }).order("id", { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      consulta = aplicarBuscaLeads(consulta, entrada.termo);
      if (entrada.categoria) consulta = consulta.eq("categoria", entrada.categoria);
      if (entrada.desde) consulta = consulta.gte("created_at", entrada.desde);
      return consulta.abortSignal(AbortSignal.timeout(5_000));
    });
    if (resposta.error) return { data: null, count, error: resposta.error, erroDisparos };
    const pagina = (resposta.data ?? []) as unknown as LeadCartao[];
    count = resposta.count ?? count;
    const [disparos, testes] = await Promise.all([
      lerDisparosWhatsApp(pagina.map(l => l.id), db), lerTestesWhatsApp(pagina, entrada.agoraMs, db),
    ]);
    erroDisparos ||= disparos.erro;
    const enriquecidos = pagina.map(lead => ({
      ...lead, disparos_whatsapp: disparos.porLead.get(lead.id) ?? [],
      solicitacoes_whatsapp: disparos.solicitacoesPorLead.get(lead.id) ?? [], teste_whatsapp: testes.get(lead.id),
    }));
    melhores = [...new Map([...melhores, ...enriquecidos].map(l => [l.id, l])).values()]
      .sort((a, b) => compararCartoesNaColuna(a, b, "esfriou", entrada.agoraMs)).slice(0, entrada.limite);
    if (pagina.length < TAMANHO_PAGINA || (count !== null && inicio + pagina.length >= count)) break;
  }
  return { data: melhores, count: count ?? melhores.length, error: null, erroDisparos };
}
