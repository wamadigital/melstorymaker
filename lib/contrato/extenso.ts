// Numeros por extenso em pt-BR, para o contrato.
//
// Por que existe: o extenso era o ponto em que o contrato feito a mao mais
// errava. Um deles saiu com "dois mil, quatrocentos e cinquenta reais" (virgula
// no meio da classe), outros com o "e" no lugar errado. Valor por extenso num
// contrato nao e enfeite: havendo divergencia entre o numero e o extenso, e o
// extenso que o juiz costuma ler. Por isso o texto sai daqui, testado, e nunca
// e digitado por ninguem.
//
// Sem "server-only": o painel mostra a mesma coisa ao vivo enquanto a Mel
// preenche, e nao ha segredo nenhum aqui.

export type GeneroNumeral = "masculino" | "feminino";

const UNIDADES_MASCULINO = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const UNIDADES_FEMININO = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];

// "quatorze" e "catorze" sao ambos corretos no VOLP; "quatorze" e a forma que
// o brasileiro le em cheque e em contrato, e e a que fica.
const DEZ_A_DEZENOVE = [
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];

const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];

// "cento" e invariavel; as outras centenas concordam com o substantivo
// ("duzentas pessoas", "duzentos reais").
const CENTENAS_MASCULINO = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];
const CENTENAS_FEMININO = [
  "",
  "cento",
  "duzentas",
  "trezentas",
  "quatrocentas",
  "quinhentas",
  "seiscentas",
  "setecentas",
  "oitocentas",
  "novecentas",
];

const MAXIMO = 999_999_999;

function exigirInteiro(n: number, nome: string): void {
  if (!Number.isInteger(n) || n < 0 || n > MAXIMO) {
    throw new RangeError(`${nome} fora do intervalo por extenso (0 a ${MAXIMO}, inteiro): ${n}`);
  }
}

/** Uma classe de tres digitos (1..999). "cem" so existe sozinho; com resto e "cento e". */
function classePorExtenso(n: number, genero: GeneroNumeral): string {
  if (n === 100) return "cem";

  const unidades = genero === "feminino" ? UNIDADES_FEMININO : UNIDADES_MASCULINO;
  const centenas = genero === "feminino" ? CENTENAS_FEMININO : CENTENAS_MASCULINO;

  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];

  if (c > 0) partes.push(centenas[c]);
  if (resto > 0) {
    if (resto < 10) {
      partes.push(unidades[resto]);
    } else if (resto < 20) {
      partes.push(DEZ_A_DEZENOVE[resto - 10]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${unidades[u]}` : DEZENAS[d]);
    }
  }
  // Dentro da classe o "e" liga sempre: "trezentos e sessenta e sete".
  return partes.join(" e ");
}

/**
 * Inteiro por extenso, 0 a 999.999.999.
 *
 *   1290      -> "mil duzentos e noventa"
 *   1500      -> "mil e quinhentos"
 *   2170      -> "dois mil cento e setenta"
 *   2000500   -> "dois milhões e quinhentos"
 *   2 (fem.)  -> "duas"
 *
 * Regras que o contrato antigo errava, e que ficam escritas aqui:
 *
 * - "mil" nunca leva "um" na frente ("mil e quinhentos", nao "um mil").
 * - Entre as classes NAO ha virgula. O "e" entre classes so aparece antes da
 *   ULTIMA classe nao nula, e so quando ela e menor que 100 ou termina em dois
 *   zeros: "mil e cinquenta", "mil e cem", "dois milhões e quinhentos mil";
 *   mas "mil duzentos e noventa", "um milhão cento e dez mil e quinhentos".
 * - Genero: vale para as unidades e centenas de todas as classes, inclusive a
 *   dos milhares ("duas mil pessoas", "duzentas mil pessoas"). A classe dos
 *   milhoes e sempre masculina, porque concorda com "milhão", que e masculino.
 */
export function numeroPorExtenso(n: number, genero: GeneroNumeral = "masculino"): string {
  exigirInteiro(n, "Número");
  if (n === 0) return "zero";

  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor(n / 1_000) % 1_000;
  const unidades = n % 1_000;

  const classes: { valor: number; texto: string }[] = [];
  if (milhoes > 0) {
    classes.push({
      valor: milhoes,
      texto: milhoes === 1 ? "um milhão" : `${classePorExtenso(milhoes, "masculino")} milhões`,
    });
  }
  if (milhares > 0) {
    classes.push({
      valor: milhares,
      texto: milhares === 1 ? "mil" : `${classePorExtenso(milhares, genero)} mil`,
    });
  }
  if (unidades > 0) {
    classes.push({ valor: unidades, texto: classePorExtenso(unidades, genero) });
  }

  let texto = classes[0].texto;
  for (let i = 1; i < classes.length; i++) {
    const ultima = i === classes.length - 1;
    const redonda = classes[i].valor < 100 || classes[i].valor % 100 === 0;
    texto += ultima && redonda ? " e " : " ";
    texto += classes[i].texto;
  }
  return texto;
}

function exigirCentavos(centavos: number): void {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    throw new RangeError(`Valor em centavos precisa ser inteiro e não negativo: ${centavos}`);
  }
  if (Math.floor(centavos / 100) > MAXIMO) {
    throw new RangeError(`Valor grande demais para escrever por extenso: ${centavos} centavos`);
  }
}

/**
 * Valor em CENTAVOS por extenso.
 *
 *   150000 -> "mil e quinhentos reais"
 *   36750  -> "trezentos e sessenta e sete reais e cinquenta centavos"
 *   100    -> "um real"
 *   50     -> "cinquenta centavos"
 *   100000000 -> "um milhão de reais"
 *
 * O "de" antes de "reais" so aparece quando o numero termina exatamente em
 * milhão/milhões ("um milhão de reais", mas "um milhão e quinhentos reais").
 */
export function reaisPorExtenso(centavos: number): string {
  exigirCentavos(centavos);

  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  if (reais === 0 && cents === 0) return "zero reais";

  const partes: string[] = [];
  if (reais > 0) {
    if (reais === 1) {
      partes.push("um real");
    } else {
      const de = reais % 1_000_000 === 0 ? " de" : "";
      partes.push(`${numeroPorExtenso(reais)}${de} reais`);
    }
  }
  if (cents > 0) {
    partes.push(cents === 1 ? "um centavo" : `${numeroPorExtenso(cents)} centavos`);
  }
  return partes.join(" e ");
}

/** "1234567" -> "1.234.567". Separador de milhar pt-BR, sem depender de Intl. */
export function formatarInteiro(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Número precisa ser inteiro: ${n}`);
  const sinal = n < 0 ? "-" : "";
  return sinal + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Centavos -> "R$ 1.500,00".
 *
 * Espaco NORMAL depois do "R$", nao o NBSP que o `Intl` pt-BR poe: o PDF usa a
 * DM Sans com subset, e o sanitizador do PDF troca NBSP por espaco de qualquer
 * forma -- melhor que o texto ja nasca igual ao que vai ser impresso.
 *
 * Aceita negativo ("-R$ 50,00") porque o painel mostra diferencas ao vivo; o
 * contrato em si nunca tem valor negativo (quem garante e a montagem).
 * Float e recusado: dinheiro neste modulo e sempre centavo inteiro.
 */
export function formatarReais(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError(`Valor em centavos precisa ser inteiro: ${centavos}`);
  }
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const reais = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sinal}R$ ${formatarInteiro(reais)},${String(cents).padStart(2, "0")}`;
}

/** "R$ 1.500,00 (mil e quinhentos reais)" -- a forma que todo valor tem no contrato. */
export function valorComExtenso(centavos: number): string {
  return `${formatarReais(centavos)} (${reaisPorExtenso(centavos)})`;
}

/**
 * Percentual em CENTESIMOS inteiros (33,33% -> 3333), com arredondamento
 * half-up na segunda casa.
 *
 * O `toPrecision(12)` antes do `round` limpa o ruido binario: 33.33 * 100 da
 * 3332.9999999999995 e 0.285 * 100 da 28.499999999999996 -- sem a limpeza, o
 * segundo arredondaria para baixo. Doze digitos significativos sobram para
 * qualquer percentual que alguem digite.
 */
export function centesimosDePercentual(p: number): number {
  if (!Number.isFinite(p)) throw new RangeError(`Percentual inválido: ${p}`);
  return Math.round(Number((p * 100).toPrecision(12)));
}

function exigirPercentual(p: number): number {
  const centesimos = centesimosDePercentual(p);
  if (centesimos < 0 || Math.floor(centesimos / 100) > MAXIMO) {
    throw new RangeError(`Percentual fora do intervalo: ${p}`);
  }
  return centesimos;
}

/** 30 -> "30%"; 12.5 -> "12,5%"; 33.33 -> "33,33%". Virgula decimal, sem zero sobrando. */
export function formatarPercentual(p: number): string {
  const centesimos = exigirPercentual(p);
  const inteiro = Math.floor(centesimos / 100);
  const fracao = centesimos % 100;
  if (fracao === 0) return `${formatarInteiro(inteiro)}%`;
  const casas = fracao % 10 === 0 ? String(fracao / 10) : String(fracao).padStart(2, "0");
  return `${formatarInteiro(inteiro)},${casas}%`;
}

/**
 * "30% (trinta por cento)"; "33,33% (trinta e três inteiros e trinta e três
 * centésimos por cento)"; "12,5% (doze inteiros e cinco décimos por cento)".
 *
 * Percentual e masculino ("dois por cento", "vinte e um por cento").
 */
export function percentualComExtenso(p: number): string {
  const centesimos = exigirPercentual(p);
  const inteiro = Math.floor(centesimos / 100);
  const fracao = centesimos % 100;

  let extenso: string;
  if (fracao === 0) {
    extenso = numeroPorExtenso(inteiro);
  } else {
    let decimal: string;
    if (fracao % 10 === 0) {
      const decimos = fracao / 10;
      decimal = decimos === 1 ? "um décimo" : `${numeroPorExtenso(decimos)} décimos`;
    } else {
      decimal = fracao === 1 ? "um centésimo" : `${numeroPorExtenso(fracao)} centésimos`;
    }
    // "cinco décimos por cento", e nao "zero inteiros e cinco décimos".
    if (inteiro === 0) extenso = decimal;
    else extenso = `${inteiro === 1 ? "um inteiro" : `${numeroPorExtenso(inteiro)} inteiros`} e ${decimal}`;
  }

  return `${formatarPercentual(p)} (${extenso} por cento)`;
}

/** "5 (cinco)"; com genero feminino, "1 (uma)", "2 (duas)". */
export function quantidadeComExtenso(n: number, genero: GeneroNumeral = "masculino"): string {
  exigirInteiro(n, "Quantidade");
  return `${formatarInteiro(n)} (${numeroPorExtenso(n, genero)})`;
}

function exigirDuracao(n: number, nome: string): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${nome} precisa ser inteiro e não negativo: ${n}`);
}

/**
 * Minutos por extenso, como vai no objeto e no local/horario.
 *
 *   300 -> "5 (cinco) horas"
 *   60  -> "1 (uma) hora"          ("hora" e feminino)
 *   90  -> "1 (uma) hora e 30 (trinta) minutos"
 *   30  -> "30 (trinta) minutos"
 */
export function duracaoPorExtenso(minutos: number): string {
  exigirDuracao(minutos, "Duração em minutos");
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;

  const partes: string[] = [];
  if (h > 0) partes.push(`${quantidadeComExtenso(h, "feminino")} ${h === 1 ? "hora" : "horas"}`);
  if (m > 0 || h === 0) partes.push(`${quantidadeComExtenso(m)} ${m === 1 ? "minuto" : "minutos"}`);
  return partes.join(" e ");
}

/** 300 -> "5h"; 90 -> "1h30"; 65 -> "1h05"; 30 -> "30min". Para o detalhamento do tempo de servico. */
export function duracaoCurta(minutos: number): string {
  exigirDuracao(minutos, "Duração em minutos");
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Duracao dos Reels.
 *
 *   90 -> "1 (um) minuto e 30 (trinta) segundos"
 *   60 -> "1 (um) minuto"
 *   45 -> "45 (quarenta e cinco) segundos"
 */
export function segundosPorExtenso(segundos: number): string {
  exigirDuracao(segundos, "Duração em segundos");
  const min = Math.floor(segundos / 60);
  const s = segundos % 60;

  const partes: string[] = [];
  if (min > 0) partes.push(`${quantidadeComExtenso(min)} ${min === 1 ? "minuto" : "minutos"}`);
  if (s > 0 || min === 0) partes.push(`${quantidadeComExtenso(s)} ${s === 1 ? "segundo" : "segundos"}`);
  return partes.join(" e ");
}
