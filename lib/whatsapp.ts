// Links wa.me. Nenhuma API de WhatsApp entra neste projeto: o botao do painel
// so abre a conversa no aparelho da Mel, com a mensagem pronta.

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
 * Cobranca de quem recebeu a proposta e nao respondeu.
 *
 * COPY PROVISORIA, escrita por mim -- a do owner entra por cima. Duas regras
 * que valem em qualquer versao:
 *
 *   1. O link da proposta VOLTA na mensagem. Faz 7 (ou 30) dias que ela foi
 *      enviada; obrigar a pessoa a procurar a conversa antiga e perder o lead
 *      de novo pelo mesmo motivo. Sem proposta gerada, a mensagem sai sem link.
 *   2. Aos 30 dias a saida e honrosa. E a ultima mensagem: cobrar de novo com
 *      o tom dos 7 dias soa a insistencia, e a Mel trabalha de indicacao.
 *
 * Mesma diagramacao da `mensagemProposta`: o link sozinho na linha, cercado de
 * quebras, e o que faz o WhatsApp gerar a previa.
 */
export function mensagemLembrete(marco: 7 | 30, pdfUrl: string | null): string {
  const linhas =
    marco === 7
      ? [
          "Oi! Passando pra saber se você conseguiu dar uma olhada na proposta 😊",
          ...(pdfUrl ? ["", pdfUrl, ""] : [""]),
          "Se ficou alguma dúvida, me chama que eu te explico com calma. ✨",
        ]
      : [
          "Oi! Faz um tempinho que te mandei a proposta e fiquei sem retorno por aqui.",
          ...(pdfUrl ? ["", pdfUrl, ""] : [""]),
          "Se ainda fizer sentido, é só me chamar que a gente conversa.",
          "E se não for o momento, sem problema nenhum — fico por aqui pra quando você quiser! ✨",
        ];
  return linhas.join("\n");
}

/**
 * Link do botao de cobranca no cartao do quadro. Sem numero do lead abre o
 * seletor de conversas da Mel, mesmo comportamento do botao da proposta.
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
 * Primeira mensagem do lead que escolhe "Falar com a Mel" na abertura do
 * formulario, em vez de responder as perguntas.
 *
 * Vai pre-escrita de proposito: o link abre a conversa com a caixa de texto
 * vazia, e escrever a primeira frase para um numero desconhecido e justamente
 * onde a pessoa desiste. Com o texto pronto, sobra apertar enviar.
 *
 * Curta e na voz do lead -- e ele quem "diz" isto. Nada de dado pessoal aqui:
 * o texto fica visivel na URL, que o navegador do WhatsApp guarda no historico.
 */
export function mensagemPrimeiroContato(): string {
  return "Oi, Mel! Vim pelo site e queria falar sobre o meu evento ✨";
}

/**
 * Link da porta "Falar com a Mel" (tela de abertura do formulario). Abre a
 * conversa com a Mel ja com a primeira mensagem escrita.
 */
export function linkPrimeiroContato(numeroMel: string): string {
  return `${linkWhatsAppMel(numeroMel)}?text=${encodeURIComponent(mensagemPrimeiroContato())}`;
}
