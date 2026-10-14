"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de navegador. Existe para DUAS coisas: o login da Mel via Supabase
 * Auth e ouvir o aviso do quadro ao vivo (components/admin/useQuadroAoVivo.ts),
 * que nao traz dado nenhum. Nunca le nem escreve leads -- a tabela tem RLS sem
 * policies e este cliente usa a anon key, entao ele nao enxerga nada mesmo.
 * Dado de lead passa exclusivamente pelos route handlers.
 */
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
