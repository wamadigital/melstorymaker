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
 * Contrato unico de envio (PRD secao 10). Nenhuma rota fala com o Nodemailer
 * direto: todo e-mail sai por aqui, e por isso a trava do MAIL_DRY_RUN nao tem
 * como ser contornada por engano.
 *
 * O envio e feito pelo Gmail da Mel. O volume nao justifica um servico
 * transacional pago: a conta Workspace entrega 2.000 destinatarios/dia, muito
 * acima do que a Mel manda.
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
 * Unico ponto do sistema que decide por onde o e-mail sai.
 *
 * A interface `MailAdapter` continua existindo mesmo com um provider so: e ela
 * que mantem o DryRunAdapter como troca de uma linha e permitiria plugar outro
 * servico sem tocar em nenhuma rota.
 */
export async function criarMailAdapter(): Promise<MailAdapter> {
  if (env.MAIL_DRY_RUN) return new DryRunAdapter();

  const { GmailAdapter } = await import("./gmail");
  return new GmailAdapter();
}
