"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de navegador. Existe para UMA coisa so: o login da Mel via Supabase
 * Auth. Nunca le nem escreve leads -- a tabela tem RLS sem policies e este
 * cliente usa a anon key, entao ele nao enxerga nada mesmo. Dado de lead passa
 * exclusivamente pelos route handlers.
 */
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
