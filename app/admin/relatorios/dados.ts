import "server-only";
import { z } from "zod";

const contagem = z.number().int().nonnegative();
const percentual = contagem.max(100);
const recorte = z.object({
  outubro: z.object({
    propostas: contagem,
    entradas: z.array(z.object({ dias: z.string(), total: contagem })).length(5),
    tiposDeEvento: z.array(z.object({ nome: z.string(), total: contagem })).min(1),
  }),
  demonstracao: z.object({
    respostaManual: z.object({ minima: percentual, maxima: percentual }),
    respostaComAutomacao: percentual,
    contratos: contagem,
  }),
});

export function lerRelatorioComercial() {
  const valor = process.env.MEL_RELATORIO_COMERCIAL;
  if (!valor) throw new Error("Recorte do relatório comercial indisponível.");
  try {
    return recorte.parse(JSON.parse(valor));
  } catch {
    throw new Error("Recorte do relatório comercial inválido.");
  }
}
