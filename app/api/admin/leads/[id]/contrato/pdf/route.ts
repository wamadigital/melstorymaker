import { renderizarContrato } from "@/lib/contrato/pdf";
import { validarDocumento } from "@/lib/contrato/validar";
import type { DocumentoContrato } from "@/lib/contrato/tipos";
import { lerRegistro } from "@/lib/supabase/contratos";
import { Recusa, carregarLead, recusarSeTravado, responder, rotaDoContrato } from "../_comum";
import { gravarPdfGerado } from "../_escrita";

// pdf-lib e puro JS, mas as fontes sao lidas do disco (fs): runtime Node, e
// as fontes entram no deploy pelo outputFileTracingIncludes do next.config.ts.
export const runtime = "nodejs";
// Um contrato de 6 paginas renderiza em ~100 ms; a folga e para o upload.
export const maxDuration = 60;

/** Problemas que a validacao achou no texto da IA e que ninguem assumiu ainda. */
function problemasDaIa(doc: DocumentoContrato): string[] {
  return doc.clausulas.flatMap((c, i) =>
    c.origem === "ia" ? c.problemas.map((p) => `Cláusula ${i + 1} (${c.titulo}): ${p}`) : [],
  );
}

/**
 * POST /api/admin/leads/[id]/contrato/pdf -- "Gerar PDF".
 *
 * Bloqueia (422, com a lista) se o texto nao valida ou se ha clausula da IA
 * com problema: um numero que nao existe nos dados ou um trecho que o CDC
 * anula so sai do caminho quando a Mel edita a clausula (editar e assumir o
 * texto).
 *
 * O PDF vai para o bucket PRIVADO, sobrescrevendo o rascunho anterior. O
 * sha256 e as posicoes das assinaturas ficam no registro: o envio para
 * assinatura confere que o arquivo que baixa e exatamente este.
 */
export const POST = rotaDoContrato("pdf", async (_req, id) => {
  await carregarLead(id);

  const atual = await lerRegistro(id);
  recusarSeTravado(atual?.status);
  if (!atual?.documento) throw new Recusa(409, "Gere o texto do contrato antes do PDF.");

  const documento = atual.documento;
  const campos = [...validarDocumento(documento), ...problemasDaIa(documento)];
  if (campos.length > 0) {
    throw new Recusa(422, "O texto do contrato tem problemas que impedem gerar o PDF.", { campos });
  }

  const r = await renderizarContrato(documento);

  // Texto editado em outra aba enquanto o PDF era desenhado (ou subia): este
  // PDF ja nasceu velho, e `gravarPdfGerado` responde 409 sem registra-lo.
  const registro = await gravarPdfGerado(id, documento, { bytes: r.bytes, posicoes: r.posicoes });

  const kb = Math.round(r.bytes.length / 1024);
  console.log(`[contrato] ${id} PDF gerado (${r.paginas} pág, ${kb} kB)`);
  if (r.usouFallbackDeFonte) {
    console.warn(`[contrato] ${id} PDF saiu com a fonte reserva: assets/fonts fora do deploy?`);
  }

  return responder({ registro, paginas: r.paginas, usouFallbackDeFonte: r.usouFallbackDeFonte });
});
