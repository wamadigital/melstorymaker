import "server-only";
import { z } from "zod";

const contagem = z.number().int().nonnegative();
const recorte = z.object({
  outubro: z.object({
    propostas: contagem,
    entradas: z.array(z.object({ dias: z.string(), total: contagem })).length(5),
    tiposDeEvento: z.array(z.object({ nome: z.string(), total: contagem })).min(1),
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

const recorteAula = z.object({
  mesesReais: z.array(z.object({ leads: contagem.positive(), propostas: contagem })).length(2),
  clientes: z.array(z.object({ cliente: z.string().min(1), mes: z.union([z.literal(10), z.literal(11)]) })).min(1),
});

export function lerRecorteAula() {
  const valor = process.env.MEL_RELATORIO_AULA;
  if (!valor) throw new Error("Dados da aula indisponíveis.");
  try {
    return recorteAula.parse(JSON.parse(valor));
  } catch {
    throw new Error("Dados da aula inválidos.");
  }
}
