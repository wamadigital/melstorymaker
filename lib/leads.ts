// Funcoes puras sobre o lead. Sem "server-only": o painel usa nomeDisplay e
// primeiroNome no client para montar o link do WhatsApp, e nao ha segredo aqui.
import { somenteDigitos } from "@/lib/form/validacao";
import type { Categoria, Lead, Respostas } from "@/lib/form/types";

/**
 * Colunas promovidas: espelham chaves do jsonb em colunas reais para a lista do
 * admin ser rapida sem parse de jsonb. Atualizadas no autosave, junto com as
 * respostas -- nunca depois, senao a lista mostra dado velho.
 */
export function colunasPromovidas(respostas: Respostas) {
  const nome = respostas.nome?.trim();
  const email = respostas.contato_email?.trim().toLowerCase();
  const whatsapp = somenteDigitos(respostas.contato_whatsapp ?? "");

  return {
    nome_display: nome || null,
    // Ja vem em ISO do <input type="date">; a coluna e `date`.
    data_evento: respostas.data || null,
    email: email || null,
    whatsapp: whatsapp || null,
  };
}

/**
 * Nome que aparece nas copies. Regra do PRD secao 14: debutante,
 * aniversariante, noivos ou empresa, conforme o campo `nome` do fluxo.
 */
export function nomeDisplay(lead: Pick<Lead, "nome_display" | "respostas">): string {
  return (lead.nome_display ?? lead.respostas?.nome ?? "").trim();
}

/**
 * Primeira palavra do nome. Em casamento ("Ana & Joao") isso da o primeiro nome
 * do casal, exatamente como o PRD pede.
 */
export function primeiroNome(lead: Pick<Lead, "nome_display" | "respostas">): string {
  return nomeDisplay(lead).split(/\s+/)[0] ?? "";
}

/** Corporativo tem copy de e-mail propria; as outras tres compartilham a pessoal. */
export function ehCorporativo(categoria: Categoria): boolean {
  return categoria === "corporativo";
}
