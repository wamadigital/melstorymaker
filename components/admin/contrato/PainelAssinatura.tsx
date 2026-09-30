"use client";

// Assinatura eletronica: enviar, acompanhar, cancelar e, no fim, baixar o
// contrato assinado com a trilha de auditoria.
//
// Envio so por clique explicito da Mel, e com uma confirmacao que MOSTRA para
// quem vai o link (nome e e-mail de cada parte): um e-mail digitado errado so
// apareceria como "nunca assinou" dias depois. Confirmacao inline, e nao
// window.confirm, porque a lista de signatarios nao cabe num alerta.
//
// O "Confirmar envio" respeita o mesmo bloqueio do botao que abre a
// confirmacao (`motivoSemEnvio`), e a confirmacao FECHA quando um bloqueio
// aparece: a Mel pode abrir a confirmacao, ver o e-mail errado e corrigi-lo no
// formulario sem salvar -- a lista aberta continuaria mostrando o e-mail
// antigo, e habilitada.

import { useEffect, useRef, useState } from "react";
import { Ban, Download, FileCheck, Handshake, Loader2, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentoContrato, PapelAssinatura, RegistroContrato } from "@/lib/contrato/tipos";
import { ROTULO_STATUS_SIGNATARIO } from "@/lib/contrato/regras";
import { validarEmail } from "@/lib/contrato/documento";
import type { Status } from "@/lib/form/types";
import { dataHoraLocal } from "@/lib/pdf/formatadores";
import { cn } from "@/lib/utils";
import { CLASSE_LINK_BOTAO, Recado } from "@/components/admin/contrato/campos-ui";
import { avisoDoUltimoEnvio, motivoSemEnvio } from "@/components/admin/contrato/estado";

const ROTULO_PAPEL: Record<PapelAssinatura, string> = {
  contratante: "CONTRATANTE",
  contratada: "CONTRATADA",
  anuente: "ANUENTE",
};

const CLASSE_SIGNATARIO: Record<"pendente" | "assinou" | "recusou", string> = {
  pendente: "bg-slate-100 text-slate-700 border-slate-200",
  assinou: "bg-emerald-100 text-emerald-900 border-emerald-200",
  recusou: "bg-destructive/10 text-destructive border-destructive/30",
};

export type AcaoAssinatura = "enviar" | "consultar" | "cancelar" | "mover";

export function PainelAssinatura({
  registro,
  documento,
  urlArquivo,
  statusLead,
  assinaturaConfigurada,
  assinaturaDryRun,
  bloqueioEnvio,
  acao,
  ocupado,
  onEnviar,
  onConsultar,
  onCancelar,
  onMoverLead,
}: {
  registro: RegistroContrato;
  documento: DocumentoContrato | null;
  /** `/api/admin/leads/{id}/contrato/arquivo` -- sem o `?tipo=`. */
  urlArquivo: string;
  statusLead: Status;
  assinaturaConfigurada: boolean;
  assinaturaDryRun: boolean;
  /** Motivo para NAO enviar agora (texto desatualizado, dados nao salvos...), ou null. */
  bloqueioEnvio: string | null;
  acao: AcaoAssinatura | null;
  ocupado: boolean;
  onEnviar: () => Promise<boolean>;
  onConsultar: () => void;
  onCancelar: () => void;
  onMoverLead: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const confirmacaoRef = useRef<HTMLDivElement>(null);
  const status = registro.status;

  const assinantes = status === "pdf_gerado" ? (documento?.assinaturas ?? []) : [];
  const motivo =
    status === "pdf_gerado"
      ? motivoSemEnvio({
          assinaturaConfigurada,
          bloqueioEnvio,
          rotulosComEmailInvalido: assinantes.filter((a) => !validarEmail(a.email)).map((a) => a.rotulo),
        })
      : null;

  // Bloqueio apareceu com a confirmacao aberta: fecha (ajuste durante a
  // renderizacao, sem efeito). O botao inicial volta, desabilitado e com o
  // motivo embaixo.
  if (confirmando && (motivo !== null || status !== "pdf_gerado")) setConfirmando(false);
  const aberta = confirmando && motivo === null && status === "pdf_gerado";

  // A confirmacao abre abaixo do botao; no celular, abaixo da dobra.
  useEffect(() => {
    if (aberta) confirmacaoRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [aberta]);

  // ------------------------------------------------------------ assinado
  if (status === "assinado") {
    return (
      <div className="space-y-3">
        <Recado tom="ok">
          <p>
            Assinado por todas as partes
            {registro.assinado_em ? ` em ${dataHoraLocal(registro.assinado_em)}` : ""}. O PDF assinado fica
            guardado e não muda mais.
          </p>
        </Recado>
        <div className="flex flex-wrap gap-2">
          <a
            href={`${urlArquivo}?tipo=assinado`}
            download
            target="_blank"
            rel="noopener noreferrer"
            className={CLASSE_LINK_BOTAO}
          >
            <FileCheck className="mr-1.5 size-4" />
            Baixar contrato assinado
          </a>
          <a
            href={`${urlArquivo}?tipo=trilha`}
            download
            target="_blank"
            rel="noopener noreferrer"
            className={CLASSE_LINK_BOTAO}
          >
            <Download className="mr-1.5 size-4" />
            Baixar trilha de auditoria
          </a>
        </div>
        <Signatarios registro={registro} />
        {statusLead !== "virou_cliente" && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-sm">Contrato fechado: quer mover o lead para “Virou cliente” no quadro?</p>
            <Button type="button" size="lg" onClick={onMoverLead} disabled={ocupado}>
              {acao === "mover" ? <Loader2 className="animate-spin" /> : <Handshake />}
              Mover lead para Virou cliente
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- enviado
  if (status === "enviado") {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Enviado para assinatura
          {registro.assinatura_enviada_em ? ` em ${dataHoraLocal(registro.assinatura_enviada_em)}` : ""}. Cada
          pessoa recebe o link por e-mail; o contrato fecha quando todas assinarem.
        </p>
        {registro.assinatura_provedor === "dry-run" && (
          <Recado tom="atencao">
            Envio de teste (ASSINATURA_DRY_RUN): ninguém recebeu e-mail de verdade.
          </Recado>
        )}
        <Signatarios registro={registro} />
        {registro.assinatura_atualizada_em && (
          <p className="text-xs text-muted-foreground">
            Status conferido em {dataHoraLocal(registro.assinatura_atualizada_em)}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="lg" onClick={onConsultar} disabled={ocupado}>
            {acao === "consultar" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Atualizar status
          </Button>
          <Button type="button" variant="destructive" size="lg" onClick={onCancelar} disabled={ocupado}>
            {acao === "cancelar" ? <Loader2 className="animate-spin" /> : <Ban />}
            Cancelar envio
          </Button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------- pdf_gerado
  if (status !== "pdf_gerado") {
    return <p className="text-sm text-muted-foreground">Gere o PDF para poder enviar para assinatura.</p>;
  }

  const ultimo = avisoDoUltimoEnvio(registro.assinatura_status);

  async function confirmar() {
    if (motivo !== null) return;
    const ok = await onEnviar();
    if (ok) setConfirmando(false);
  }

  return (
    <div className="space-y-3">
      {/* Cancelado (quase sempre pela propria Mel) e so registro, em cinza;
          recusado e expirado pedem acao, em ambar. */}
      {ultimo?.tom === "info" && <p className="text-xs text-muted-foreground">{ultimo.texto}</p>}
      {ultimo?.tom === "atencao" && <Recado tom="atencao">{ultimo.texto}</Recado>}
      {assinaturaDryRun && assinaturaConfigurada && (
        <Recado tom="atencao">ASSINATURA_DRY_RUN ligado: nada será enviado de verdade.</Recado>
      )}

      {!aberta ? (
        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            onClick={() => setConfirmando(true)}
            disabled={ocupado || motivo !== null}
          >
            <Send />
            Enviar para assinatura
          </Button>
          {motivo && <p className="text-xs text-muted-foreground">{motivo}</p>}
        </div>
      ) : (
        <div ref={confirmacaoRef} className="scroll-my-6 space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Confirme para quem vai o link de assinatura:</p>
          <ul className="space-y-2">
            {assinantes.map((a) => (
              <li key={a.papel} className="text-sm">
                <span className="text-xs font-medium text-muted-foreground">{a.rotulo}</span>
                <p className="wrap-anywhere">
                  {a.nome} · <span className="font-medium">{a.email}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Depois de enviado, o texto fica travado até todos assinarem ou você cancelar o envio.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" onClick={confirmar} disabled={ocupado || motivo !== null}>
              {acao === "enviar" ? <Loader2 className="animate-spin" /> : <Send />}
              Confirmar envio
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setConfirmando(false)}
              disabled={ocupado}
            >
              <X />
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Signatarios({ registro }: { registro: RegistroContrato }) {
  const lista = registro.assinatura_signatarios ?? [];
  if (lista.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border">
      {lista.map((s, i) => (
        <li key={`${s.email}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
          {/* min-w: com pouco espaco o selo desce, em vez de espremer o nome. */}
          <div className="min-w-[10rem] flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              {s.papel ? ROTULO_PAPEL[s.papel] : "Signatário"}
            </p>
            <p className="text-sm wrap-anywhere">{s.nome || s.email}</p>
            {s.nome && <p className="text-xs text-muted-foreground wrap-anywhere">{s.email}</p>}
            {s.assinadoEm && (
              <p className="text-xs text-muted-foreground">Assinou em {dataHoraLocal(s.assinadoEm)}.</p>
            )}
          </div>
          <span
            className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", CLASSE_SIGNATARIO[s.status])}
          >
            {ROTULO_STATUS_SIGNATARIO[s.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
