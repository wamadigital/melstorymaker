import { DIAS_LEMBRETE_1, DIAS_LEMBRETE_2, estadoLembrete, prazoUltimaTentativa, temCobranca } from "@/lib/admin/lembretes";
import type { LeadCartao } from "@/lib/admin/tipos";

type CamposPrazo = Pick<LeadCartao,
  "status" | "enviado_em" | "lembrete_7_em" | "lembrete_30_em" | "disparos_whatsapp" | "teste_whatsapp">;

/**
 * Um único próximo vencimento para o quadro aberto, contado pelo instante do
 * servidor. Não altera elegibilidade nem envia mensagens: pede uma releitura
 * quando um marco futuro puder mudar a apresentação de um cartão visível.
 */
export function atrasoProximaMudancaLembrete(cartoes: readonly CamposPrazo[], agoraMs: number): number | null {
  if (!Number.isFinite(agoraMs)) return null;
  let proximo = Infinity;
  const considerar = (instante: number) => {
    if (Number.isFinite(instante) && instante > agoraMs) proximo = Math.min(proximo, instante);
  };

  for (const lead of cartoes) {
    if (!temCobranca(lead.status) || !lead.enviado_em) continue;
    const enviadoMs = Date.parse(lead.enviado_em);
    if (!Number.isFinite(enviadoMs)) continue;
    const atual = estadoLembrete(lead, lead.status, agoraMs);

    const instantes = [enviadoMs + DIAS_LEMBRETE_1 * 86_400_000,
      enviadoMs + DIAS_LEMBRETE_2 * 86_400_000, prazoUltimaTentativa(lead, agoraMs)];
    for (const instante of instantes) {
      if (instante === null || instante <= agoraMs) continue;
      const futuro = estadoLembrete(lead, lead.status, instante);
      // A liberação pode ficar depois do 30º dia: também precisa completar
      // 15 dias do primeiro ACK. A exceção de teste expira no prazo original.
      if (futuro.marco !== atual.marco || futuro.pendente !== atual.pendente) considerar(instante);
    }

    // Retira a apresentação especial assim que expirar a autorização de teste;
    // o relógio não prolonga a exceção nem fabrica um ACK de WhatsApp.
    if (lead.teste_whatsapp) considerar(Date.parse(lead.teste_whatsapp.expiraEm));
  }
  return Number.isFinite(proximo) ? proximo - agoraMs : null;
}
