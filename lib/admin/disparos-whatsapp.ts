import { z } from "zod";
import type { LeadCartao, DisparoWhatsApp } from "@/lib/admin/tipos";

export type TipoHistoricoWhatsApp = DisparoWhatsApp["tipo"] |
  "lembrete_7_dias" | "lembrete_30_dias" | "contato_inicial";

export type EntradaHistoricoWhatsApp = {
  tipo: TipoHistoricoWhatsApp;
  rotulo: string;
  enviadoEm: string;
  origem: "automatico" | "manual";
};

type CamposHistorico = Pick<LeadCartao,
  "lembrete_7_em" | "lembrete_30_em" | "chamado_whatsapp_em" | "disparos_whatsapp"
>;

const ROTULOS: Record<TipoHistoricoWhatsApp, string> = {
  confirmacao_recebimento: "Confirmação de recebimento",
  lembrete_formulario_24h: "Finalize o formulário",
  lembrete_7_dias: "Lembrete após 7 dias",
  lembrete_30_dias: "Lembrete após 30 dias",
  contato_inicial: "Contato inicial",
};
const timestamp = z.string().datetime({ offset: true });

export function ehDataEnvioWhatsApp(valor: unknown): valor is string {
  return timestamp.safeParse(valor).success && Number.isFinite(Date.parse(valor as string));
}

export function ehTipoDisparoWhatsApp(valor: unknown): valor is DisparoWhatsApp["tipo"] {
  return valor === "confirmacao_recebimento" || valor === "lembrete_formulario_24h";
}

/**
 * Envios automáticos confirmados e afirmações manuais da Mel. Não usa a coluna
 * atual nem o envio da proposta: reorganizar o quadro não apaga um contato feito.
 */
export function historicoWhatsApp(lead: CamposHistorico): EntradaHistoricoWhatsApp[] {
  const porTipo = new Map<TipoHistoricoWhatsApp, EntradaHistoricoWhatsApp>();
  const adicionar = (tipo: TipoHistoricoWhatsApp, enviadoEm: unknown, origem: EntradaHistoricoWhatsApp["origem"]) => {
    if (ehDataEnvioWhatsApp(enviadoEm)) {
      const anterior = porTipo.get(tipo);
      const diferenca = anterior ? Date.parse(enviadoEm) - Date.parse(anterior.enviadoEm) : 1;
      if (diferenca > 0 || (diferenca === 0 && enviadoEm < anterior!.enviadoEm)) {
        porTipo.set(tipo, { tipo, rotulo: ROTULOS[tipo], enviadoEm, origem });
      }
    }
  };

  for (const disparo of lead.disparos_whatsapp ?? []) {
    if (disparo && ehTipoDisparoWhatsApp(disparo.tipo)) adicionar(disparo.tipo, disparo.enviado_em, "automatico");
  }
  adicionar("lembrete_7_dias", lead.lembrete_7_em, "manual");
  adicionar("lembrete_30_dias", lead.lembrete_30_em, "manual");
  adicionar("contato_inicial", lead.chamado_whatsapp_em, "manual");

  return [...porTipo.values()].sort((a, b) => Date.parse(b.enviadoEm) - Date.parse(a.enviadoEm) ||
    (a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : 0));
}
