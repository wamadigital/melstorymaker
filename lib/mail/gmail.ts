import "server-only";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import type { MailAdapter, OpcoesEnvio } from "./adapter";

/**
 * Contingencia. Existe para o caso de o DNS do dominio recem-registrado no
 * Registro.br nao verificar no Resend dentro do prazo: MAIL_PROVIDER=gmail e o
 * envio sai pela conta da Mel, sem mudanca de codigo.
 *
 * Exige 2FA ativo na conta Google + App Password (senha normal nao autentica no
 * SMTP). Limite do Gmail: 500 envios/dia, folgado para o volume da Mel.
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
      // O Gmail sobrescreve o remetente pela conta autenticada; manter o
      // MAIL_FROM aqui preserva ao menos o nome de exibicao.
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
