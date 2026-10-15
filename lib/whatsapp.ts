// Links de contato/proposta. Os lembretes do Kanban usam a fila MCP privada.

import type { Categoria } from "@/lib/form/types";
import { sequenciaLembreteProposta } from "@/lib/whatsapp-automacao/lembretes-proposta";

/**
 * Normaliza o numero para o formato do wa.me (DDI + DDD + numero, so digitos).
 * O banco guarda o que o lead digitou, sem DDI; numero com 55 na frente nao
 * pode ganhar outro 55.
 */
export function normalizarNumero(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (!digitos) return null;

  // 10 ou 11 digitos = numero brasileiro sem DDI.
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  // 12 ou 13 digitos comecando com 55 ja esta completo.
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;

  return digitos;
}

/**
 * Mensagem do botao do painel. Copy definida pelo owner em 20/08/2026,
 * substituindo a versao sem emoji de 19/08 -- que por sua vez substituiu a da
 * secao 14 do PRD.
 *
 * Sem saudacao pelo nome, de proposito: a Mel manda isso dentro de uma conversa
 * que ja existe, entao "Oi, Fulana!" soava como mensagem automatica.
 *
 * O link fica em linha propria e cercado de quebras: o WhatsApp so gera a previa
 * do link quando ele nao esta grudado em outra palavra.
 */
export function mensagemProposta(pdfUrl: string): string {
  return [
    "Segue a sua proposta 👇🏼",
    "",
    pdfUrl,
    "",
    "Qualquer dúvida, é só me chamar. Ok?",
    "Fico à disposição para te ajudar no que precisar! ✨",
  ].join("\n");
}

/**
 * Link do botao "Enviar via WhatsApp".
 * Com o numero do lead abre direto na conversa dele; sem numero, abre o seletor
 * de conversas da Mel (RF-13).
 */
export function linkPropostaWhatsApp(
  whatsappLead: string | null | undefined,
  pdfUrl: string,
): string {
  const texto = encodeURIComponent(mensagemProposta(pdfUrl));
  const numero = normalizarNumero(whatsappLead);
  return numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

/**
 * Conversa com um lead, SEM texto pre-escrito.
 *
 * Botao "Chamar no WhatsApp" do lead que parou no meio do formulario. Aqui a
 * caixa vai vazia de proposito -- decisao do owner em 22/09/2026 --, ao
 * contrario das outras portas de WhatsApp deste projeto, que levam mensagem
 * pronta. A diferenca: aquelas sao repetiveis (a mesma proposta, a mesma
 * cobranca de 7 dias), esta nao. Cada pessoa parou num ponto diferente por um
 * motivo diferente, e quem sabe o que dizer e a Mel.
 *
 * Devolve `null` sem numero: o botao some. Um wa.me sem destinatario abriria o
 * seletor de conversas da propria Mel, que nao e chamar ninguem.
 */
export function linkConversaLead(whatsappLead: string | null | undefined): string | null {
  const numero = normalizarNumero(whatsappLead);
  return numero ? `https://wa.me/${numero}` : null;
}

/** Prévia textual; o MCP usa as partes e pausas de sequenciaLembreteProposta. */
export function mensagemLembrete(marco: 7 | 30, pdfUrl: string | null): string {
  return sequenciaLembreteProposta(marco, pdfUrl ?? "").map((p) => p.message).join("\n\n");
}

/**
 * Compatibilidade de links antigos. O botão do Kanban não usa este helper.
 */
export function linkLembreteWhatsApp(
  marco: 7 | 30,
  whatsappLead: string | null | undefined,
  pdfUrl: string | null,
): string {
  const texto = encodeURIComponent(mensagemLembrete(marco, pdfUrl));
  const numero = normalizarNumero(whatsappLead);
  return numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

/** Conversa com a Mel: CTA da tela de confirmacao e link dentro do e-mail. */
export function linkWhatsAppMel(numeroMel: string): string {
  return `https://wa.me/${normalizarNumero(numeroMel) ?? numeroMel}`;
}

/**
 * Primeira mensagem por categoria, quando a abertura ja sabe qual e o evento.
 * So entra aqui categoria que tem pagina propria apontando para o formulario:
 * as outras continuam no texto generico.
 */
const PRIMEIRO_CONTATO_POR_CATEGORIA: Partial<Record<Categoria, string>> = {
  casamento: "Oi, Mel! Vim pelo site e queria falar sobre o meu casamento ✨",
};

/**
 * Primeira mensagem do lead que escolhe "Falar com a Mel" na abertura do
 * formulario, em vez de responder as perguntas.
 *
 * Vai pre-escrita de proposito: o link abre a conversa com a caixa de texto
 * vazia, e escrever a primeira frase para um numero desconhecido e justamente
 * onde a pessoa desiste. Com o texto pronto, sobra apertar enviar.
 *
 * Curta e na voz do lead -- e ele quem "diz" isto. Nada de dado pessoal aqui:
 * o texto fica visivel na URL, que o navegador do WhatsApp guarda no historico.
 * A categoria nao e dado pessoal: e o que a propria URL de entrada ja diz.
 *
 * Excecao por categoria, aprovada pelo owner em 01/10/2026: a landing page do
 * casamento (`/casamento`) manda para `/formulario?evento=casamento`, e quem
 * chega por ali ja disse que o evento e um casamento -- "o meu evento" seria a
 * Mel recebendo menos do que a pessoa ja contou. Sem categoria, ou com uma que
 * nao tem texto proprio, sai a frase generica de sempre.
 */
export function mensagemPrimeiroContato(categoria?: Categoria): string {
  return (
    (categoria && PRIMEIRO_CONTATO_POR_CATEGORIA[categoria]) ??
    "Oi, Mel! Vim pelo site e queria falar sobre o meu evento ✨"
  );
}

/**
 * Link da porta "Falar com a Mel" (tela de abertura do formulario). Abre a
 * conversa com a Mel ja com a primeira mensagem escrita.
 */
export function linkPrimeiroContato(numeroMel: string, categoria?: Categoria): string {
  return `${linkWhatsAppMel(numeroMel)}?text=${encodeURIComponent(mensagemPrimeiroContato(categoria))}`;
}
