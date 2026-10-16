import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DisparoWhatsApp, SolicitacaoWhatsApp } from "@/lib/admin/tipos";
import { ehDataEnvioWhatsApp, ehTipoDisparoWhatsApp } from "@/lib/admin/disparos-whatsapp";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerComRetentativa } from "@/lib/supabase/consulta";

type ResultadoDisparos = {
  porLead: Map<string, DisparoWhatsApp[]>;
  solicitacoesPorLead: Map<string, SolicitacaoWhatsApp[]>;
  erro: boolean;
};
const MOTIVOS: Readonly<Record<string, string>> = {
  inactivity_recent: "Houve interação recente com este contato no WhatsApp.",
  interacao_recente: "Houve interação recente com este contato no WhatsApp.",
  inactivity_unverified: "O histórico do WhatsApp não pôde ser verificado. Isso não confirma uma interação recente.",
  historico_em_sincronizacao: "O WhatsApp ainda está sincronizando o histórico. Tente novamente após a sincronização.",
  historico_incompleto: "Histórico em validação. Ainda falta completar o período mínimo de observação.",
  historico_indisponivel: "A verificação do histórico do WhatsApp está indisponível. O envio foi bloqueado por segurança.",
  identidade_nao_confirmada: "Ainda não foi possível confirmar a identidade deste contato no WhatsApp.",
  historico_obsoleto: "É necessário atualizar a verificação do histórico do WhatsApp.",
  proposta_condicao_alterada: "A proposta ou as condições deste lembrete mudaram.",
  teste_owner_expirado: "O período autorizado para este teste terminou ou os dados do teste mudaram.",
};
const ESTADOS = ["pendente", "reservado", "enviando", "enviado", "indeterminado", "expirado", "cancelado"] as const;
// Mesma lista da RPC enfileirar_lembrete_proposta_whatsapp. O navegador recebe
// só a decisão, sem os metadados privados que a determinaram.
const CODIGOS_REENVIO = new Set([
  "inactivity_recent", "inactivity_unverified", "proposta_condicao_alterada", "historico_em_sincronizacao",
  "historico_incompleto", "historico_indisponivel", "identidade_nao_confirmada",
]);
const DIAS_HISTORICO: Readonly<Record<string, number>> = { lembrete_proposta_7d: 5, lembrete_proposta_30d: 15 };
const formatoHistorico = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function motivoSolicitacao(linha: {
  ultimo_codigo: unknown; tipo: string; historico_verificado_em?: unknown;
  historico_cobertura_inicio_em?: unknown; ultima_interacao_em?: unknown;
}, agora: number): string | null {
  const codigo = linha.ultimo_codigo;
  if (typeof codigo !== "string" || !Object.hasOwn(MOTIVOS, codigo)) return null;
  const padrao = MOTIVOS[codigo];
  if (codigo !== "historico_incompleto" || !ehDataEnvioWhatsApp(linha.historico_verificado_em) ||
    !ehDataEnvioWhatsApp(linha.historico_cobertura_inicio_em) ||
    (linha.ultima_interacao_em !== null && !ehDataEnvioWhatsApp(linha.ultima_interacao_em))) return padrao;
  const verificado = Date.parse(linha.historico_verificado_em);
  const cobertura = Date.parse(linha.historico_cobertura_inicio_em);
  const interacao = linha.ultima_interacao_em === null ? null : Date.parse(linha.ultima_interacao_em as string);
  const dias = DIAS_HISTORICO[linha.tipo];
  const previsto = cobertura + dias * 86_400_000;
  if (!dias || verificado <= 0 || verificado > agora + 5_000 || cobertura <= 0 || cobertura > verificado ||
    (interacao !== null && (interacao <= 0 || interacao > verificado)) ||
    !Number.isFinite(previsto) || previsto <= verificado || previsto <= agora) return padrao;
  const partes = formatoHistorico.formatToParts(previsto);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((valor) => valor.type === tipo)?.value;
  return `Histórico em validação. Período mínimo previsto para ${parte("day")}.${parte("month")} às ${parte("hour")}h${parte("minute")}, enquanto a verificação continuar válida.`;
}

/**
 * Lotes pequenos para os cartões visíveis e a seleção prioritária de Esfriou.
 * Fila segue privada: não seleciona texto, telefone, sequência ou credenciais.
 */
export async function lerDisparosWhatsApp(
  ids: readonly string[],
  cliente?: SupabaseClient,
): Promise<ResultadoDisparos> {
  const porLead = new Map<string, DisparoWhatsApp[]>();
  const solicitacoesPorLead = new Map<string, SolicitacaoWhatsApp[]>();
  const visiveis = [...new Set(ids)];
  if (!visiveis.length) return { porLead, solicitacoesPorLead, erro: false };
  const idsPermitidos = new Set(visiveis);

  try {
    const db = cliente ?? supabaseAdmin();
    const lotes = Array.from({ length: Math.ceil(visiveis.length / 100) }, (_, i) => visiveis.slice(i * 100, (i + 1) * 100));
    const consultar = (ids: string[], inicio: number) => lerComRetentativa("histórico de WhatsApp", () => db
      .from("whatsapp_outbox")
      .select("lead_id,tipo,enviado_em,estado,ocorrido_em,proposta_enviado_em,ultimo_codigo,iniciado_em,historico_verificado_em,historico_cobertura_inicio_em,ultima_interacao_em")
      .in("lead_id", ids)
      .in("tipo", ["confirmacao_recebimento", "lembrete_formulario_24h", "lembrete_proposta_7d", "lembrete_proposta_30d", "proposta_inicial_15m"])
      .in("estado", ESTADOS).order("id", { ascending: true }).range(inicio, inicio + 999)
      .abortSignal(AbortSignal.timeout(5_000)));
    const respostas = await Promise.all(lotes.map(async ids => {
      let resposta = await consultar(ids, 0);
      const linhas = [...(resposta.data ?? [])];
      for (let inicio = 1000; !resposta.error && resposta.data?.length === 1000; inicio += 1000) {
        resposta = await consultar(ids, inicio);
        linhas.push(...(resposta.data ?? []));
      }
      return { data: linhas, error: resposta.error };
    }));
    if (respostas.some(r => r.error)) return { porLead, solicitacoesPorLead, erro: true };
    const data = respostas.flatMap(r => r.data);
    const agora = Date.now();
    for (const linha of data ?? []) {
      if (!linha || !idsPermitidos.has(linha.lead_id) || !ehTipoDisparoWhatsApp(linha.tipo)) continue;
      if (linha.estado === "enviado" && ehDataEnvioWhatsApp(linha.enviado_em)) {
        const disparos = porLead.get(linha.lead_id) ?? [];
        const revisao = (linha.tipo === "lembrete_proposta_7d" || linha.tipo === "lembrete_proposta_30d") &&
          ehDataEnvioWhatsApp(linha.proposta_enviado_em)
          ? { proposta_enviado_em: linha.proposta_enviado_em } : {};
        disparos.push({ tipo: linha.tipo, enviado_em: linha.enviado_em, ...revisao });
        porLead.set(linha.lead_id, disparos);
      }
      if ((linha.tipo === "lembrete_proposta_7d" || linha.tipo === "lembrete_proposta_30d") &&
        ESTADOS.includes(linha.estado) && ehDataEnvioWhatsApp(linha.ocorrido_em) &&
        ehDataEnvioWhatsApp(linha.proposta_enviado_em)) {
        const solicitacoes = solicitacoesPorLead.get(linha.lead_id) ?? [];
        solicitacoes.push({ tipo: linha.tipo, estado: linha.estado, ocorrido_em: linha.ocorrido_em,
          proposta_enviado_em: linha.proposta_enviado_em,
          reenvioPermitido: linha.estado === "cancelado" && linha.iniciado_em === null &&
            CODIGOS_REENVIO.has(linha.ultimo_codigo),
          motivo: motivoSolicitacao(linha, agora) });
        solicitacoesPorLead.set(linha.lead_id, solicitacoes);
      }
    }
    return { porLead, solicitacoesPorLead, erro: false };
  } catch {
    // A leitura auxiliar nunca deve apagar as raias que já carregaram.
    console.error("[admin] não consegui carregar o histórico de WhatsApp");
    return { porLead, solicitacoesPorLead, erro: true };
  }
}
