import "server-only";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import type { MailAdapter, OpcoesEnvio } from "./adapter";

/**
 * Unico provider de envio. Nodemailer sobre o SMTP do Gmail da Mel.
 *
 * Exige 2FA ativo na conta Google + App Password (a senha normal nao autentica
 * no SMTP). Em conta Workspace, o admin do dominio tambem precisa permitir
 * App Passwords.
 *
 * Limite: 2.000 destinatarios/dia numa conta Workspace -- muito acima do
 * volume da Mel, que manda algumas propostas por semana.
 */
export class GmailAdapter implements MailAdapter {
  async send(opts: OpcoesEnvio): Promise<void> {
    const transporte = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    });

    await transporte.sendMail({
      // O Google REESCREVE o endereco pela conta autenticada. Manter o
      // MAIL_FROM preserva o nome de exibicao, que e o que a maioria dos leads
      // ve na caixa de entrada -- por isso o endereco em MAIL_FROM deve ser o
      // mesmo de GMAIL_USER, para os dois nao se contradizerem.
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
  }
}
