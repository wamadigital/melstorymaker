import type { Categoria } from "@/lib/form/types";

/**
 * Copies da secao 14 do PRD, ao pe da letra. O tom e da Mel: nao reescrever.
 *
 * Excecao: o lembrete de quem parou no formulario (`montarEmailLembrete`, no
 * fim do arquivo) nao esta no PRD. A copy dele e provisoria.
 */

export type DadosEmail = {
  /** Quem preencheu o formulario. E quem recebe e le este e-mail. */
  nomeContato: string;
  /** Sujeito do evento. Usado so na copy corporativa ("interesse da {empresa}"). */
  nomeDisplay: string;
  pdfUrl: string;
  linkWhatsAppMel: string;
  /** false quando o PDF passou do limite de anexo e vai so o link. */
  comAnexo: boolean;
};

export type EmailPronto = { subject: string; html: string; text: string };

/** O nome vem do que o lead digitou: sem escape, vira injecao de HTML no e-mail. */
function escapar(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Envelope HTML. Estilo inline e tabela unica porque cliente de e-mail nao
 * entende folha de estilo externa nem grid.
 */
function envelope(corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#fdfbf7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfbf7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;font-family:Georgia,'Times New Roman',serif;color:#3a2e2a;font-size:16px;line-height:1.65;">
        ${corpo}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function paragrafo(html: string): string {
  return `<tr><td style="padding-bottom:18px;">${html}</td></tr>`;
}

function link(url: string, rotulo?: string): string {
  return `<a href="${escapar(url)}" style="color:#8a6a45;">${escapar(rotulo ?? url)}</a>`;
}

/** Categorias pessoais: debutante, aniversario e casamento. */
function emailPessoal(d: DadosEmail): EmailPronto {
  // Cumprimenta QUEM PREENCHEU, nao o sujeito do evento: quem abre este e-mail
  // pode ser a cerimonialista ou a mae da debutante, e dirigir a mensagem aos
  // noivos soaria como e-mail de robo que nao sabe com quem esta falando.
  const nome = d.nomeContato || "tudo bem";

  const fraseProposta = d.comAnexo
    ? `Sua proposta personalizada está em anexo (e também nesse link, se preferir: ${d.pdfUrl}).`
    : // Fallback do PRD secao 16: acima do limite de anexo, vai so o link. A
      // frase muda o minimo necessario para nao prometer um anexo que nao existe.
      `Sua proposta personalizada está nesse link: ${d.pdfUrl}`;

  const text = [
    `Oi, ${nome}!`,
    "",
    "Que alegria saber que você quer eternizar esse momento 🤍",
    "",
    fraseProposta,
    "",
    `Dá uma olhada com carinho e, se pintar qualquer dúvida, é só me chamar no WhatsApp: ${d.linkWhatsAppMel}`,
    "",
    "Mal posso esperar pra contar essa história com você!",
    "",
    "Com carinho,",
    "Mel Simão | Storymaker",
  ].join("\n");

  const html = envelope(
    [
      paragrafo(`Oi, <strong>${escapar(nome)}</strong>!`),
      paragrafo("Que alegria saber que você quer eternizar esse momento 🤍"),
      paragrafo(
        d.comAnexo
          ? `Sua proposta personalizada está em anexo (e também ${link(d.pdfUrl, "nesse link")}, se preferir).`
          : `Sua proposta personalizada está ${link(d.pdfUrl, "nesse link")}.`,
      ),
      paragrafo(
        `Dá uma olhada com carinho e, se pintar qualquer dúvida, é só me chamar no ${link(d.linkWhatsAppMel, "WhatsApp")}.`,
      ),
      paragrafo("Mal posso esperar pra contar essa história com você!"),
      paragrafo(`Com carinho,<br><strong>Mel Simão | Storymaker</strong>`),
    ].join(""),
  );

  return {
    subject: `Sua proposta chegou, ${nome} ✨ | Mel Simão Storymaker`,
    html,
    text,
  };
}

function emailCorporativo(d: DadosEmail): EmailPronto {
  const empresa = d.nomeDisplay || "sua empresa";

  const fraseProposta = d.comAnexo
    ? `A proposta de cobertura do evento está em anexo (e nesse link: ${d.pdfUrl}).`
    : `A proposta de cobertura do evento está nesse link: ${d.pdfUrl}`;

  const text = [
    "Olá!",
    "",
    `Obrigada pelo interesse da ${empresa} 🤍`,
    "",
    fraseProposta,
    "",
    `Fico à disposição pra alinhar qualquer detalhe pelo WhatsApp: ${d.linkWhatsAppMel}`,
    "",
    "Até já,",
    "Mel Simão | Storymaker",
  ].join("\n");

  const html = envelope(
    [
      paragrafo("Olá!"),
      paragrafo(`Obrigada pelo interesse da <strong>${escapar(empresa)}</strong> 🤍`),
      paragrafo(
        d.comAnexo
          ? `A proposta de cobertura do evento está em anexo (e ${link(d.pdfUrl, "nesse link")}).`
          : `A proposta de cobertura do evento está ${link(d.pdfUrl, "nesse link")}.`,
      ),
      paragrafo(
        `Fico à disposição pra alinhar qualquer detalhe pelo ${link(d.linkWhatsAppMel, "WhatsApp")}.`,
      ),
      paragrafo(`Até já,<br><strong>Mel Simão | Storymaker</strong>`),
    ].join(""),
  );

  return {
    subject: "Proposta de cobertura ✨ | Mel Simão Storymaker",
    html,
    text,
  };
}

export function montarEmail(categoria: Categoria, dados: DadosEmail): EmailPronto {
  return categoria === "corporativo" ? emailCorporativo(dados) : emailPessoal(dados);
}

// ------------------------------------------------- lembrete de quem parou

/**
 * E-mail do botao "Lembrar por e-mail", no cartao de quem parou no meio do
 * formulario (coluna "Novo").
 *
 * COPY PROVISORIA, escrita por mim em 05/10/2026 -- nao esta na secao 14 do
 * PRD, e a do owner entra por cima. Tres regras que valem em qualquer versao:
 *
 *   1. O link e o de CONTINUAR (`/continuar/{id}`), nunca o formulario cru. O
 *      lead abre o e-mail em outro navegador, e o formulario recomecaria do
 *      zero; com as respostas salvas, fazer a pessoa digitar tudo de novo e
 *      perder o lead pelo mesmo motivo duas vezes.
 *   2. O WhatsApp da Mel vai junto. Quem parou porque nao queria responder
 *      pergunta nenhuma precisa de outra porta -- a logica das duas portas da
 *      abertura (regra 5b).
 *   3. Sem pixel de abertura e sem parametro de rastreio no link (regra 8): o
 *      HTML nao tem <img> nenhuma.
 */
export type DadosLembrete = {
  /** Primeiro nome de quem preencheu (`primeiroNome`), ou vazio. */
  primeiroNome: string;
  /** Sujeito do evento. So a copy corporativa usa ("orçamento para a {empresa}"). */
  nomeDisplay: string;
  linkContinuar: string;
  linkWhatsAppMel: string;
};

const ASSUNTO_LEMBRETE = "Seu orçamento está te esperando";

/** Debutante, aniversario e casamento: mesma voz do e-mail da proposta. */
function lembretePessoal(d: DadosLembrete): EmailPronto {
  const nome = d.primeiroNome;

  const text = [
    nome ? `Oi, ${nome}!` : "Oi!",
    "",
    "Vi que você começou a pedir seu orçamento comigo, mas ele não chegou até mim 🤍",
    "",
    `Suas respostas ficaram guardadas. É só continuar de onde parou: ${d.linkContinuar}`,
    "",
    `Se preferir, me chama no WhatsApp que a gente conversa por lá: ${d.linkWhatsAppMel}`,
    "",
    "Com carinho,",
    "Mel Simão | Storymaker",
  ].join("\n");

  const html = envelope(
    [
      paragrafo(nome ? `Oi, <strong>${escapar(nome)}</strong>!` : "Oi!"),
      paragrafo("Vi que você começou a pedir seu orçamento comigo, mas ele não chegou até mim 🤍"),
      paragrafo(
        `Suas respostas ficaram guardadas. É só ${link(d.linkContinuar, "continuar de onde parou")}.`,
      ),
      paragrafo(
        `Se preferir, me chama no ${link(d.linkWhatsAppMel, "WhatsApp")} que a gente conversa por lá.`,
      ),
      paragrafo(`Com carinho,<br><strong>Mel Simão | Storymaker</strong>`),
    ].join(""),
  );

  return {
    subject: `${ASSUNTO_LEMBRETE}${nome ? `, ${nome}` : ""} ✨ | Mel Simão Storymaker`,
    html,
    text,
  };
}

/** Corporativo: "Olá!" e "Até já", como a copy corporativa da proposta. */
function lembreteCorporativo(d: DadosLembrete): EmailPronto {
  const empresa = d.nomeDisplay;

  const text = [
    "Olá!",
    "",
    `Vi que você começou a pedir um orçamento${empresa ? ` para a ${empresa}` : ""}, mas ele não chegou até mim 🤍`,
    "",
    `As respostas ficaram guardadas. É só continuar de onde parou: ${d.linkContinuar}`,
    "",
    `Se preferir, fico à disposição pra alinhar tudo pelo WhatsApp: ${d.linkWhatsAppMel}`,
    "",
    "Até já,",
    "Mel Simão | Storymaker",
  ].join("\n");

  const html = envelope(
    [
      paragrafo("Olá!"),
      paragrafo(
        `Vi que você começou a pedir um orçamento${empresa ? ` para a <strong>${escapar(empresa)}</strong>` : ""}, mas ele não chegou até mim 🤍`,
      ),
      paragrafo(
        `As respostas ficaram guardadas. É só ${link(d.linkContinuar, "continuar de onde parou")}.`,
      ),
      paragrafo(
        `Se preferir, fico à disposição pra alinhar tudo pelo ${link(d.linkWhatsAppMel, "WhatsApp")}.`,
      ),
      paragrafo(`Até já,<br><strong>Mel Simão | Storymaker</strong>`),
    ].join(""),
  );

  return {
    subject: `${ASSUNTO_LEMBRETE} ✨ | Mel Simão Storymaker`,
    html,
    text,
  };
}

export function montarEmailLembrete(categoria: Categoria, dados: DadosLembrete): EmailPronto {
  return categoria === "corporativo" ? lembreteCorporativo(dados) : lembretePessoal(dados);
}

/** Nome do anexo que chega na caixa do lead. */
export const NOME_ANEXO = "Proposta - Mel Simão.pdf";

/**
 * Acima disso o anexo e cortado e vai so o link (mitigacao do PRD secao 16).
 * Provedores costumam recusar mensagem acima de ~10MB ja com o overhead do
 * base64, que infla o binario em cerca de 33%.
 */
export const LIMITE_ANEXO_BYTES = 8 * 1024 * 1024;
