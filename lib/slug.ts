/**
 * Codigo curto do link publico da proposta: melstorymaker.com.br/p/a3f9.
 *
 * O link vai por WhatsApp, entao ele e lido por gente. Quatro caracteres, por
 * decisao do owner em 19/08/2026 -- o UUID de 36 deixava a mensagem enorme.
 */
import { randomInt } from "node:crypto";

/**
 * Sem 0/o, 1/l, 5/s: o link e ditado no telefone e digitado a mao.
 *
 * Sao 29 simbolos -> 29^4 = 707.281 combinacoes. Isso e POUCO para resistir a
 * varredura: com 100 propostas geradas, um acerto a cada ~7 mil tentativas. O
 * que segura a porta e o rate limit da rota /p/[slug], nao o tamanho do
 * espaco. Aumentar TAMANHO_SLUG para 6 leva a 594 milhoes e torna a varredura
 * inviavel -- e a troca de uma constante, se o dono quiser.
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
