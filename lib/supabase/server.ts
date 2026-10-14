import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ehAdmin, lerListaAdmins } from "@/lib/admin/acesso";

// Cliente de SESSAO do admin. Usa a anon key e existe apenas para autenticar a
// Mel (Supabase Auth). Nao le nem escreve leads -- isso e exclusividade do
// supabaseAdmin, que atravessa o RLS.
export async function criarClienteSessao() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component nao pode escrever cookie. O refresh do token
            // acontece no middleware, entao ignorar aqui e seguro.
          }
        },
      },
    },
  );
}

/**
 * Sessao da Mel, ou null. Usado pelas paginas e rotas do /admin.
 *
 * Confere `ADMIN_EMAILS` de novo, mesmo com o middleware na frente: se o
 * matcher mudar um dia, a rota nao fica aberta para qualquer conta do Auth.
 * Sem a lista, ninguem passa (falha fechada, como no middleware).
 */
export async function getSessaoAdmin() {
  const admins = lerListaAdmins(process.env.ADMIN_EMAILS);
  if (!admins) return null;
  const supabase = await criarClienteSessao();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && ehAdmin(user.email, admins) ? user : null;
}
