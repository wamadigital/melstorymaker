"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizarOpcoes, passosVisiveis } from "@/lib/form/engine";
import type { Lead, Respostas, Status } from "@/lib/form/types";
import { sujeitoDoEvento } from "@/lib/leads";
import { CLASSE_STATUS, ROTULO_STATUS, rotuloCategoria } from "@/lib/admin/rotulos";
import { dataHoraLocal } from "@/lib/pdf/formatadores";
import { linkPropostaWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type Aviso = { tom: "erro" | "ok" | "atencao"; texto: string };

export function DetalheLead({ lead }: { lead: Lead }) {
  const router = useRouter();

  const [respostas, setRespostas] = useState<Respostas>(lead.respostas ?? {});
  const [status, setStatus] = useState<Status>(lead.status);
  const [pdfUrl, setPdfUrl] = useState(lead.pdf_url);
  const [pdfGeradoEm, setPdfGeradoEm] = useState(lead.pdf_gerado_em);
  const [enviadoEm, setEnviadoEm] = useState(lead.enviado_em);
  const [rotuloArte, setRotuloArte] = useState<string | null>(null);
  // Qual tabela de preco a arte gerada carrega. Sai do ano do EVENTO, entao
  // pode nao ser o ano corrente -- por isso vai visivel, e nao suposto.
  const [tabelaPreco, setTabelaPreco] = useState<string | null>(null);

  const [acao, setAcao] = useState<null | "salvar" | "gerar" | "enviar" | "excluir">(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const passos = passosVisiveis(lead.categoria, respostas);
  const email = respostas.contato_email ?? lead.email ?? "";
  const whatsapp = respostas.contato_whatsapp ?? lead.whatsapp ?? "";
  const sujeito = sujeitoDoEvento(lead.categoria, respostas) || lead.nome_display || "";
  const contato = respostas.nome ?? "";

  // Cache-bust: sem isso o iframe mostra o PDF antigo depois de regerar, porque
  // a URL do Storage e sempre a mesma (de proposito, para o link do WhatsApp).
  const urlPreview = pdfUrl ? `${pdfUrl}?v=${encodeURIComponent(pdfGeradoEm ?? "")}` : null;

  async function salvar() {
    setAcao("salvar");
    setAviso(null);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respostas }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.erro ?? "Falha ao salvar.");

      setRespostas(json.respostas);
      setAviso({ tom: "ok", texto: "Respostas salvas." });
      router.refresh();
    } catch (e) {
      setAviso({ tom: "erro", texto: (e as Error).message });
    } finally {
      setAcao(null);
    }
  }

  async function gerar() {
    setAcao("gerar");
    setAviso(null);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}/gerar-pdf`, { method: "POST" });
      const json = await r.json();

      // 422 = falta resposta. Listar os campos pelo nome da pergunta é o que
      // transforma "deu erro" em "preencha isto aqui e tente de novo".
      if (r.status === 422 && Array.isArray(json.campos)) {
        setAviso({
          tom: "atencao",
          texto: `Não dá pra gerar ainda. Preencha e salve: ${json.campos.join(", ")}.`,
        });
        return;
      }
      if (!r.ok) throw new Error(json.erro ?? "Falha ao gerar.");

      setPdfUrl(json.pdf_url);
      setPdfGeradoEm(json.pdf_gerado_em);
      setRotuloArte(json.rotuloTemplate ?? null);
      setTabelaPreco(json.tabelaPreco ?? null);

      // A Mel precisa saber quando o preview NAO representa a arte final.
      const ressalvas = [
        json.usouPlaceholder && "a arte real do Figma ainda não está no repo",
        json.usouFallbackDeFonte && "as fontes da marca ainda não estão no repo",
      ].filter(Boolean);

      // Em aniversario a arte depende da idade respondida: dizer qual saiu
      // deixa a Mel corrigir antes de enviar, em vez de descobrir depois. Vale
      // o mesmo para a tabela de preco, que depende do ano do evento.
      const arte = json.rotuloTemplate
        ? `Arte: ${json.rotuloTemplate}${json.tabelaPreco ? `, preços de ${json.tabelaPreco}` : ""}.`
        : "";

      setAviso(
        ressalvas.length
          ? { tom: "atencao", texto: `Proposta gerada. ${arte} Mas ${ressalvas.join(" e ")}.` }
          : { tom: "ok", texto: `Proposta gerada. ${arte}` },
      );
      router.refresh();
    } catch (e) {
      setAviso({ tom: "erro", texto: (e as Error).message });
    } finally {
      setAcao(null);
    }
  }

  async function enviar() {
    setAcao("enviar");
    setAviso(null);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}/enviar`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.erro ?? "Falha ao enviar.");

      setStatus("enviado");
      setEnviadoEm(json.enviado_em);
      setAviso({
        tom: json.dryRun ? "atencao" : "ok",
        texto: json.dryRun
          ? "MAIL_DRY_RUN está ligado: o e-mail foi apenas registrado no log, não enviado."
          : `E-mail enviado para ${email}${json.comAnexo ? " com o PDF em anexo" : " (só com o link, PDF grande demais para anexo)"}.`,
      });
      router.refresh();
    } catch (e) {
      setAviso({ tom: "erro", texto: (e as Error).message });
    } finally {
      setAcao(null);
    }
  }

  async function excluir() {
    // window.confirm de proposito, igual a lista: exclusao e irreversivel e nao
    // ha lixeira nem backup no plano gratuito.
    const certeza = window.confirm(
      `Excluir o lead ${sujeito || "sem nome"}?\n\nIsso apaga também a proposta em PDF. Não dá para desfazer.`,
    );
    if (!certeza) return;

    setAcao("excluir");
    setAviso(null);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}`, { method: "DELETE" });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.erro ?? "Não consegui excluir.");

      // Toast, e nao o banner desta tela: a pagina deixa de existir, entao so o
      // toast sobrevive a navegacao e aparece ja na lista.
      toast.success(`Lead ${sujeito || ""} excluído.`);
      router.push("/admin");
      router.refresh();
      // acao continua "excluir" de proposito: trava o botao ate a navegacao
      // sair, senao um duplo clique dispara um segundo DELETE.
    } catch (e) {
      setAviso({ tom: "erro", texto: (e as Error).message });
      setAcao(null);
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        {/* gap-y menor que o gap-x: em 360px o botao quebra para a linha de
            baixo, e com gap-3 nos dois eixos ele ficava solto no meio do
            cabecalho, separando o titulo da linha de metadados. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold">{sujeito || "Sem nome"}</h1>
          <span
            className={cn(
              "rounded-md border px-2.5 py-0.5 text-xs font-medium",
              CLASSE_STATUS[status],
            )}
          >
            {ROTULO_STATUS[status]}
          </span>

          {/* ml-auto, nao justify-between: com flex-wrap em 360px o
              justify-between afastaria o badge do titulo na quebra de linha. */}
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={excluir}
            disabled={acao !== null}
          >
            {acao === "excluir" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 size-4" />
            )}
            Excluir lead
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {rotuloCategoria(lead.categoria)} · recebido em {dataHoraLocal(lead.created_at)}
          {contato && <> · preenchido por {contato}</>}
        </p>
      </header>

      {aviso && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            aviso.tom === "erro" && "border-destructive/30 bg-destructive/5 text-destructive",
            aviso.tom === "atencao" && "border-amber-300 bg-amber-50 text-amber-900",
            aviso.tom === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900",
          )}
        >
          {aviso.tom !== "ok" && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
          {aviso.texto}
        </p>
      )}

      {/* ---------------------------------------------------------- respostas */}
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-medium">Respostas</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {passos.map((passo) => {
            const opcoes = normalizarOpcoes(passo.opcoes);
            const valor = respostas[passo.id] ?? "";
            const atualizar = (v: string) => setRespostas((r) => ({ ...r, [passo.id]: v }));

            return (
              <div key={passo.id} className="space-y-1.5">
                <Label htmlFor={passo.id} className="text-xs text-muted-foreground">
                  {passo.pergunta}
                </Label>

                {passo.tipo === "escolha_unica" ? (
                  <select
                    id={passo.id}
                    value={valor}
                    onChange={(e) => atualizar(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {opcoes.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={passo.id}
                    type={
                      passo.tipo === "data"
                        ? "date"
                        : passo.tipo === "hora"
                          ? "time"
                          : passo.tipo === "email"
                            ? "email"
                            : "text"
                    }
                    value={valor}
                    onChange={(e) => atualizar(e.target.value)}
                    className="h-9"
                  />
                )}
              </div>
            );
          })}
        </div>

        <Button onClick={salvar} disabled={acao !== null} size="sm">
          {acao === "salvar" ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Salvar respostas
        </Button>
      </section>

      {/* ------------------------------------------------------------ acoes */}
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-medium">Proposta</h2>

        <div className="flex flex-wrap gap-2">
          <Button onClick={gerar} disabled={acao !== null}>
            {acao === "gerar" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <FileText className="mr-1.5 size-4" />
            )}
            {pdfUrl ? "Regerar proposta" : "Gerar proposta"}
          </Button>

          <Button
            variant="outline"
            onClick={enviar}
            // Habilitado so com PDF gerado e e-mail no cadastro (PRD secao 8).
            disabled={acao !== null || !pdfUrl || !email}
            title={!pdfUrl ? "Gere a proposta primeiro" : !email ? "Esse lead não deixou e-mail" : undefined}
          >
            {acao === "enviar" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Mail className="mr-1.5 size-4" />
            )}
            Enviar por e-mail
          </Button>

          {pdfUrl && (
            <>
              <a
                href={linkPropostaWhatsApp(whatsapp, pdfUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                <MessageCircle className="mr-1.5 size-4" />
                Enviar via WhatsApp
              </a>

              <a
                href={urlPreview ?? pdfUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                <Download className="mr-1.5 size-4" />
                Baixar PDF
              </a>
            </>
          )}
        </div>

        <dl className="grid gap-1 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <dt>E-mail do lead:</dt>
            <dd className="text-foreground">{email || "não informado"}</dd>
          </div>
          <div className="flex gap-2">
            <dt>WhatsApp do lead:</dt>
            <dd className="text-foreground">{whatsapp || "não informado"}</dd>
          </div>
          {rotuloArte && (
            <div className="flex gap-2">
              <dt>Arte usada:</dt>
              <dd className="text-foreground">{rotuloArte}</dd>
            </div>
          )}
          {tabelaPreco && (
            <div className="flex gap-2">
              <dt>Tabela de preços:</dt>
              <dd className="text-foreground">{tabelaPreco}</dd>
            </div>
          )}
          {pdfGeradoEm && (
            <div className="flex gap-2">
              <dt>Proposta gerada em:</dt>
              <dd className="text-foreground">{dataHoraLocal(pdfGeradoEm)}</dd>
            </div>
          )}
          {enviadoEm && (
            <div className="flex gap-2">
              <dt>Enviada em:</dt>
              <dd className="text-foreground">{dataHoraLocal(enviadoEm)}</dd>
            </div>
          )}
        </dl>

        {urlPreview && (
          <iframe
            key={urlPreview}
            src={urlPreview}
            title="Prévia da proposta"
            className="h-[70vh] w-full rounded-lg border bg-muted"
          />
        )}
      </section>
    </div>
  );
}
