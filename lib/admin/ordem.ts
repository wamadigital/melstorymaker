import type { Lead } from "@/lib/form/types";

/**
 * Ordem dos cartoes dentro de TODA raia do quadro: pela chegada do lead
 * (`created_at`, a data que o cartao mostra), do mais novo em cima para o mais
 * antigo embaixo. Pedido do owner em 07/10/2026, "sempre": nenhuma coluna
 * reordena por cobranca vencida.
 *
 * E a mesma ordem da consulta (`app/admin/(painel)/page.tsx`); o quadro a
 * refaz no cliente so para o cartao movido no otimismo cair no lugar certo.
 * Comparacao pelo instante (`Date.parse`), nao pela string: o Postgres pode
 * devolver precisoes diferentes de fracao de segundo.
 */
export function maisNovoPrimeiro(a: Pick<Lead, "created_at">, b: Pick<Lead, "created_at">): number {
  return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
}
