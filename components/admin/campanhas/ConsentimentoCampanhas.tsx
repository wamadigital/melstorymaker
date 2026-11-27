"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { consultarCampanhas, enviarJson, erroCampanha } from "./consulta";

type Estado = {
  telefone: string;
  consentimento: { autorizado: boolean; evidencia: string; registrado_em: string } | null;
};

export function ConsentimentoCampanhas({ leadId }: { leadId: string }) {
  const [aberto, abrir] = useState(false);
  const [estado, salvarEstado] = useState<Estado | null>(null);
  const [evidencia, escrever] = useState("");
  const [ocupado, ocupar] = useState(false);
  const [erro, mostrarErro] = useState("");
  const url = `/api/admin/leads/${leadId}/consentimento-campanhas`;

  async function carregar() {
    abrir(true);
    ocupar(true);
    mostrarErro("");
    try {
      salvarEstado(await consultarCampanhas<Estado>(url));
    } catch (e) {
      mostrarErro(erroCampanha(e));
    } finally {
      ocupar(false);
    }
  }

  async function gravar(autorizado: boolean) {
    if (!estado || ocupado) return;
    ocupar(true);
    mostrarErro("");
    try {
      salvarEstado(await consultarCampanhas<Estado>(url, enviarJson("PUT", {
        telefone: estado.telefone, autorizado, evidencia,
      })));
      escrever("");
    } catch (e) {
      mostrarErro(erroCampanha(e));
    } finally {
      ocupar(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Consentimento para campanhas de WhatsApp</h2>
        <Button type="button" variant="outline" size="sm" disabled={ocupado} aria-expanded={aberto}
          onClick={() => aberto ? abrir(false) : void carregar()}>{aberto ? "Fechar" : "Gerenciar consentimento"}</Button>
      </div>
      {aberto && <>
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        {ocupado && <p className="text-sm text-muted-foreground">Aguarde…</p>}
        {estado && <>
          <p className="text-sm">+{estado.telefone} · {estado.consentimento
            ? estado.consentimento.autorizado ? "Autorizado" : "Descadastrado"
            : "Sem autorização registrada"}</p>
          {estado.consentimento && <p className="wrap-break-word text-sm text-muted-foreground">{estado.consentimento.evidencia}</p>}
          <label className="grid gap-1.5 text-sm">Origem e data da autorização ou do descadastro
            <Textarea value={evidencia} onChange={(e) => escrever(e.target.value)} rows={2} maxLength={500} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={ocupado || !evidencia.trim()} onClick={() => gravar(true)}>Registrar autorização</Button>
            <Button type="button" variant="outline" disabled={ocupado || !evidencia.trim()} onClick={() => gravar(false)}>Registrar descadastro</Button>
          </div>
        </>}
      </>}
    </section>
  );
}
