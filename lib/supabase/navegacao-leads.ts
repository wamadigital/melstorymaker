import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarFiltrosNavegacao, vizinhosNaSequencia, type FiltrosNavegacao, type VizinhosLead } from "@/lib/admin/navegacao";
import { inicioDoPeriodo } from "@/lib/admin/periodo";
import { COLUNAS_CARTAO, type LeadCartao } from "@/lib/admin/tipos";
import { STATUS, type Status } from "@/lib/form/types";
import { supabaseAdmin } from "./admin";
import { lerComRetentativa } from "./consulta";
import { lerDisparosWhatsApp } from "./disparos-whatsapp";
import { lerTestesWhatsApp } from "./testes-whatsapp";

const TAMANHO_PAGINA = 200;
export type ResultadoNavegacaoLead = VizinhosLead & { erro: string | null };
const falha = (): ResultadoNavegacaoLead => ({ anterior: null, proximo: null, atualIncluido: false,
  erro: "Não consegui carregar a sequência dos leads. Atualize a página para tentar de novo." });

/**
 * Leitura exclusiva da navegação: nenhuma chamada ao esfriamento ou às filas
 * de automação. Pagina até o fim, inclusive além do teto de 1.000 do PostgREST.
 * A service role fica somente aqui, depois da autenticação do painel.
 */
export async function lerNavegacaoLead(
  id: string,
  filtros: FiltrosNavegacao,
  agoraMs: number = Date.now(),
  cliente?: SupabaseClient,
): Promise<ResultadoNavegacaoLead> {
  try {
    const db = cliente ?? supabaseAdmin();
    const contexto = normalizarFiltrosNavegacao(filtros);
    const desde = inicioDoPeriodo(contexto.periodo, agoraMs);
    const lerColuna = async (status: Status): Promise<LeadCartao[] | null> => {
      const cartoes: LeadCartao[] = [];
      for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
        const resposta = await lerComRetentativa(`navegação ${status}`, () => {
          let consulta = db.from("leads").select(COLUNAS_CARTAO).eq("status", status)
            .order("created_at", { ascending: false }).order("id", { ascending: true })
            .range(inicio, inicio + TAMANHO_PAGINA - 1);
          if (contexto.q) consulta = consulta.ilike("nome_display", `%${contexto.q}%`);
          if (contexto.categoria) consulta = consulta.eq("categoria", contexto.categoria);
          if (desde) consulta = consulta.gte("created_at", desde);
          return consulta.abortSignal(AbortSignal.timeout(5_000));
        });
        if (resposta.error) return null;
        const pagina = (resposta.data ?? []) as unknown as LeadCartao[];
        if (status === "esfriou" && pagina.length) {
          // Só esta coluna depende do histórico para ordenar as ações.
          const [disparos, testes] = await Promise.all([
            lerDisparosWhatsApp(pagina.map(lead => lead.id), db),
            lerTestesWhatsApp(pagina, agoraMs, db),
          ]);
          if (disparos.erro) return null;
          cartoes.push(...pagina.map(lead => ({ ...lead,
            disparos_whatsapp: disparos.porLead.get(lead.id) ?? [],
            solicitacoes_whatsapp: disparos.solicitacoesPorLead.get(lead.id) ?? [],
            teste_whatsapp: testes.get(lead.id),
          })));
        } else {
          cartoes.push(...pagina);
        }
        if (pagina.length < TAMANHO_PAGINA) return cartoes;
      }
    };
    const colunas = await Promise.all(STATUS.map(lerColuna));
    // Não pular silenciosamente uma raia ou usar uma prioridade incompleta.
    if (colunas.some(coluna => coluna === null)) return falha();
    return { ...vizinhosNaSequencia(id, colunas.flatMap(coluna => coluna ?? []), agoraMs), erro: null };
  } catch {
    console.error("[admin] não consegui carregar a navegação de leads");
    return falha();
  }
}
