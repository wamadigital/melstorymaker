import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cortesDeEsfriar } from "@/lib/admin/esfriar";

/**
 * Move para "Esfriou" todo lead de "Enviado" que ja ficou uma semana parado
 * depois do prazo da cobranca. A regra e `deveEsfriar` (`lib/admin/esfriar.ts`),
 * aqui como UM UPDATE condicional: idempotente, sem ler antes, e o filtro
 * `status = enviado` faz a corrida com um arraste da Mel acabar certa -- o
 * PATCH de status tambem filtra pelo status que leu, e o perdedor recebe 409.
 *
 * Roda em dois lugares: ao abrir o quadro (`app/admin/(painel)/page.tsx`), para
 * a Mel sempre ver o quadro em dia, e no cron diario (`/api/cron/manter-ativo`),
 * para o banco ficar certo mesmo sem ninguem abrir o painel.
 *
 * Nunca lanca: falhar aqui nao pode derrubar o quadro nem o cron. Sem
 * retentativa, por ser escrita (ver `lerComRetentativa`). Devolve os ids que
 * esfriaram.
 *
 * O `.env.local` aponta para o banco de PRODUCAO: abrir o `/admin` local ja
 * move os leads de verdade.
 */
export async function esfriarParados(agoraMs: number): Promise<string[]> {
  const { enviadoAte, paradoDesde } = cortesDeEsfriar(agoraMs);
  try {
    const { data, error } = await supabaseAdmin()
      .from("leads")
      .update({ status: "esfriou" })
      .eq("status", "enviado")
      .lte("enviado_em", enviadoAte)
      .lte("updated_at", paradoDesde)
      .select("id");

    if (error) {
      console.error("[esfriar] falha ao mover leads parados", error.message);
      return [];
    }
    const ids = (data ?? []).map((l) => l.id as string);
    if (ids.length) console.log(`[esfriar] ${ids.length} lead(s) de Enviado para Esfriou: ${ids.join(", ")}`);
    return ids;
  } catch (e) {
    console.error("[esfriar] falha ao mover leads parados", (e as Error)?.message ?? e);
    return [];
  }
}
