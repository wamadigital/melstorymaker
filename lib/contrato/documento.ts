// CPF, CNPJ, e-mail e CEP: limpar, validar e formatar.
//
// Sem "server-only" e sem importar de lib/form: o painel valida no blur do
// campo com estas mesmas funcoes, e o servidor recusa a montagem com elas.
// `somenteDigitos` existe tambem em lib/form/validacao.ts, mas importar de la
// puxaria o engine e o arvore.json para o bundle do painel -- e e uma linha.
//
// Nada aqui loga nada: CPF e dado pessoal (ver "Dados e segurança" no CLAUDE.md).

export function somenteDigitos(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Pontuacao que se aceita dentro de um documento digitado ou colado. */
const PONTUACAO_DOCUMENTO = /[\s.\-/]/g;

/** CPF como fica guardado: so os 11 digitos. */
export function limparCpf(s: string): string {
  return somenteDigitos(s);
}

/**
 * CNPJ como fica guardado: 14 caracteres, maiusculos, sem pontuacao.
 *
 * Nao e `somenteDigitos` de proposito. Desde julho de 2026 a Receita emite
 * CNPJ ALFANUMERICO para inscricoes novas (IN RFB 2.229/2024): as 12 primeiras
 * posicoes podem ter letras, so os dois digitos verificadores seguem numericos.
 * Um evento corporativo de empresa aberta este ano chega com CNPJ assim, e
 * jogar as letras fora transformaria um CNPJ valido em lixo.
 */
export function limparCnpj(s: string): string {
  return (s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function digitoCpf(digitos: number[], pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) soma += digitos[i] * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/**
 * CPF valido pelo digito verificador.
 *
 * Aceita com ou sem pontuacao ("000.000.000-00"). Recusa os 11 digitos iguais
 * ("111.111.111-11" passa na conta, mas nao e CPF de ninguem) e recusa texto
 * com letra no meio -- "limpar" um "CPF 123abc" ate ele passar seria validar
 * outra coisa que nao o que a Mel colou.
 */
export function validarCpf(s: string): boolean {
  const bruto = (s ?? "").trim();
  if (/[^\d.\-/\s]/.test(bruto)) return false;

  const d = somenteDigitos(bruto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  const n = d.split("").map(Number);
  const dv1 = digitoCpf(n.slice(0, 9), 10);
  const dv2 = digitoCpf(n.slice(0, 10), 11);
  return dv1 === n[9] && dv2 === n[10];
}

/** Valor de cada posicao no calculo do CNPJ: codigo ASCII menos 48 ("0"->0, "A"->17). */
function valorPosicaoCnpj(ch: string): number {
  return ch.charCodeAt(0) - 48;
}

function digitoCnpj(base: string): number {
  // Pesos de 2 a 9, da direita para a esquerda, recomecando no 2.
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += valorPosicaoCnpj(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CNPJ valido pelo digito verificador, numerico ou alfanumerico.
 *
 * O calculo e o mesmo nos dois formatos (a Receita so trocou o valor de cada
 * posicao pelo codigo ASCII menos 48, o que deixa os digitos iguais a antes).
 */
export function validarCnpj(s: string): boolean {
  const bruto = (s ?? "").trim().toUpperCase();
  if (/[^0-9A-Z.\-/\s]/.test(bruto)) return false;

  const c = bruto.replace(PONTUACAO_DOCUMENTO, "");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;

  const dv1 = digitoCnpj(c.slice(0, 12));
  const dv2 = digitoCnpj(c.slice(0, 12) + String(dv1));
  return c.slice(12) === `${dv1}${dv2}`;
}

/** "00000000000" -> "000.000.000-00". Fora do tamanho, devolve o que veio (aparado). */
export function formatarCpf(s: string): string {
  const d = somenteDigitos(s);
  if (d.length !== 11) return (s ?? "").trim();
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** "53925833000120" -> "53.925.833/0001-20" (tambem alfanumerico). */
export function formatarCnpj(s: string): string {
  const c = limparCnpj(s);
  if (c.length !== 14) return (s ?? "").trim();
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/**
 * Mascara progressiva do CPF, para o campo do painel (000.000.000-00).
 * Corta no 11º digito, como `mascararTelefone` do formulario.
 */
export function mascararCpf(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Mascara progressiva do CNPJ (00.000.000/0000-00), aceitando letras nas 12 primeiras posicoes. */
export function mascararCnpj(v: string): string {
  const c = limparCnpj(v).slice(0, 14);
  if (c.length <= 2) return c;
  if (c.length <= 5) return `${c.slice(0, 2)}.${c.slice(2)}`;
  if (c.length <= 8) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}`;
  if (c.length <= 12) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8)}`;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/**
 * E-mail com cara de e-mail: algo@dominio.tld, sem espaco, sem ponto duplo e
 * sem ponto na ponta da parte local.
 *
 * Um pouco mais estrito que o do formulario porque aqui o erro custa mais: e
 * para este endereco que a plataforma manda o link de assinatura, e um
 * "maria@gmail..com" so apareceria como "nunca assinou" dias depois.
 */
export function validarEmail(s: string): boolean {
  const e = (s ?? "").trim();
  if (e.length === 0 || e.length > 254) return false;

  const m = /^([^\s@]+)@((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,})$/u.exec(e);
  if (!m) return false;

  const local = m[1];
  return !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

/** E-mail como fica guardado: aparado e minusculo (dominio nao diferencia caixa, e ninguem digita caixa alta de proposito). */
export function normalizarEmail(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

/** "13000000" -> "13000-000". Fora do tamanho, devolve o que veio (aparado). */
export function formatarCep(s: string): string {
  const d = somenteDigitos(s);
  if (d.length !== 8) return (s ?? "").trim();
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** CEP com os 8 digitos. Nao prova que o CEP existe; so que foi digitado inteiro. */
export function validarCep(s: string): boolean {
  const bruto = (s ?? "").trim();
  if (/[^\d.\-\s]/.test(bruto)) return false;
  return somenteDigitos(bruto).length === 8;
}

/** Mascara progressiva do CEP (00000-000). */
export function mascararCep(v: string): string {
  const d = somenteDigitos(v).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}
