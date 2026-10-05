// Retomada do formulario. Sem "server-only": o formulario le a chave no
// navegador, e a pagina de passagem do lembrete por e-mail a grava.

/**
 * Onde o formulario guarda, no navegador do lead, o id do lead em andamento.
 * E por ela que reabrir a pagina continua de onde parou (RF-04).
 *
 * `/continuar/[id]` -- o link do lembrete por e-mail -- grava ESTA chave no
 * navegador de quem abriu o e-mail. Se as duas pontas divergirem, o link do
 * e-mail passa a abrir o formulario do zero, em silencio: `retomada.test.ts`
 * confere que o formulario usa a mesma.
 */
export const CHAVE_LEAD = "mel:lead_id";

/** Caminho do link do lembrete por e-mail. A pagina mora em `app/continuar/[id]`. */
export function caminhoContinuar(leadId: string): string {
  return `/continuar/${leadId}`;
}
