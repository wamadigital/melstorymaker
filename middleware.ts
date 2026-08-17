import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege o painel. A usuaria e unica (a Mel) e foi criada no dashboard do
 * Supabase: nao existe rota de signup em lugar nenhum do projeto.
 *
 * Alem de barrar, o middleware refresca o cookie de sessao a cada request --
 * sem isso a Mel e deslogada no meio do trabalho quando o token expira.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  const { pathname } = request.nextUrl;
  const ehLogin = pathname === "/admin/login";
  const ehApi = pathname.startsWith("/api/admin");

  if (!user && !ehLogin) {
    // API responde 401 em JSON; pagina redireciona guardando o destino.
    if (ehApi) {
      return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.search = pathname === "/admin" ? "" : `?proximo=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(login);
  }

  if (user && ehLogin) {
    const painel = request.nextUrl.clone();
    painel.pathname = "/admin";
    painel.search = "";
    return NextResponse.redirect(painel);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
