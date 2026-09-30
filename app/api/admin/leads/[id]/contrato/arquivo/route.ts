import { nomeArquivoSeguro } from "@/lib/assinatura/adapter";
import { baixarPdf, lerRegistroInterno, type RegistroContratoInterno } from "@/lib/supabase/contratos";
import { Recusa, carregarLead, rotaDoContrato } from "../_comum";

export const runtime = "nodejs";

type Tipo = "rascunho" | "assinado" | "trilha";

const TIPOS: Record<Tipo, { caminho: (r: RegistroContratoInterno) => string | null; prefixo: string; ausente: string }> = {
  rascunho: {
    caminho: (r) => r.pdf_path,
    prefixo: "Contrato",
    ausente: "O PDF do contrato ainda não foi gerado.",
  },
  assinado: {
    caminho: (r) => r.assinado_path,
    prefixo: "Contrato assinado",
    ausente: "Ainda não há contrato assinado por todos.",
  },
  trilha: {
    caminho: (r) => r.trilha_path,
    prefixo: "Trilha de auditoria",
    ausente: "A trilha de auditoria só existe depois que todos assinam.",
  },
};

function ehTipo(v: string): v is Tipo {
  return Object.hasOwn(TIPOS, v);
}

/** RFC 5987: o que `encodeURIComponent` deixa passar e o cabecalho nao aceita. */
function codificarRfc5987(s: string): string {
  return encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `filename` em ASCII puro (navegador antigo) + `filename*` em UTF-8 (os
 * outros), para "Contrato - Ana e João.pdf" chegar com o acento em quem sabe
 * ler e sem quebrar o cabecalho em quem nao sabe.
 */
function disposicao(nome: string, modo: "inline" | "attachment"): string {
  const utf8 = nomeArquivoSeguro(nome);
  const ascii =
    utf8
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9 ._-]/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*-\s*\.pdf$/i, ".pdf")
      .trim() || "Contrato.pdf";
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${codificarRfc5987(utf8)}`;
}

/**
 * GET /api/admin/leads/[id]/contrato/arquivo?tipo=rascunho|assinado|trilha
 *
 * Unica saida dos PDFs do contrato: o bucket e privado e nao ha URL publica.
 * Mesma origem do painel, entao a previa (`PreviaProposta`) faz o fetch com o
 * cookie da sessao. `&download=1` troca o `inline` por `attachment` para o
 * botao "Baixar" funcionar tambem no Safari do iPhone.
 *
 * `Cache-Control: private, no-store`: e PII. Nem o navegador guarda.
 */
export const GET = rotaDoContrato("arquivo", async (req, id) => {
  const params = new URL(req.url).searchParams;
  const tipo = params.get("tipo") ?? "rascunho";
  if (!ehTipo(tipo)) throw new Recusa(400, "Tipo de arquivo inválido.");

  const lead = await carregarLead(id);
  const registro = await lerRegistroInterno(id);
  const caminho = registro ? TIPOS[tipo].caminho(registro) : null;
  if (!registro || !caminho) throw new Recusa(404, TIPOS[tipo].ausente);

  const bytes = await baixarPdf(caminho);
  if (!bytes) throw new Recusa(404, TIPOS[tipo].ausente);

  const homenageado = (registro.dados?.evento?.homenageado || lead.nome_display || "").trim();
  const nome = homenageado ? `${TIPOS[tipo].prefixo} - ${homenageado}` : TIPOS[tipo].prefixo;

  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": disposicao(nome, params.get("download") === "1" ? "attachment" : "inline"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
