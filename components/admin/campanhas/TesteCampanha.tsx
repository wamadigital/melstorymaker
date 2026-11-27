"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_CAMPANHAS, consultarCampanhas, enviarJson, erroCampanha } from "./consulta";
import { Selecao } from "./PartesCampanhas";

const CHAVE_TESTE_CAMPANHA = "mel.campanha.teste";

export function TesteCampanha({ nome, mensagens, ativo }: {
  nome: string; mensagens: { id: number; texto: string; numero: number }[]; ativo: boolean;
}) {
  const [telefone, mudarTelefone] = useState("");
  const [escolha, escolher] = useState<number>();
  const [ocupado, ocupar] = useState(false);
  const [erro, mostrarErro] = useState("");
  const [enviado, mostrarEnviado] = useState<string>();
  const tentativa = useRef<{ id: string; telefone: string; mensagem: string; numero: number } | null>(null);
  const enviando = useRef(false);
  const mensagem = mensagens.find((m) => m.id === escolha) ?? mensagens[0];

  async function testar() {
    if (enviando.current || !ativo || !telefone.trim() || !mensagem) return;
    enviando.current = true;
    ocupar(true);
    mostrarErro("");
    mostrarEnviado(undefined);
    try {
      if (tentativa.current?.telefone !== telefone || tentativa.current.mensagem !== mensagem.texto
        || tentativa.current.numero !== mensagem.numero) {
        let id: string | null = null;
        if (!tentativa.current) {
          try { id = sessionStorage.getItem(CHAVE_TESTE_CAMPANHA); } catch {}
        }
        tentativa.current = { id: id ?? crypto.randomUUID(), telefone, mensagem: mensagem.texto, numero: mensagem.numero };
      }
      try { sessionStorage.setItem(CHAVE_TESTE_CAMPANHA, tentativa.current.id); } catch {}
      const { id } = await consultarCampanhas<{ id: string }>(API_CAMPANHAS, enviarJson("POST", {
        acao: "teste", nome, ...tentativa.current,
      }));
      tentativa.current = null;
      try { sessionStorage.removeItem(CHAVE_TESTE_CAMPANHA); } catch {}
      mostrarEnviado(id);
    } catch (e) {
      mostrarErro(erroCampanha(e));
    } finally {
      enviando.current = false;
      ocupar(false);
    }
  }

  return (
    <form className="w-full space-y-2 rounded-md border bg-card p-3 lg:w-auto lg:max-w-lg" onSubmit={(e) => { e.preventDefault(); void testar(); }}
      aria-label="Envio de teste">
      <label htmlFor="campanha-teste-telefone" className="text-sm font-medium">Teste · celular</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id="campanha-teste-telefone" type="tel" inputMode="tel" autoComplete="off" placeholder="5519988763916"
          value={telefone} onChange={(e) => mudarTelefone(e.target.value)} maxLength={24}
          className="h-9 min-w-36 flex-1 lg:w-40 lg:flex-none" />
        {mensagens.length > 1 && (
          <Selecao value={mensagem?.id} onChange={(e) => escolher(Number(e.target.value))}
            aria-label="Mensagem do teste" className="w-auto max-w-full">
            {mensagens.map(({ id, numero }) => <option key={id} value={id}>Mensagem {numero}</option>)}
          </Selecao>
        )}
        <Button type="submit" size="lg" variant="outline" disabled={ocupado || !ativo || !telefone.trim() || !mensagem}>
          <Send /> {ocupado ? "Colocando na fila…" : "Enviar teste"}
        </Button>
      </div>
      {!mensagem && <p className="text-xs text-muted-foreground">Preencha uma mensagem para testar.</p>}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      {enviado && <p role="status" className="text-sm">
        Teste na fila.{" "}
        <Link href={`/campanhas?id=${enviado}`} target="_blank" rel="noopener" className="underline">Acompanhar teste</Link>
      </p>}
    </form>
  );
}
