"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarClienteNavegador } from "@/lib/supabase/client";

export function LoginClient() {
  const router = useRouter();
  const proximo = useSearchParams().get("proximo") ?? "/admin";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      // Mensagem generica de proposito: nao confirma se o e-mail existe.
      setErro("E-mail ou senha incorretos.");
      setOcupado(false);
      return;
    }

    // refresh() faz o middleware rodar de novo ja com o cookie de sessao.
    router.replace(proximo);
    router.refresh();
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-5">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold">Painel da Mel</h1>
          <p className="text-sm text-muted-foreground">Entre para ver as propostas.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <Input
            id="senha"
            type="password"
            required
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="h-11"
          />
        </div>

        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}

        <Button type="submit" disabled={ocupado} className="h-11 w-full">
          {ocupado && <Loader2 className="mr-2 size-4 animate-spin" />}
          Entrar
        </Button>
      </form>
    </div>
  );
}
