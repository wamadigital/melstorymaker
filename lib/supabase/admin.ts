import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const BUCKET_PROPOSTAS = "propostas";

let cliente: SupabaseClient | null = null;

/**
 * UNICO caminho de acesso a tabela leads. A tabela tem RLS ligado e zero
 * policies, entao o cliente anon nao enxerga nada -- por design. Este usa a
 * service role, que atravessa RLS, e por isso jamais pode chegar ao client
 * ("server-only" quebra o build se alguem importar de um Client Component).
 *
 * Criado sob demanda para que `next build` nao precise das envs so para
 * analisar as rotas.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}

/** URL publica e estavel do PDF. Regerar sobrescreve o mesmo arquivo. */
export function urlPublicaProposta(leadId: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET_PROPOSTAS}/${leadId}.pdf`;
}
