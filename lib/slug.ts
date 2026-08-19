/**
 * Codigo curto do link publico da proposta: melstorymaker.com.br/p/a3f9.
 *
 * O link vai por WhatsApp, entao ele e lido por gente. Quatro caracteres, por
 * decisao do owner em 19/08/2026 -- o UUID de 36 deixava a mensagem enorme.
 */
import { randomInt } from "node:crypto";

/**
 * Sem 0/o/O, 1/l/I e 5/S: o link e ditado no telefone e digitado a mao. Sobram
 * 30 simbolos -> 30^4 = 810 mil combinacoes, folgado para o volume da Mel.
 */
const ALFABETO = "abcdefghjkmnpqrtuvwxyz2346789";

export const TAMANHO_SLUG = 4;

/** Formato aceito na URL. Serve de guarda na rota, antes de tocar no banco. */
export const RE_SLUG = new RegExp(`^[${ALFABETO}]{${TAMANHO_SLUG}}$`);

/** randomInt e criptografico: slug sorteado com Math.random seria adivinhavel. */
export function gerarSlug(tamanho = TAMANHO_SLUG): string {
  let s = "";
  for (let i = 0; i < tamanho; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}
