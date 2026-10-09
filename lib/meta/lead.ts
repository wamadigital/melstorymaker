import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { nomeContato } from "@/lib/leads";
import type { Categoria, Respostas, Status } from "@/lib/form/types";
import { EVENTO_DO_STATUS, idEvento } from "@/lib/meta/eventos";
import { configCapi, enviarConversao, type EventoConversao } from "@/lib/meta/conversoes";
import { rastreioGuardado, type RastreioGuardado } from "@/lib/meta/rastreio";
import { enviarEventosCrmDoLead } from "@/lib/meta/crm";

/**
 * Helper legado de enriquecimento, preservado para chamadas existentes.
 * O cadastro atual grava rastreio no proprio INSERT: a outbox precisa nascer
 * com os identificadores originais, antes de um cron poder reivindica-la.
 */
export async function guardarRastreio(leadId: string, rastreio: RastreioGuardado): Promise<void> {
  if (!rastreio.fbp && !rastreio.fbc && !rastreio.ua) return;
  try {
    const { error } = await supabaseAdmin().from("leads").update({ rastreio }).eq("id", leadId);
    if (error) console.error("[meta] falha ao guardar rastreio (o lead NAO foi afetado)");
  } catch {
    console.error("[meta] falha ao guardar rastreio (o lead NAO foi afetado)");
  }
}

/** O pedaco da linha de `leads` que o evento do quadro usa. */
export type LinhaLead = {
  categoria: Categoria;
  email: string | null;
  whatsapp: string | null;
  respostas: Respostas | null;
  rastreio?: unknown;
};

/**
 * Evento do quadro a partir do lead salvo. Pura, para ser testada sem banco.
 *
 * Sai como evento de SITE, e nao `system_generated`, porque e a unica forma de
 * ele virar coluna no Gerenciador de Anuncios: a conversao personalizada da
 * Meta so aceita as fontes "Site" e "Loja fisica". O lead veio do site, e o
 * evento leva o navegador, o ip, o `fbp` e o `fbc` DELE, guardados na criacao
 * -- nunca os da Mel, que e quem esta com o painel aberto.
 *
 * Lead criado antes de o navegador ser guardado (so tem fbp/fbc, ou nada) cai
 * em `system_generated`: a Meta recusa evento de site sem navegador, e mandar
 * assim e melhor do que nao mandar.
 */
export function montarEventoDeStatus(
  leadId: string,
  lead: LinhaLead,
  status: Status,
): EventoConversao | null {
  const nome = EVENTO_DO_STATUS[status];
  if (!nome) return null;

  const guardado = rastreioGuardado(lead.rastreio);
  return {
    nome,
    id: idEvento(status, leadId),
    origem: guardado.userAgent ? "website" : "system_generated",
    categoria: lead.categoria,
    pessoa: {
      leadId,
      email: lead.email,
      whatsapp: lead.whatsapp,
      nome: nomeContato(lead.respostas ?? {}),
      ...guardado,
    },
  };
}

/**
 * Evento do quadro: a Mel levou o lead para `status`. Chamado depois que a
 * transicao ja foi GRAVADA -- nunca antes, senao um 409/422 viraria conversao
 * que nao aconteceu.
 */
async function enviarEventoDeStatusLegado(leadId: string, status: Status): Promise<void> {
  // Status sem evento, ou Meta desligada: nem le o banco.
  if (!EVENTO_DO_STATUS[status] || !configCapi()) return;

  try {
    // `*` e nao a lista de colunas: com `rastreio` nomeada, um banco sem a
    // coluna faria a consulta falhar inteira e o evento nao sairia nem com
    // telefone e e-mail, que bastam para casar.
    const { data: lead, error } = await supabaseAdmin()
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();

    if (error || !lead) {
      console.error(`[meta] nao consegui ler o lead para ${status}`);
      return;
    }

    const evento = montarEventoDeStatus(leadId, lead as LinhaLead, status);
    if (evento) await enviarConversao(evento);
  } catch {
    console.error(`[meta] falha no evento de ${status} (o painel NAO foi afetado)`);
  }
}

/** Canal Site legado preserva as conversoes atuais; CRM tem nomes/IDs proprios. */
export async function enviarEventoDeStatus(leadId: string, status: Status): Promise<void> {
  if (!EVENTO_DO_STATUS[status]) return;
  await Promise.all([enviarEventoDeStatusLegado(leadId, status), enviarEventosCrmDoLead(leadId)]);
}
