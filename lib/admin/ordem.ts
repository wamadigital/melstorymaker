import { estadoLembrete } from "@/lib/admin/lembretes";
import type { LeadCartao } from "@/lib/admin/tipos";
import type { Lead, Status } from "@/lib/form/types";

/**
 * Chegada do lead, mais novo em cima. Continua a ordem de todas as colunas
 * exceto Esfriou, onde também desempata cartões da mesma prioridade.
 * Comparar o instante evita que precisões diferentes do Postgres alterem a
 * ordem de datas equivalentes.
 */
type Chegada = Pick<Lead, "created_at"> & Partial<Pick<Lead, "id">>;

function microsRestantes(data: string): number {
  const fracao = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i.exec(data)?.[1] ?? "";
  return Number(fracao.padEnd(6, "0").slice(3, 6));
}

export function maisNovoPrimeiro(a: Chegada, b: Chegada): number {
  const instante = (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
  // Postgres preserva microssegundos; Date.parse sozinho trunca depois de 3 casas.
  const micros = microsRestantes(b.created_at) - microsRestantes(a.created_at);
  const idA = a.id ?? "";
  const idB = b.id ?? "";
  return instante || micros || (idA < idB ? -1 : idA > idB ? 1 : 0);
}

type CamposPrioridade = Pick<LeadCartao,
  "enviado_em" | "lembrete_7_em" | "lembrete_30_em" | "disparos_whatsapp" |
  "solicitacoes_whatsapp" | "teste_whatsapp">;

/**
 * Somente Esfriou prioriza ações: última tentativa, primeiro lembrete, demais.
 * Uma solicitação em curso, concluída ou sem resultado seguro já foi clicada
 * e sai dos grupos de ação. Só cancelamento reativável, comprovado pelo
 * servidor antes de iniciar, permite novo clique. Histórico de outra revisão
 * não esconde a ação da proposta vigente.
 */
export function prioridadeEsfriou(lead: CamposPrioridade, agoraMs: number): 0 | 1 | 2 {
  const { pendente } = estadoLembrete(lead, "esfriou", agoraMs);
  if (!pendente) return 2;

  const solicitacao = lead.solicitacoes_whatsapp?.filter((item) =>
    item.tipo === `lembrete_proposta_${pendente}d` &&
    item.proposta_enviado_em === lead.enviado_em)
    .sort((a, b) => Date.parse(b.ocorrido_em) - Date.parse(a.ocorrido_em))[0];
  if (solicitacao && (solicitacao.estado !== "cancelado" || solicitacao.reenvioPermitido !== true)) return 2;

  return pendente === 30 ? 0 : 1;
}

/** A coluna desenhada também cobre o destino otimista de um arraste. */
export function compararCartoesNaColuna(
  a: CamposPrioridade & Chegada,
  b: CamposPrioridade & Chegada,
  coluna: Status,
  agoraMs: number,
): number {
  if (coluna === "esfriou") {
    const prioridade = prioridadeEsfriou(a, agoraMs) - prioridadeEsfriou(b, agoraMs);
    if (prioridade) return prioridade;
  }
  return maisNovoPrimeiro(a, b);
}
