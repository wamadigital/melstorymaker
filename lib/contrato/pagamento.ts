// Pagamento do contrato: presets, calculo das parcelas e validacao.
//
// Dinheiro SEMPRE em centavos inteiros (decisao 10 do SPEC). O percentual e
// digitado; o valor em R$ de cada parcela e CALCULADO aqui, nunca digitado --
// foi digitando que um contrato antigo saiu com parcelas que nao somavam o
// total. O arredondamento e half-up e o que sobrar cai na ULTIMA parcela, para
// a soma bater exatamente com o total escrito no contrato.
//
// Sem "server-only": o painel mostra cada parcela em R$ ao vivo e os erros de
// `validarPagamento` inline, com as mesmas funcoes que a montagem usa.

import type { Pagamento, Parcela, Vencimento } from "@/lib/contrato/tipos";
import { centesimosDePercentual, formatarReais } from "@/lib/contrato/extenso";
import { dataCurta } from "@/lib/pdf/formatadores";

// ------------------------------------------------------------------ datas --

const RE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

/**
 * Numero do dia no calendario (dias desde 1970-01-01) a partir de "AAAA-MM-DD",
 * ou `null` se a data nao existe ("2027-02-30").
 *
 * A string e lida por regex e a conta e feita em UTC puro (`Date.UTC`), sem
 * nenhum fuso no caminho: `new Date("2027-01-01")` seria meia-noite UTC, que
 * em Sao Paulo ainda e dia 31 -- o mesmo erro que o CLAUDE.md documenta para
 * a tabela de preco.
 */
export function diaDoCalendario(iso: string): number | null {
  const m = RE_DATA_ISO.exec((iso ?? "").trim());
  if (!m) return null;

  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(ano, mes - 1, dia);
  const d = new Date(ms);
  // Date.UTC "conserta" 30 de fevereiro para 2 de marco; aqui isso e data invalida.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return Math.round(ms / MS_POR_DIA);
}

/** "2027-02-30" nao passa; "2027-02-28" passa. So o formato do <input type="date">. */
export function dataISOValida(iso: string): boolean {
  return diaDoCalendario(iso) !== null;
}

/** "2027-01-23" menos 10 dias -> "2027-01-13". `null` se a data nao e valida. */
export function somarDiasISO(iso: string, dias: number): string | null {
  const dia = diaDoCalendario(iso);
  if (dia === null) return null;
  return new Date((dia + dias) * MS_POR_DIA).toISOString().slice(0, 10);
}

/**
 * Data em que a parcela vence, quando da para saber: a data informada, a data
 * do pagamento ja feito, ou N dias antes do evento. `null` na assinatura (a
 * data e a da assinatura, que ainda nao existe) ou sem data do evento.
 */
export function dataDoVencimento(v: Vencimento, dataEventoISO: string): string | null {
  switch (v.tipo) {
    case "assinatura":
      return null;
    case "data":
    case "pago":
      return dataISOValida(v.data) ? v.data.trim() : null;
    case "dias_antes":
      return somarDiasISO(dataEventoISO, -v.dias);
  }
}

// ---------------------------------------------------------------- presets --

export const PRESETS_PAGAMENTO_IDS = ["30/70", "15/15/70", "integral", "quitado"] as const;
export type PresetPagamento = (typeof PRESETS_PAGAMENTO_IDS)[number];

type Preset = { rotulo: string; pagamento: () => Pagamento };

const PRESETS: Record<PresetPagamento, Preset> = {
  // O de sempre nas artes: 30% de reserva e o resto ate 10 dias antes (PIX).
  "30/70": {
    rotulo: "30% + 70%",
    pagamento: () => ({
      modo: "parcelas",
      parcelas: [
        { percentual: 30, sinal: true, vencimento: { tipo: "assinatura" } },
        { percentual: 70, sinal: false, vencimento: { tipo: "dias_antes", dias: 10 } },
      ],
      quitadoEm: "",
      percentualSinalQuitado: 30,
    }),
  },
  // Sinal partido em dois. A data da segunda metade fica VAZIA de proposito:
  // e a Mel que combina, e a montagem acusa a falta em vez de inventar uma.
  // As DUAS parcelas de 15% sao sinal, e isso nao e descuido (recomendacao
  // C03 da revisao juridica): nos contratos antigos so a primeira era
  // "entrada", e lida contra quem redigiu a retencao caia de 30% para 15%. O
  // texto trata cada uma como "parte do sinal" e deixa a reserva da data so
  // no paragrafo-resumo (clausulas.ts, `clausulaPagamento`).
  "15/15/70": {
    rotulo: "15% + 15% + 70%",
    pagamento: () => ({
      modo: "parcelas",
      parcelas: [
        { percentual: 15, sinal: true, vencimento: { tipo: "assinatura" } },
        { percentual: 15, sinal: true, vencimento: { tipo: "data", data: "" } },
        { percentual: 70, sinal: false, vencimento: { tipo: "dias_antes", dias: 10 } },
      ],
      quitadoEm: "",
      percentualSinalQuitado: 30,
    }),
  },
  // Tudo na assinatura, mas ainda com 30% identificado como SINAL: e o sinal
  // que fica retido em caso de desistencia, e um contrato sem sinal deixaria a
  // clausula de desistencia sem objeto.
  integral: {
    rotulo: "Tudo na assinatura",
    pagamento: () => ({
      modo: "parcelas",
      parcelas: [
        { percentual: 30, sinal: true, vencimento: { tipo: "assinatura" } },
        { percentual: 70, sinal: false, vencimento: { tipo: "assinatura" } },
      ],
      quitadoEm: "",
      percentualSinalQuitado: 30,
    }),
  },
  // Ja pago antes do contrato. A data de quitacao e da Mel.
  quitado: {
    rotulo: "Já pago",
    pagamento: () => ({
      modo: "quitado",
      parcelas: [],
      quitadoEm: "",
      percentualSinalQuitado: 30,
    }),
  },
};

function congelar<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) congelar(v);
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Os presets para os botoes do painel ("30% + 70%", "Tudo na assinatura"...),
 * na ordem de `PRESETS_PAGAMENTO_IDS`.
 *
 * CONGELADOS: sao compartilhados. Para editar, use `pagamentoDoPreset`, que
 * devolve um objeto novo a cada chamada -- sem isso, a Mel mudando o
 * percentual de um contrato mudaria o preset do contrato seguinte.
 */
export const PRESETS_PAGAMENTO: Readonly<Record<PresetPagamento, { readonly rotulo: string; readonly pagamento: Pagamento }>> =
  congelar(
    Object.fromEntries(
      PRESETS_PAGAMENTO_IDS.map((id) => [id, { rotulo: PRESETS[id].rotulo, pagamento: PRESETS[id].pagamento() }]),
    ) as Record<PresetPagamento, { rotulo: string; pagamento: Pagamento }>,
  );

/** Um pagamento NOVO a partir do preset (objeto proprio: pode ser editado a vontade). */
export function pagamentoDoPreset(id: PresetPagamento): Pagamento {
  return PRESETS[id].pagamento();
}

// --------------------------------------------------------------- calculo --

export type ParcelaCalculada = {
  /** Centavos. */
  valor: number;
  percentual: number;
  sinal: boolean;
  vencimento: Vencimento;
};

/** A, B, C... -- a mesma letra do item no contrato. */
export function letraParcela(indice: number): string {
  return String.fromCharCode(65 + indice);
}

/**
 * `total * centesimos / 10000`, half-up, so com inteiros. O percentual chega
 * em centesimos (33,33% -> 3333); nenhum float de dinheiro no caminho.
 */
function parteDoTotal(totalCentavos: number, centesimos: number): number {
  const produto = totalCentavos * Math.max(0, centesimos);
  const quociente = Math.floor(produto / 10_000);
  const resto = produto % 10_000;
  return resto * 2 >= 10_000 ? quociente + 1 : quociente;
}

export function somaPercentuais(parcelas: readonly Pick<Parcela, "percentual">[]): number {
  return parcelas.reduce((s, p) => s + p.percentual, 0);
}

/** Os percentuais fecham 100% (tolerancia de 0,001, para 33,333 x 3). */
export function percentuaisFecham(parcelas: readonly Pick<Parcela, "percentual">[]): boolean {
  return parcelas.length > 0 && Math.abs(somaPercentuais(parcelas) - 100) <= 0.001;
}

function exigirTotal(totalCentavos: number): void {
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 0) {
    throw new RangeError(`Total em centavos precisa ser inteiro e não negativo: ${totalCentavos}`);
  }
}

/**
 * Valor de cada parcela em centavos.
 *
 *   30/70 de R$ 1.290,00    -> 387,00 + 903,00
 *   15/15/70 de R$ 1.290,00 -> 193,50 + 193,50 + 903,00
 *
 * Com os percentuais fechando 100%, a ultima parcela recebe o que sobra, e a
 * soma e EXATAMENTE o total. Sem fechar (a Mel ainda digitando), cada parcela
 * e so o seu percentual -- jogar o residuo na ultima faria ela mostrar um
 * valor que nao corresponde ao percentual ao lado.
 */
export function calcularParcelas(totalCentavos: number, parcelas: readonly Parcela[]): ParcelaCalculada[] {
  exigirTotal(totalCentavos);

  const valores = parcelas.map((p) => parteDoTotal(totalCentavos, centesimosDePercentual(p.percentual)));
  if (percentuaisFecham(parcelas)) {
    const antesDaUltima = valores.slice(0, -1).reduce((s, v) => s + v, 0);
    valores[valores.length - 1] = totalCentavos - antesDaUltima;
  }

  return parcelas.map((p, i) => ({
    valor: valores[i],
    percentual: p.percentual,
    sinal: p.sinal,
    vencimento: p.vencimento,
  }));
}

/**
 * Valor do SINAL em centavos: a soma das parcelas marcadas como sinal, ou,
 * no modo quitado, a parte do valor pago que foi declarada como sinal. E o
 * valor retido em caso de desistencia (clausula de desistencia).
 */
export function valorSinal(totalCentavos: number, pagamento: Pagamento): number {
  exigirTotal(totalCentavos);
  if (pagamento.modo === "quitado") {
    return parteDoTotal(totalCentavos, centesimosDePercentual(pagamento.percentualSinalQuitado));
  }
  return calcularParcelas(totalCentavos, pagamento.parcelas)
    .filter((p) => p.sinal)
    .reduce((s, p) => s + p.valor, 0);
}

// ------------------------------------------------------------- validacao --

function temMaisDeDuasCasas(p: number): boolean {
  return Math.abs(p * 100 - centesimosDePercentual(p)) > 1e-6;
}

/** "90%", "100,004%": ate tres casas, para a mensagem da soma nao dizer "somam 100%" quando nao somam. */
function formatarSoma(p: number): string {
  return `${Number(p.toFixed(3)).toString().replace(".", ",")}%`;
}

type ProblemaData = "vazia" | "sem_ano" | "inexistente" | null;

function problemaDaData(iso: string): ProblemaData {
  const t = (iso ?? "").trim();
  if (!t) return "vazia";
  if (!RE_DATA_ISO.test(t)) return "sem_ano";
  return dataISOValida(t) ? null : "inexistente";
}

/**
 * Erros do pagamento, em frases que a Mel resolve na tela. Lista vazia = ok.
 *
 * Checa: percentuais somando 100% (tolerancia 0,001) e com no maximo duas
 * casas; pelo menos uma parcela como sinal (ou, quitado, uma parte declarada
 * como sinal); datas completas e existentes; vencimento ate a data do evento;
 * vencimento que ja passou; "N dias antes do evento" que cairia antes de hoje
 * (o caso do contrato em que o saldo "vencia" antes de o contrato ser
 * assinado); e pagamento "já pago" com data futura.
 *
 * Sem data de evento valida, as checagens que dependem dela sao puladas: a
 * falta da data do evento e acusada pela montagem, uma vez so.
 */
export function validarPagamento(p: Pagamento, total: number, dataEventoISO: string, hojeISO: string): string[] {
  const erros: string[] = [];
  const hoje = diaDoCalendario(hojeISO);
  const evento = diaDoCalendario(dataEventoISO);

  if (p.modo === "quitado") {
    const problema = problemaDaData(p.quitadoEm);
    if (problema === "vazia") erros.push("Informe a data em que o pagamento foi quitado.");
    else if (problema === "sem_ano") erros.push("A data da quitação precisa ter dia, mês e ano.");
    else if (problema === "inexistente") erros.push(`A data da quitação não existe (${dataCurta(p.quitadoEm)}).`);
    else if (hoje !== null && (diaDoCalendario(p.quitadoEm) ?? 0) > hoje) {
      erros.push(`A data da quitação (${dataCurta(p.quitadoEm)}) é futura: quitado é pagamento já feito.`);
    }

    if (!(p.percentualSinalQuitado > 0)) {
      erros.push("Informe que parte do valor pago corresponde ao sinal (o padrão é 30%).");
    } else if (temMaisDeDuasCasas(p.percentualSinalQuitado)) {
      erros.push("Use no máximo duas casas decimais no percentual do sinal.");
    }
    return erros;
  }

  if (p.parcelas.length === 0) return ["Inclua pelo menos uma parcela no pagamento."];

  const calculadas = Number.isSafeInteger(total) && total >= 0 ? calcularParcelas(total, p.parcelas) : null;

  p.parcelas.forEach((parcela, i) => {
    const letra = letraParcela(i);

    if (!(parcela.percentual > 0)) {
      erros.push(`Parcela ${letra}: informe o percentual.`);
    } else if (temMaisDeDuasCasas(parcela.percentual)) {
      erros.push(`Parcela ${letra}: use no máximo duas casas decimais no percentual.`);
    } else if (calculadas && total > 0 && calculadas[i].valor === 0) {
      erros.push(`Parcela ${letra}: o valor calculado fica em ${formatarReais(0)}.`);
    }

    const v = parcela.vencimento;
    if (v.tipo === "data") {
      const problema = problemaDaData(v.data);
      if (problema === "vazia") erros.push(`Parcela ${letra}: informe a data de vencimento.`);
      else if (problema === "sem_ano") erros.push(`Parcela ${letra}: a data de vencimento precisa ter dia, mês e ano.`);
      else if (problema === "inexistente") erros.push(`Parcela ${letra}: a data de vencimento não existe (${dataCurta(v.data)}).`);
      else {
        const dia = diaDoCalendario(v.data) ?? 0;
        if (evento !== null && dia > evento) {
          erros.push(
            `Parcela ${letra}: o vencimento (${dataCurta(v.data)}) é depois do evento (${dataCurta(dataEventoISO)}); precisa ser até a data do evento.`,
          );
        } else if (hoje !== null && dia < hoje) {
          erros.push(
            `Parcela ${letra}: o vencimento (${dataCurta(v.data)}) já passou. Se ela já foi paga, use “já pago”.`,
          );
        }
      }
    } else if (v.tipo === "dias_antes") {
      const vence = somarDiasISO(dataEventoISO, -v.dias);
      const diaVence = vence ? diaDoCalendario(vence) : null;
      if (diaVence !== null && hoje !== null && diaVence < hoje) {
        erros.push(
          `Parcela ${letra}: “até ${v.dias} dias antes do evento” cai em ${dataCurta(vence)}, que já passou, e a parcela venceria antes da assinatura. Use “na assinatura”.`,
        );
      }
    } else if (v.tipo === "pago") {
      const problema = problemaDaData(v.data);
      if (problema === "vazia") erros.push(`Parcela ${letra}: informe a data em que foi paga.`);
      else if (problema === "sem_ano") erros.push(`Parcela ${letra}: a data do pagamento precisa ter dia, mês e ano.`);
      else if (problema === "inexistente") erros.push(`Parcela ${letra}: a data do pagamento não existe (${dataCurta(v.data)}).`);
      else if (hoje !== null && (diaDoCalendario(v.data) ?? 0) > hoje) {
        erros.push(`Parcela ${letra}: a data do pagamento (${dataCurta(v.data)}) é futura; parcela ainda não paga usa outro vencimento.`);
      }
    }
  });

  if (!percentuaisFecham(p.parcelas)) {
    erros.push(`Os percentuais das parcelas somam ${formatarSoma(somaPercentuais(p.parcelas))}; precisam somar 100%.`);
  }
  if (!p.parcelas.some((x) => x.sinal)) {
    erros.push("Marque pelo menos uma parcela como sinal: é ela que garante a reserva da data.");
  }

  return erros;
}
