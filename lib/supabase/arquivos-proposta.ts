import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { arquivoProposta } from "@/lib/pdf/arquivo";
import { BUCKET_PROPOSTAS } from "./admin";

/** Exclusão solicitada pela Mel remove também versões automáticas e uploads interrompidos. */
export async function removerPropostasDoLead(db: SupabaseClient, id: string): Promise<void> {
  const bucket = db.storage.from(BUCKET_PROPOSTAS);
  const { error } = await bucket.remove([arquivoProposta(id)]);
  if (error) throw new Error("remover_proposta");
  const pasta = `automaticas/${id}`;
  // Remove lotes do começo: depois de apagar, não há offset a avançar.
  for (;;) {
    const { data, error: listagem } = await bucket.list(pasta, { limit: 100 });
    if (listagem) throw new Error("listar_propostas_automaticas");
    if (!data?.length) return;
    const caminhos = data.map(item => arquivoProposta(id, `${pasta}/${item.name}`));
    const { error: remocao } = await bucket.remove(caminhos);
    if (remocao) throw new Error("remover_propostas_automaticas");
  }
}
