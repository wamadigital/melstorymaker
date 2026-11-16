import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Move para "Esfriou" todo lead de "Enviado" que ja ficou uma semana parado
 * depois da proposta. A RPC registra o marco exato dos sete dias na mesma
 * operação que muda a coluna, mesmo se só rodar depois do vencimento.
 *
 * Roda em dois lugares: ao abrir o quadro (`app/admin/(painel)/page.tsx`), para
 * a Mel sempre ver o quadro em dia, e no cron diário (`/api/cron/manter-ativo`).
 * O agendador de lembretes do worker também usa a mesma regra no banco.
 *
 * Nunca lanca: falhar aqui nao pode derrubar o quadro nem o cron. Sem
 * retentativa, por ser escrita (ver `lerComRetentativa`). Devolve os ids que
 * esfriaram.
 *
 * O `.env.local` aponta para o banco de PRODUCAO: abrir o `/admin` local ja
 * move os leads de verdade.
 */
export async function esfriarParados(agoraMs: number): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .rpc("esfriar_leads_parados_whatsapp", { p_agora: new Date(agoraMs).toISOString() })
      .abortSignal(AbortSignal.timeout(5_000));

    if (error) {
      console.error("[esfriar] falha ao mover leads parados", error.message);
      return [];
    }
    const ids = ((data ?? []) as { id: string }[]).map((l) => l.id);
    if (ids.length) console.log(`[esfriar] ${ids.length} lead(s) de Enviado para Esfriou: ${ids.join(", ")}`);
    return ids;
  } catch (e) {
    console.error("[esfriar] falha ao mover leads parados", (e as Error)?.message ?? e);
    return [];
  }
}
