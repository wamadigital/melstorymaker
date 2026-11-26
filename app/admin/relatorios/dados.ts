import "server-only";
import { z } from "zod";
import { STATUS } from "@/lib/form/types";

const contagem = z.number().int().nonnegative();
const mes = z.object({
  leads: contagem,
  propostas: contagem,
  status: z.record(z.enum(STATUS), contagem),
}).refine(({ leads, propostas, status }) =>
  propostas <= leads && Object.values(status).reduce((total, valor) => total + valor, 0) === leads,
);

const recorte = z.object({
  meses: z.array(mes).length(11),
  outubro: z.object({
    entradas: z.array(z.object({ dias: z.string(), total: contagem })).length(5),
    tiposDeEvento: z.array(z.object({ nome: z.string(), total: contagem })).min(1),
  }),
});

export function lerRelatorioComercial() {
  const valor = process.env.MEL_RELATORIO_MENSAL_2026;
  if (!valor) throw new Error("Recorte do relatório comercial indisponível.");
  try {
    return recorte.parse(JSON.parse(valor));
  } catch {
    throw new Error("Recorte do relatório comercial inválido.");
  }
}
