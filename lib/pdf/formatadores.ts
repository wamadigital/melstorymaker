// Formatacao pt-BR para o PDF (RF-15). O banco guarda ISO; a formatacao
// acontece so na borda -- aqui e na UI.

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/**
 * "2026-03-14" -> "14 de março de 2026".
 *
 * A string ISO e parseada com regex de proposito. `new Date("2026-03-14")` e
 * interpretado como MEIA-NOITE EM UTC; convertido para o horario de Brasilia
 * (UTC-3) vira 21h do dia 13, e a proposta sai com a data da festa um dia
 * antes. Sem objeto Date no caminho, nao existe fuso para errar.
 */
export function dataExtenso(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";

  const [, ano, mes, dia] = m;
  const nomeMes = MESES[Number(mes) - 1];
  if (!nomeMes) return "";

  return `${Number(dia)} de ${nomeMes} de ${ano}`;
}

/**
 * "19:30" -> "19h30"; "19:00" -> "19h".
 * Hora cheia sem os dois zeros e como se escreve e se fala em pt-BR.
 */
export function horaBr(valor: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(valor ?? "");
  if (!m) return "";

  const [, hora, minuto] = m;
  const h = Number(hora);
  if (Number.isNaN(h) || h > 23) return "";

  return minuto === "00" ? `${h}h` : `${h}h${minuto}`;
}

/** Data curta para as telas do painel: "14/03/2026". */
export function dataCurta(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const [, ano, mes, dia] = m;
  return `${dia}/${mes}/${ano}`;
}

/** Timestamp do banco para "14/03/2026 às 19h30", no fuso de quem le. */
const FUSO_MEL = "America/Sao_Paulo";

export function dataHoraLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  // Fuso FIXO, nao o do ambiente. getDate/getHours usam o relogio de quem
  // renderiza: no navegador da Mel daria certo por acaso, mas a lista do painel
  // e renderizada no servidor da Vercel, que roda em UTC -- e um lead das 15h08
  // aparecia como 18h08. O horario aqui e sempre o de Sao Paulo, de onde a Mel
  // le, independentemente de onde o codigo rodar.
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_MEL,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const em = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((x) => x.type === tipo)?.value ?? "";

  const hora = String(Number.parseInt(em("hour"), 10));
  const minuto = em("minute");

  return `${em("day")}/${em("month")}/${em("year")} às ${minuto === "00" ? `${hora}h` : `${hora}h${minuto}`}`;
}

/**
 * Formatadores disponiveis no templates.config.ts.
 *
 * `data_curta` (DD/MM/AAAA) e o padrao das propostas, por decisao do owner.
 * `data_extenso` continua aqui por ser a forma que o PRD descrevia antes e por
 * seguir valendo para qualquer arte que peca a data escrita.
 */
/**
 * Particulas que ficam em minuscula no meio do nome. "Maria Eduarda do
 * Nascimento", nao "Maria Eduarda Do Nascimento" -- a segunda forma denuncia
 * capitalizacao automatica e some com o cuidado que a arte tem.
 * Na PRIMEIRA palavra elas sobem normalmente ("Da Silva Consultoria").
 */
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du"]);

/** Sobe a inicial da palavra, respeitando hifen e apostrofo. */
function capitalizarPalavra(palavra: string): string {
  return palavra.replace(/(^|[-'\u2019])(\p{L})/gu, (_, separador: string, letra: string) =>
    separador + letra.toLocaleUpperCase("pt-BR"),
  );
}

/**
 * Nome proprio: inicial maiuscula, resto minusculo.
 *
 *   "MARIA FERNANDA"  -> "Maria Fernanda"
 *   "césar"           -> "César"
 *   "rafa & gui"      -> "Rafa & Gui"
 *
 * Existe porque o lead digita como quer -- tudo em caixa alta no celular, tudo
 * minusculo com pressa -- e o nome dele aparece grande na capa da proposta. O
 * banco guarda o que foi digitado; isto e so a forma de exibir.
 */
export function nomeProprio(valor: string | null | undefined): string {
  const bruto = (valor ?? "").trim();
  if (!bruto) return "";

  return bruto
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((palavra, i) => (i > 0 && PARTICULAS.has(palavra) ? palavra : capitalizarPalavra(palavra)))
    .join(" ");
}

export const FORMATADORES = {
  data_curta: dataCurta,
  data_extenso: dataExtenso,
  hora_br: horaBr,
  nome_proprio: nomeProprio,
} as const;

export type NomeFormatador = keyof typeof FORMATADORES;
