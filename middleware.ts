import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ehAdmin, lerListaAdmins } from "@/lib/admin/acesso";

/**
 * Protege o painel. A usuaria e unica (a Mel) e foi criada no dashboard do
 * Supabase: nao existe rota de signup em lugar nenhum do projeto.
 *
 * Sessao valida nao basta: a conta tambem precisa estar em `ADMIN_EMAILS`
 * (`lib/admin/acesso.ts`). Em 14/10/2026 o cadastro publico do Supabase estava
 * aberto, e qualquer conta confirmada entraria como a Mel.
 *
 * Alem de barrar, o middleware refresca o cookie de sessao a cada request --
 * sem isso a Mel e deslogada no meio do trabalho quando o token expira.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const admins = lerListaAdmins(process.env.ADMIN_EMAILS);

  // Sem as envs o createServerClient estoura com um 500 sem contexto, e a causa
  // real (variavel faltando na Vercel) leva tempo para aparecer. Falhar aqui e
  // deliberadamente fechado: sem conseguir validar sessao, ninguem entra.
  if (!url || !anonKey) {
    console.error(
      "[middleware] NEXT_PUBLIC_SUPABASE_URL e/ou NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes. " +
        "O /admin fica inacessivel ate as variaveis serem configuradas.",
    );
    return NextResponse.json(
      { erro: "Painel indisponível: configuração de ambiente incompleta." },
      { status: 503 },
    );
  }

  // Mesma falha fechada para a lista de quem pode entrar. 503 e nao redirect
  // para o login: a Mel entraria com a senha certa e voltaria para o login sem
  // explicacao, e a causa (variavel faltando) ficaria escondida.
  if (!admins) {
    console.error(
      "[middleware] ADMIN_EMAILS ausente ou sem nenhum e-mail valido. " +
        "O /admin fica inacessivel ate a variavel ser configurada.",
    );
    return NextResponse.json(
      { erro: "Painel indisponível: configuração de ambiente incompleta." },
      { status: 503 },
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() valida o token no servidor do Supabase. getSession() so le o
  // cookie, que o proprio cliente pode ter forjado -- nao serve para autorizar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const autorizado = ehAdmin(user?.email, admins);

  // Conta valida, mas fora da lista: encerra a sessao (revoga o refresh token
  // e apaga o cookie) e segue como se nao houvesse sessao nenhuma. Sem isso a
  // tela de login a mandaria de volta para o /admin, em laco. O log leva o id,
  // nunca o e-mail: e por ele que se acha a conta em Authentication > Users.
  if (user && !autorizado) {
    console.warn(`[middleware] conta ${user.id} fora do ADMIN_EMAILS; sessao encerrada.`);
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      console.error("[middleware] falha ao encerrar a sessao recusada:", (e as Error).message);
    }
  }

  const { pathname } = request.nextUrl;
  const ehLogin = pathname === "/admin/login";
  const ehApi = pathname.startsWith("/api/admin");

  // Resposta nova perderia os cookies que o Supabase acabou de escrever (o
  // refresh do token ou a remocao do signOut acima).
  const comCookies = (destino: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => destino.cookies.set(cookie));
    return destino;
  };

  if (!autorizado && !ehLogin) {
    // API responde 401 em JSON; pagina redireciona guardando o destino.
    if (ehApi) {
      return comCookies(NextResponse.json({ erro: "Sessão expirada." }, { status: 401 }));
    }
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    if (user) login.search = "?negado=1";
    else login.search = pathname === "/admin" ? "" : `?proximo=${encodeURIComponent(pathname)}`;
    return comCookies(NextResponse.redirect(login));
  }

  if (autorizado && ehLogin) {
    const painel = request.nextUrl.clone();
    painel.pathname = "/admin";
    painel.search = "";
    return comCookies(NextResponse.redirect(painel));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
