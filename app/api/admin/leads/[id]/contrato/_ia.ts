import "server-only";
import { IaError, IaIndisponivelError } from "@/lib/contrato/ia";
import { Recusa } from "./_comum";

// Traducao dos erros da IA para as rotas que a chamam (extrair, revisar). Fora
// do `_comum.ts` de proposito: importar `lib/contrato/ia` traz o SDK da
// Anthropic junto, e as rotas de PDF, arquivo e assinatura nao precisam dele.

/**
 * Status HTTP pelo `codigo` do IaError. A mensagem ja vem pronta para a tela
 * (ia.ts); aqui so se escolhe o numero:
 * - excesso de uso: 429, a Mel espera e tenta de novo;
 * - fora do ar, lento, conexao caiu: 503, transitorio;
 * - recusa, resposta longa demais, entrada vazia: 422, depende do que foi pedido;
 * - o resto (chave recusada, JSON fora do formato...): 502, problema do outro lado.
 */
const STATUS_POR_CODIGO: Record<string, number> = {
  "429": 429,
  "5xx": 503,
  timeout: 503,
  conexao: 503,
  abortado: 503,
  refusal: 422,
  max_tokens: 422,
  model_context_window_exceeded: 422,
  vazio: 422,
};

/** A Recusa correspondente, ou `null` se o erro nao e da IA (quem chama relanca). */
export function recusaDaIa(e: unknown, id: string, etapa: string): Recusa | null {
  if (e instanceof IaIndisponivelError) return new Recusa(503, e.message);
  if (e instanceof IaError) {
    // So o codigo: a mensagem da IA nunca leva conteudo, mas o log e o lugar
    // em que menos se quer arriscar.
    console.warn(`[contrato] ${id} ${etapa}: IA falhou (${e.codigo})`);
    return new Recusa(STATUS_POR_CODIGO[e.codigo] ?? 502, e.message);
  }
  return null;
}
