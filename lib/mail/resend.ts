import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import type { MailAdapter, OpcoesEnvio } from "./adapter";

/**
 * Provider principal. Envia pelo dominio melstorymaker.com.br verificado no
 * Resend. NAO existe caixa de e-mail nesse dominio: o Resend so precisa do
 * dominio verificado para enviar, e as respostas dos leads voltam pro Gmail
 * que a Mel ja usa, via reply-to. Custo zero.
 */
export class ResendAdapter implements MailAdapter {
  async send(opts: OpcoesEnvio): Promise<void> {
    const resend = new Resend(env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: env.MAIL_FROM,
      to: opts.to,
      replyTo: env.MAIL_REPLY_TO,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });

    if (error) {
      throw new Error(`Resend recusou o envio: ${error.name} - ${error.message}`);
    }
  }
}
