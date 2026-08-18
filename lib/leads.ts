// Funcoes puras sobre o lead. Sem "server-only": o painel usa estes helpers no
// client para montar o link do WhatsApp, e nao ha segredo aqui.
import { somenteDigitos } from "@/lib/form/validacao";
import type { Categoria, Lead, Respostas } from "@/lib/form/types";

/**
 * Quem preenche o formulario e quem o evento homenageia sao pessoas diferentes:
 * a cerimonialista preenche o casamento, a mae preenche os 15 anos da filha.
 *
 * `nome` e SEMPRE quem preencheu. O sujeito do evento mora numa chave propria
 * por categoria -- as mesmas variaveis usadas na arte do Figma.
 */
export const CHAVE_SUJEITO: Record<Categoria, string> = {
  debutante: "debutante",
  aniversario: "aniversariante",
  casamento: "noivos",
  corporativo: "empresa",
};

/** Nome de quem preencheu o formulario. E quem recebe e le o e-mail. */
export function nomeContato(respostas: Respostas): string {
  return (respostas.nome ?? "").trim();
}

/** Sujeito do evento: a debutante, o aniversariante, os noivos ou a empresa. */
export function sujeitoDoEvento(categoria: Categoria, respostas: Respostas): string {
  return (respostas[CHAVE_SUJEITO[categoria]] ?? "").trim();
}

/**
 * Colunas promovidas: espelham chaves do jsonb em colunas reais para a lista do
 * admin ser rapida sem parse de jsonb. Atualizadas no autosave, junto com as
 * respostas -- nunca depois, senao a lista mostra dado velho.
 *
 * `nome_display` guarda o SUJEITO DO EVENTO: e assim que a Mel identifica um
 * lead na lista ("casamento da Ana & João"), nao pelo nome de quem digitou.
 */
export function colunasPromovidas(categoria: Categoria, respostas: Respostas) {
  const email = respostas.contato_email?.trim().toLowerCase();
  const whatsapp = somenteDigitos(respostas.contato_whatsapp ?? "");

  return {
    nome_display: sujeitoDoEvento(categoria, respostas) || null,
    // Ja vem em ISO do <input type="date">; a coluna e `date`.
    data_evento: respostas.data || null,
    email: email || null,
    whatsapp: whatsapp || null,
  };
}

/** Sujeito do evento a partir do lead salvo, com a coluna promovida como atalho. */
export function nomeDisplay(lead: Pick<Lead, "categoria" | "nome_display" | "respostas">): string {
  return (lead.nome_display ?? sujeitoDoEvento(lead.categoria, lead.respostas ?? {})).trim();
}

/**
 * Primeira palavra do nome de QUEM PREENCHEU. Usado no "Oi, {primeiro_nome}!"
 * da mensagem de WhatsApp -- que e dirigida a pessoa que vai ler, nao ao casal.
 */
export function primeiroNome(lead: Pick<Lead, "respostas">): string {
  return (nomeContato(lead.respostas ?? {}).split(/\s+/)[0] ?? "").trim();
}

/** Corporativo tem copy de e-mail propria; as outras tres compartilham a pessoal. */
export function ehCorporativo(categoria: Categoria): boolean {
  return categoria === "corporativo";
}
