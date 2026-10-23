import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Status } from "@/lib/form/types";
import type { FiltrosNavegacao } from "@/lib/admin/navegacao";
import type { ColunaKanbanDados } from "@/lib/admin/paginacao-kanban";
import { COLUNAS_CARTAO, type LeadCartao } from "@/lib/admin/tipos";
import { compararCartoesNaColuna } from "@/lib/admin/ordem";
import { inicioDoPeriodo } from "@/lib/admin/periodo";
import { supabaseAdmin } from "./admin";
import { aplicarBuscaLeads } from "./busca-leads";
import { lerComRetentativa } from "./consulta";
import { lerDisparosWhatsApp } from "./disparos-whatsapp";
import { lerEsfriouPrioritario } from "./esfriou-prioritario";
import { lerTestesWhatsApp } from "./testes-whatsapp";

const TAMANHO_CONSULTA = 200;
const MENSAGEM_ERRO = "Não consegui carregar esta coluna. Tente novamente.";
type Entrada = { status: Status; filtros: FiltrosNavegacao; quantidade: number; agoraMs: number };

/**
 * Revalida o prefixo inteiro, em vez de acrescentar um offset a uma lista velha.
 * Status e histórico mudam a ordem enquanto a Mel usa o quadro. Nenhuma escrita,
 * manutenção ou fila é iniciada por esta leitura, compartilhada com a API.
 */
export async function lerColunaKanban(entrada: Entrada, cliente?: SupabaseClient): Promise<ColunaKanbanDados> {
  let total = 0;
  try {
    const db = cliente ?? supabaseAdmin();
    const { status, filtros, quantidade, agoraMs } = entrada;
    const desde = inicioDoPeriodo(filtros.periodo, agoraMs);
    if (status === "esfriou") {
      const resposta = await lerEsfriouPrioritario({ termo: filtros.q, categoria: filtros.categoria,
        desde, agoraMs, limite: quantidade }, db);
      return {
        cartoes: resposta.error ? [] : resposta.data ?? [],
        total: resposta.count ?? 0,
        erro: resposta.error ? MENSAGEM_ERRO : null,
        erroDisparos: resposta.erroDisparos,
      };
    }

    const unicos = new Map<string, LeadCartao>();
    for (let inicio = 0; inicio < quantidade; inicio += TAMANHO_CONSULTA) {
      const tamanho = Math.min(TAMANHO_CONSULTA, quantidade - inicio);
      const resposta = await lerComRetentativa(`coluna ${status}`, () => {
        let consulta = db.from("leads").select(COLUNAS_CARTAO, { count: "exact" }).eq("status", status)
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(inicio, inicio + tamanho - 1);
        consulta = aplicarBuscaLeads(consulta, filtros.q);
        if (filtros.categoria) consulta = consulta.eq("categoria", filtros.categoria);
        if (desde) consulta = consulta.gte("created_at", desde);
        return consulta.abortSignal(AbortSignal.timeout(5_000)).retry(false);
      });
      total = resposta.count ?? total;
      if (resposta.error) return { cartoes: [], total, erro: MENSAGEM_ERRO };
      const pagina = (resposta.data ?? []) as unknown as LeadCartao[];
      for (const lead of pagina) unicos.set(lead.id, lead);
      if (pagina.length < tamanho || (resposta.count !== null && resposta.count !== undefined && inicio + pagina.length >= total)) break;
    }

    const cartoes = [...unicos.values()].sort((a, b) => compararCartoesNaColuna(a, b, status, agoraMs));
    const [disparos, testes] = await Promise.all([
      lerDisparosWhatsApp(cartoes.map(lead => lead.id), db), lerTestesWhatsApp(cartoes, agoraMs, db),
    ]);
    return {
      cartoes: cartoes.map(lead => ({ ...lead,
        disparos_whatsapp: disparos.porLead.get(lead.id) ?? [],
        solicitacoes_whatsapp: disparos.solicitacoesPorLead.get(lead.id) ?? [],
        teste_whatsapp: testes.get(lead.id),
      })),
      total,
      erro: null,
      erroDisparos: disparos.erro,
    };
  } catch {
    console.error("[admin] não consegui carregar a coluna do Kanban");
    return { cartoes: [], total, erro: MENSAGEM_ERRO };
  }
}
