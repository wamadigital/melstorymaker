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
 * Mensagem do botao do painel. Texto exato da secao 14 do PRD -- o tom e da
 * Mel e nao se reescreve.
 */
export function mensagemProposta(primeiroNome: string, pdfUrl: string): string {
  return (
    `Oi, ${primeiroNome}! ✨ Preparei sua proposta com todo carinho. Dá uma olhada aqui: ${pdfUrl}\n\n` +
    `Qualquer dúvida, me chama! 🤍`
  );
}

/**
 * Link do botao "Enviar via WhatsApp".
 * Com o numero do lead abre direto na conversa dele; sem numero, abre o seletor
 * de conversas da Mel (RF-13).
 */
export function linkPropostaWhatsApp(
  whatsappLead: string | null | undefined,
  primeiroNome: string,
  pdfUrl: string,
): string {
  const texto = encodeURIComponent(mensagemProposta(primeiroNome, pdfUrl));
  const numero = normalizarNumero(whatsappLead);
  return numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

/** Conversa com a Mel: CTA da tela de confirmacao e link dentro do e-mail. */
export function linkWhatsAppMel(numeroMel: string): string {
  return `https://wa.me/${normalizarNumero(numeroMel) ?? numeroMel}`;
}
