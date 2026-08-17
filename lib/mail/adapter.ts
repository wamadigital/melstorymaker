import "server-only";
import { env } from "@/lib/env";

export type Anexo = { filename: string; content: Buffer };

export type OpcoesEnvio = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Anexo[];
};

/**
 * Contrato unico de envio (PRD secao 10). Nenhuma rota fala com Resend ou
 * Nodemailer direto: a troca de provider e uma variavel de ambiente, nao um
 * refactor. Se o DNS do Resend nao verificar a tempo, MAIL_PROVIDER=gmail
 * resolve sem tocar em codigo.
 */
export interface MailAdapter {
  send(opts: OpcoesEnvio): Promise<void>;
}

/**
 * Adapter de desenvolvimento. Loga em vez de enviar.
 *
 * E o padrao local (MAIL_DRY_RUN=1) para nunca disparar e-mail de teste no
 * endereco de um lead real durante o desenvolvimento.
 */
class DryRunAdapter implements MailAdapter {
  async send(opts: OpcoesEnvio): Promise<void> {
    const anexos = (opts.attachments ?? [])
      .map((a) => `${a.filename} (${(a.content.length / 1024).toFixed(0)}kB)`)
      .join(", ");

    console.info(
      [
        "",
        "──────────── E-MAIL (MAIL_DRY_RUN=1, nada foi enviado) ────────────",
        `para:    ${opts.to}`,
        `assunto: ${opts.subject}`,
        `anexos:  ${anexos || "nenhum"}`,
        "───────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}

/**
 * Seleciona o provider. Unico ponto do sistema que decide por onde o e-mail sai.
 * Import dinamico para o provider que nao esta em uso nem ser carregado.
 */
export async function criarMailAdapter(): Promise<MailAdapter> {
  if (env.MAIL_DRY_RUN) return new DryRunAdapter();

  if (env.MAIL_PROVIDER === "gmail") {
    const { GmailAdapter } = await import("./gmail");
    return new GmailAdapter();
  }

  const { ResendAdapter } = await import("./resend");
  return new ResendAdapter();
}
