import { hojeEmSaoPaulo } from "@/lib/data-local";
import { dataISOValida } from "@/lib/form/data";

/** O evento só encerra no dia seguinte, pelo calendário da Mel em São Paulo. */
export function eventoPassado(dataEvento: string | null | undefined, agoraMs: number): boolean {
  if (!dataEvento || !dataISOValida(dataEvento) || !Number.isFinite(agoraMs)) return false;
  return dataEvento < hojeEmSaoPaulo(agoraMs);
}
