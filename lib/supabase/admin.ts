import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { gerarSlug } from "@/lib/slug";

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

/**
 * URL publica e estavel do PDF, no dominio da Mel: /p/a3f9.
 *
 * Curta de proposito -- a Mel manda isso por WhatsApp e o UUID deixava o link
 * com 36 caracteres. A rota /p/[slug] resolve o slug no banco e devolve o
 * arquivo do Storage; o endereco do Supabase nunca aparece.
 *
 * Regerar sobrescreve o mesmo objeto no bucket e mantem o slug, entao a URL
 * nao muda (RF-14).
 */
export function urlPublicaProposta(slug: string): string {
  return `${env.APP_URL.replace(/\/+$/, "")}/p/${slug}`;
}

/**
 * Garante um slug para o lead, devolvendo o que ja existe quando houver.
 *
 * O sorteio pode colidir -- sao 707 mil combinacoes, mas colisao com
 * probabilidade baixa ainda acontece. Em vez de conferir antes (que abriria
 * corrida entre duas geracoes simultaneas), grava e deixa o UNIQUE do Postgres
 * decidir: violacao 23505 e sinal para sortear de novo, nao erro.
 */
export async function garantirSlug(leadId: string): Promise<string> {
  const db = supabaseAdmin();

  const { data: atual } = await db.from("leads").select("slug").eq("id", leadId).maybeSingle();
  if (atual?.slug) return atual.slug;

  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const slug = gerarSlug();
    const { error } = await db.from("leads").update({ slug }).eq("id", leadId).is("slug", null);

    if (!error) {
      // O update com `is("slug", null)` pode nao ter pego a linha se outra
      // geracao simultanea preencheu antes. Reler resolve quem venceu.
      const { data } = await db.from("leads").select("slug").eq("id", leadId).maybeSingle();
      if (data?.slug) return data.slug;
      continue;
    }
    // 23505 = unique_violation: o slug sorteado ja e de outro lead.
    if (error.code !== "23505") throw new Error(`Não consegui gerar o link: ${error.message}`);
  }

  throw new Error("Não consegui gerar um link curto único depois de 8 tentativas.");
}
