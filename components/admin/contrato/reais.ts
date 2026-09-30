// Conversao entre o que a Mel digita e o que o contrato guarda: dinheiro em
// CENTAVOS inteiros e numeros (percentual, dias, horas) como `number`.
//
// Puro e sem React: os campos do painel usam estas funcoes, e o teste prova as
// bordas sem precisar de navegador. Nenhum float de dinheiro passa por aqui
// (decisao 10 do SPEC): o campo de reais trabalha com os DIGITOS, como a
// maquininha de cartao -- cada digito entra pela direita e empurra os outros.

import { formatarReais } from "@/lib/contrato/extenso";

/** O teto do schema para qualquer valor em centavos (R$ 100.000,00). */
export const MAXIMO_CENTAVOS = 100_000_00;

/**
 * "1.500,00" -> 150000. So os digitos contam: "R$ 1.500,00", "150000" e
 * "1500,00" dao o mesmo valor, e letra digitada por engano some.
 *
 * Por que digitos e nao "virgula decimal": no celular o teclado numerico nem
 * sempre tem virgula, e a mascara de maquininha e a que todo mundo ja conhece
 * do caixa -- digita 1 5 0 0 0 0 e le "1.500,00".
 *
 * Passou do teto, fica no teto: um zero a mais digitado por engano vira R$
 * 100.000,00 na tela (visivel e absurdo), nao um erro silencioso no servidor.
 */
export function centavosDoTexto(texto: string, maximo = MAXIMO_CENTAVOS): number {
  const digitos = (texto ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digitos) return 0;
  // Mais digitos que o teto tem ja e acima do teto: nem converte (evita
  // perder precisao com um numero gigante colado).
  if (digitos.length > String(maximo).length) return maximo;
  return Math.min(Number.parseInt(digitos, 10), maximo);
}

/**
 * O que foi COLADO no campo de reais, quando e um valor em reais INTEIROS:
 * "R$ 1.500", "1.500", "1500 reais", "R$ 380" -> centavos. `null` quando o
 * texto nao tem essa cara, e ai vale a mascara de maquininha de sempre.
 *
 * Existe porque a maquininha le todo digito como centavo: colar "R$ 1.500"
 * (o formato das artes, e o que se copia da proposta ou do WhatsApp) virava
 * R$ 15,00 em silencio. Digitar continua sendo a maquininha -- so o colar,
 * que traz o texto inteiro de uma vez, da para interpretar.
 *
 * Reais inteiros = sem virgula E (milhar com ponto, ou "R$"/"reais" junto).
 * Com virgula ("R$ 1.500,00") os centavos estao escritos, e a maquininha ja
 * acerta. Numero puro sem nada ("1500") continua ambiguo: fica com a
 * maquininha, que e o que a Mel ve acontecer quando digita.
 */
export function centavosDoColado(texto: string, maximo = MAXIMO_CENTAVOS): number | null {
  const t = (texto ?? "").trim();
  if (!t || t.includes(",")) return null;
  const temMoeda = /R\$|\bre(?:al|ais)\b/i.test(t);
  // Tira a moeda e os espacos (inclusive o nao separavel que vem de pagina).
  const numero = t
    .replace(/R\$/gi, "")
    .replace(/\bre(?:al|ais)\b/gi, "")
    .replace(/[\s  ]+/g, "");
  const comMilhar = /^\d{1,3}(?:\.\d{3})+$/.test(numero);
  if (!comMilhar && !(temMoeda && /^\d+$/.test(numero))) return null;

  const digitos = numero.replace(/\D/g, "").replace(/^0+/, "");
  if (!digitos) return null;
  // Reais com mais digitos que o teto em centavos ja passam do teto.
  if (digitos.length > String(maximo).length) return maximo;
  return Math.min(Number.parseInt(digitos, 10) * 100, maximo);
}

/**
 * 150000 -> "1.500,00"; 0 -> "" (campo vazio, com o placeholder "0,00").
 *
 * Zero vira vazio de proposito: zero no contrato significa "ainda nao
 * informado" (a montagem recusa pacote com valor zero), e um "0,00" preenchido
 * pareceria um valor confirmado.
 */
export function textoDeCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos <= 0) return "";
  return formatarReais(centavos).replace(/^R\$\s/, "");
}

/**
 * O texto digitado num campo numerico ainda e aceitavel? Serve para recusar a
 * tecla na hora (em vez de aceitar e acusar depois): so digitos e, com
 * decimais, uma virgula (ou ponto) com no maximo `decimais` casas.
 *
 * Vazio e aceito: e o estado de quem apagou para digitar de novo.
 */
export function textoNumericoAceito(texto: string, decimais: number): boolean {
  const t = (texto ?? "").trim();
  if (t === "") return true;
  if (decimais <= 0) return /^\d+$/.test(t);
  return new RegExp(`^\\d*(?:[.,]\\d{0,${decimais}})?$`).test(t);
}

/**
 * "33,33" -> 33.33; "15" -> 15; "12," -> 12 (virgula no fim e so alguem no
 * meio da digitacao); "" ou "," -> null.
 */
export function numeroDoTexto(texto: string, decimais: number): number | null {
  const t = (texto ?? "").trim();
  if (!textoNumericoAceito(t, decimais)) return null;
  const normal = t.replace(",", ".");
  if (!/\d/.test(normal)) return null;
  const n = Number(normal.endsWith(".") ? normal.slice(0, -1) : normal);
  return Number.isFinite(n) ? n : null;
}

/** 33.33 -> "33,33"; 30 -> "30"; 12.5 -> "12,5". Virgula decimal, sem zero sobrando. */
export function textoDeNumero(n: number, decimais: number): string {
  if (!Number.isFinite(n)) return "";
  if (decimais <= 0) return String(Math.trunc(n));
  return String(Number(n.toFixed(decimais))).replace(".", ",");
}

/** Prende `n` entre os limites que existirem. */
export function limitar(n: number, min?: number, max?: number): number {
  let v = n;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}
