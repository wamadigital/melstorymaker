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
export function dataHoraLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = d.getHours();
  const minuto = String(d.getMinutes()).padStart(2, "0");

  return `${dia}/${mes}/${d.getFullYear()} às ${minuto === "00" ? `${hora}h` : `${hora}h${minuto}`}`;
}

/**
 * Formatadores disponiveis no templates.config.ts.
 *
 * `data_curta` (DD/MM/AAAA) e o padrao das propostas, por decisao do owner.
 * `data_extenso` continua aqui por ser a forma que o PRD descrevia antes e por
 * seguir valendo para qualquer arte que peca a data escrita.
 */
export const FORMATADORES = {
  data_curta: dataCurta,
  data_extenso: dataExtenso,
  hora_br: horaBr,
} as const;

export type NomeFormatador = keyof typeof FORMATADORES;
