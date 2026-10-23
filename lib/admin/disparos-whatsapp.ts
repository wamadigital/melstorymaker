import { z } from "zod";
import type { LeadCartao, DisparoWhatsApp } from "@/lib/admin/tipos";

export type TipoHistoricoWhatsApp = DisparoWhatsApp["tipo"] |
  "lembrete_7_dias" | "lembrete_30_dias" | "contato_inicial";

export type EntradaHistoricoWhatsApp = {
  tipo: TipoHistoricoWhatsApp;
  rotulo: string;
  enviadoEm: string;
  origem: "automatico" | "manual" | "sistema";
};

type CamposHistorico = Pick<LeadCartao,
  "lembrete_7_em" | "lembrete_30_em" | "chamado_whatsapp_em" | "disparos_whatsapp"
>;

type TipoResumoWhatsApp = Exclude<DisparoWhatsApp["tipo"], "confirmacao_recebimento">;
export type ResumoEnvioWhatsApp = {
  tipo: TipoResumoWhatsApp;
  rotulo: string;
  enviado: boolean;
};

const TIPOS_RESUMO: readonly TipoResumoWhatsApp[] = [
  "lembrete_formulario_24h", "proposta_inicial_15m", "lembrete_proposta_7d", "lembrete_proposta_30d",
];

const ROTULOS: Record<TipoHistoricoWhatsApp, string> = {
  confirmacao_recebimento: "Confirmação de recebimento",
  proposta_inicial_15m: "Proposta comercial",
  lembrete_formulario_24h: "Finalize o formulário",
  lembrete_proposta_7d: "Lembrete após 7 dias",
  lembrete_proposta_30d: "Lembrete após 30 dias",
  lembrete_7_dias: "Lembrete após 7 dias",
  lembrete_30_dias: "Lembrete após 30 dias",
  contato_inicial: "Contato inicial",
};
const timestamp = z.string().datetime({ offset: true });

export function ehDataEnvioWhatsApp(valor: unknown): valor is string {
  return timestamp.safeParse(valor).success && Number.isFinite(Date.parse(valor as string));
}

export function ehTipoDisparoWhatsApp(valor: unknown): valor is DisparoWhatsApp["tipo"] {
  return valor === "confirmacao_recebimento" || valor === "lembrete_formulario_24h" ||
    valor === "lembrete_proposta_7d" || valor === "lembrete_proposta_30d" || valor === "proposta_inicial_15m";
}

/**
 * Checklist cumulativo, sem decidir elegibilidade ou apagar envios anteriores.
 * A proposta também conta pelo envio registrado no CRM (inclusive Enviado e
 * Esfriou legados sem carimbo). Os outros itens exigem seu próprio ACK.
 */
export function resumoEnviosWhatsApp(lead: Pick<LeadCartao, "disparos_whatsapp"> &
  Partial<Pick<LeadCartao, "enviado_em" | "status">>): ResumoEnvioWhatsApp[] {
  const propostaEnviada = ehDataEnvioWhatsApp(lead.enviado_em) ||
    lead.status === "enviado" || lead.status === "esfriou";
  return TIPOS_RESUMO.map((tipo) => ({
    tipo,
    rotulo: ROTULOS[tipo],
    enviado: (tipo === "proposta_inicial_15m" && propostaEnviada) || (lead.disparos_whatsapp ?? []).some((disparo) =>
      disparo && disparo.tipo === tipo && ehDataEnvioWhatsApp(disparo.enviado_em)),
  }));
}

/**
 * Envios confirmados pelo worker e afirmações manuais da Mel. Não usa a coluna
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
    if (disparo && ehTipoDisparoWhatsApp(disparo.tipo)) {
      const origem = disparo.tipo === "lembrete_proposta_7d" || disparo.tipo === "lembrete_proposta_30d"
        ? "sistema" : "automatico";
      adicionar(disparo.tipo, disparo.enviado_em, origem);
    }
  }
  // O ACK também carimba o lead. Esse mesmo instante não é outro envio manual.
  const mesmoEnvio = (tipo: DisparoWhatsApp["tipo"], carimbo: unknown) => ehDataEnvioWhatsApp(carimbo) &&
    lead.disparos_whatsapp?.some((disparo) => disparo.tipo === tipo && ehDataEnvioWhatsApp(disparo.enviado_em) &&
      Date.parse(disparo.enviado_em) === Date.parse(carimbo));
  if (!mesmoEnvio("lembrete_proposta_7d", lead.lembrete_7_em)) adicionar("lembrete_7_dias", lead.lembrete_7_em, "manual");
  if (!mesmoEnvio("lembrete_proposta_30d", lead.lembrete_30_em)) adicionar("lembrete_30_dias", lead.lembrete_30_em, "manual");
  adicionar("contato_inicial", lead.chamado_whatsapp_em, "manual");

  return [...porTipo.values()].sort((a, b) => Date.parse(b.enviadoEm) - Date.parse(a.enviadoEm) ||
    (a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : 0));
}
