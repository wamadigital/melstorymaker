import type { Status } from "@/lib/form/types";
import type { StatusContrato } from "@/lib/contrato/tipos";
import { validarTelefoneBr } from "@/lib/form/validacao";
import { linkConversaLead } from "@/lib/whatsapp";

/** A confirmação informa todos os arquivos que a exclusão leva junto. */
export function textoExclusao(
  sujeito: string,
  statusContrato: StatusContrato | null,
  contratoDesconhecido: boolean,
): string {
  const cabeca = `Excluir o lead ${sujeito || "sem nome"}?`;
  const fim = "Não dá para desfazer.";
  if (contratoDesconhecido) {
    // O quadro não lê contratos por cartão. Não assumir ausência quando o
    // estado não veio: a exclusão também alcança um contrato já assinado.
    return `${cabeca}\n\nIsso apaga também a proposta em PDF e o contrato deste lead, se houver, inclusive um CONTRATO ASSINADO e sua trilha de auditoria, e cancela um envio para assinatura ainda aberto. Se precisar guardar, baixe as cópias antes.\n\n${fim}`;
  }
  if (statusContrato === "assinado") {
    return `${cabeca}\n\nIsso apaga também a proposta em PDF e o CONTRATO ASSINADO, com a trilha de auditoria. Se precisar guardar, baixe as cópias antes.\n\n${fim}`;
  }
  if (statusContrato === "enviado") {
    return `${cabeca}\n\nIsso apaga também a proposta em PDF e o contrato, e cancela o envio para assinatura (os links que as pessoas receberam deixam de valer).\n\n${fim}`;
  }
  if (statusContrato) {
    return `${cabeca}\n\nIsso apaga também a proposta em PDF e o contrato (dados, texto e PDF).\n\n${fim}`;
  }
  return `${cabeca}\n\nIsso apaga também a proposta em PDF. ${fim}`;
}

/** Contato inicial só em Novo e com um destinatário válido, sem texto pronto. */
export function linkContatoInicial(status: Status, whatsapp: string | null | undefined): string | null {
  if (status !== "incompleto" || !whatsapp || validarTelefoneBr(whatsapp)) return null;
  return linkConversaLead(whatsapp);
}

/** Um dry run bem sucedido continua sendo uma simulação, não uma entrega. */
export function avisoPropostaEnviada(nome: string, dryRun: boolean) {
  return dryRun
    ? { tipo: "warning" as const, texto: "MAIL_DRY_RUN está ligado: o e-mail foi apenas registrado no log, não enviado." }
    : { tipo: "success" as const, texto: `Proposta enviada para ${nome || "o lead"}.` };
}
