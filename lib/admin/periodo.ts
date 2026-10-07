/**
 * Filtro de periodo do quadro. Conta pela CHEGADA do lead (`created_at`), que e
 * a pergunta da Mel ao abrir o painel ("quem chegou esta semana?"), e vale para
 * as seis colunas igual: um lead que chegou em agosto e foi enviado hoje nao
 * entra em "Hoje".
 *
 * O corte e sempre a meia-noite de SAO PAULO, nunca a do ambiente: o quadro e
 * renderizado na Vercel, em UTC, e "hoje" la comecaria as 21h da vespera. Mesmo
 * motivo do `dataHoraLocal`.
 */
export const PERIODOS = ["todo", "hoje", "semana", "mes"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const ROTULO_PERIODO: Record<Periodo, string> = {
  todo: "Todo o período",
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
};

/** O mesmo periodo dentro de uma frase: "3 leads esta semana". */
export const FRASE_PERIODO: Record<Exclude<Periodo, "todo">, string> = {
  hoje: "hoje",
  semana: "esta semana",
  mes: "este mês",
};

const FUSO_MEL = "America/Sao_Paulo";
const DIA_MS = 86_400_000;

export function ehPeriodo(v: string | undefined): v is Periodo {
  return !!v && (PERIODOS as readonly string[]).includes(v);
}

/** Ano, mes e dia de um instante no relogio de Sao Paulo. */
function diaEmSaoPaulo(instanteMs: number): { ano: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_MEL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instanteMs));
  const em = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: em("year"), mes: em("month"), dia: em("day") };
}

/**
 * Quanto Sao Paulo esta do UTC naquele instante (-3h hoje). Calculado, e nao
 * cravado em -03:00: se o horario de verao voltar, o corte continua certo sem
 * ninguem lembrar deste arquivo.
 */
function deslocamentoMs(instanteMs: number): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_MEL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instanteMs));
  const em = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  const comoSeFosseUtc = Date.UTC(em("year"), em("month") - 1, em("day"), em("hour"), em("minute"), em("second"));
  return comoSeFosseUtc - Math.floor(instanteMs / 1000) * 1000;
}

/**
 * Primeiro instante do periodo, em ISO UTC, para o `gte` do Supabase. `null`
 * em "todo": sem corte nenhum. A semana comeca na SEGUNDA.
 *
 * Recebe o `agoraMs` da pagina, o mesmo que esfria os parados e desce para os
 * cartoes: um relogio so por request.
 */
export function inicioDoPeriodo(periodo: Periodo, agoraMs: number): string | null {
  if (periodo === "todo") return null;

  const { ano, mes, dia } = diaEmSaoPaulo(agoraMs);
  // Meia-noite "de calendario" (como se fosse UTC); o fuso entra so no fim.
  let meiaNoite = Date.UTC(ano, mes - 1, periodo === "mes" ? 1 : dia);
  if (periodo === "semana") {
    // getUTCDay: domingo = 0. Recuo ate a segunda: seg 0, ter 1, ..., dom 6.
    const recuo = (new Date(meiaNoite).getUTCDay() + 6) % 7;
    meiaNoite -= recuo * DIA_MS;
  }

  // Meio-dia como referencia do deslocamento: longe de qualquer virada de hora.
  return new Date(meiaNoite - deslocamentoMs(meiaNoite + DIA_MS / 2)).toISOString();
}
