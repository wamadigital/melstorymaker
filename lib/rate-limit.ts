import "server-only";

/**
 * Rate limit best-effort por IP, em memoria.
 *
 * Limitacao assumida e aceita: cada instancia serverless tem o proprio Map, e
 * instancias frias comecam zeradas. Um atacante determinado passa. O objetivo
 * aqui e so conter script bobo e clique repetido sem custar R$ 0,01 de infra
 * (o alvo do projeto e R$ 0/mes). Se um dia isso virar problema de verdade, a
 * troca e por um store compartilhado -- nao por um limite menor.
 */

type Janela = { contador: number; expiraEm: number };

const janelas = new Map<string, Janela>();
const LIMPEZA_A_CADA = 500;
let operacoes = 0;

function limparExpiradas(agora: number) {
  for (const [chave, janela] of janelas) {
    if (janela.expiraEm <= agora) janelas.delete(chave);
  }
}

export function ipDaRequisicao(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "desconhecido";
}

/** Retorna true quando a requisicao deve ser BLOQUEADA. */
export function excedeuLimite(chave: string, limite: number, janelaMs: number): boolean {
  const agora = Date.now();

  if (++operacoes % LIMPEZA_A_CADA === 0) limparExpiradas(agora);

  const atual = janelas.get(chave);
  if (!atual || atual.expiraEm <= agora) {
    janelas.set(chave, { contador: 1, expiraEm: agora + janelaMs });
    return false;
  }

  atual.contador += 1;
  return atual.contador > limite;
}

/** Limites das rotas publicas. O autosave dispara a cada passo, entao e o mais folgado. */
export const LIMITES = {
  criarLead: { limite: 10, janelaMs: 60_000 },
  autosave: { limite: 120, janelaMs: 60_000 },
  submit: { limite: 10, janelaMs: 60_000 },
  /**
   * Leitura da proposta pelo link curto. O slug tem 4 caracteres (707 mil
   * combinacoes), entao SEM limite a rota e um oraculo varrivel: 200 no acerto,
   * 404 no erro, e a proposta de um desconhecido sai em minutos. 30/min cobre
   * folgadamente o uso real (o lead abre o link e talvez recarregue) e derruba
   * a varredura de horas para meses.
   */
  proposta: { limite: 30, janelaMs: 60_000 },
} as const;
