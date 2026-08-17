import { arvore, normalizarOpcoes, passoPorId } from "@/lib/form/engine";
import type { Categoria, Status } from "@/lib/form/types";

// Rotulos de categoria saem do proprio arvore.json: o painel e o formulario
// nunca podem divergir no nome de uma categoria.
const CATEGORIA_POR_VALOR = new Map(
  normalizarOpcoes(arvore.categoria.opcoes).map((o) => [o.valor, o.rotulo]),
);

export function rotuloCategoria(categoria: Categoria): string {
  return CATEGORIA_POR_VALOR.get(categoria) ?? categoria;
}

export const ROTULO_STATUS: Record<Status, string> = {
  incompleto: "Incompleto",
  aguardando_revisao: "Aguardando revisão",
  enviado: "Enviado",
};

/** Badge por status: cinza / destaque / verde, conforme o PRD secao 8. */
export const CLASSE_STATUS: Record<Status, string> = {
  incompleto: "bg-muted text-muted-foreground border-border",
  aguardando_revisao: "bg-primary text-primary-foreground border-transparent",
  enviado: "bg-emerald-100 text-emerald-900 border-emerald-200",
};

/**
 * "Parou em: Local da festa" para os leads incompletos (RF-09). Sem isso a Mel
 * so ve "incompleto" e nao sabe o quanto falta para o follow-up valer a pena.
 */
export function rotuloPasso(categoria: Categoria, passoId: string | null): string | null {
  if (!passoId) return null;
  return passoPorId(categoria, passoId)?.pergunta ?? null;
}

/** Pergunta correspondente a uma chave do jsonb, para rotular o campo no painel. */
export function rotuloResposta(categoria: Categoria, chave: string): string {
  return passoPorId(categoria, chave)?.pergunta ?? chave;
}
