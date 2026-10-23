import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

const linhasEncerradas = z.array(z.object({ id: z.string().uuid() }));
const ERRO_ENCERRAMENTO = "Não consegui encerrar os leads com evento passado.";

export type ResultadoEncerramento = { ids: string[]; erro: string | null };

/**
 * O banco calcula o dia em São Paulo e faz a transição condicional em uma
 * única transação. A RPC não recebe datas nem ids vindos do navegador.
 * Sem retentativa de escrita: uma falha de rede não confirma o resultado.
 */
export async function encerrarEventosPassados(db?: SupabaseClient): Promise<ResultadoEncerramento> {
  try {
    const { data, error } = await (db ?? supabaseAdmin())
      .rpc("encerrar_eventos_passados")
      .abortSignal(AbortSignal.timeout(5_000))
      .retry(false);
    if (error) return { ids: [], erro: ERRO_ENCERRAMENTO };
    const linhas = linhasEncerradas.safeParse(data);
    if (!linhas.success) return { ids: [], erro: ERRO_ENCERRAMENTO };
    return { ids: [...new Set(linhas.data.map((linha) => linha.id))], erro: null };
  } catch {
    // Mensagens do PostgREST e exceções podem conter dados do lead ou da
    // configuração. Só a falha operacional pública atravessa este limite.
    return { ids: [], erro: ERRO_ENCERRAMENTO };
  }
}
