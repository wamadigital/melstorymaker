/** Dia civil da Mel, independente do fuso do navegador ou do servidor. */
export function hojeEmSaoPaulo(agora: Date | number): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof agora === "number" ? new Date(agora) : agora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}
