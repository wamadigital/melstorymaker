import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { nomeContato } from "@/lib/leads";
import type { Categoria, Respostas, Status } from "@/lib/form/types";
import { EVENTO_DO_STATUS, idEvento } from "@/lib/meta/eventos";
import { configCapi, enviarConversao, type EventoConversao } from "@/lib/meta/conversoes";
import { rastreioGuardado, type RastreioGuardado } from "@/lib/meta/rastreio";

/**
 * Guarda cookies, navegador e ip do lead na criacao, para os eventos do quadro
 * poderem sair como evento de site e voltar ao anuncio dias depois.
 *
 * UPDATE separado, dentro do after(), e nao um campo a mais no INSERT: se a
 * coluna `rastreio` ainda nao existir no banco (schema.sql aplicado a mao), o
 * INSERT inteiro falharia e o formulario pararia de criar lead. Assim, o pior
 * caso e so perder a atribuicao.
 */
export async function guardarRastreio(leadId: string, rastreio: RastreioGuardado): Promise<void> {
  if (!rastreio.fbp && !rastreio.fbc && !rastreio.ua) return;
  try {
    const { error } = await supabaseAdmin().from("leads").update({ rastreio }).eq("id", leadId);
    if (error) console.error("[meta] falha ao guardar rastreio (o lead NAO foi afetado)", error.message);
  } catch (e) {
    console.error("[meta] falha ao guardar rastreio (o lead NAO foi afetado)", e);
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
export async function enviarEventoDeStatus(leadId: string, status: Status): Promise<void> {
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
      console.error(`[meta] nao consegui ler o lead para ${status}`, error?.message ?? "nao encontrado");
      return;
    }

    const evento = montarEventoDeStatus(leadId, lead as LinhaLead, status);
    if (evento) await enviarConversao(evento);
  } catch (e) {
    console.error(`[meta] falha no evento de ${status} (o painel NAO foi afetado)`, e);
  }
}
