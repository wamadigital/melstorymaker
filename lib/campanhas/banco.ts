import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const BUCKET_CAMPANHAS = "campanhas-whatsapp";

export async function rpcCampanhas<T>(funcao: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(funcao, args);
  if (error) throw new Error(funcao, { cause: error.code });
  return data as T;
}
