import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { nomeContato } from "@/lib/leads";
import type { Respostas, Status } from "@/lib/form/types";
import { EVENTO_DO_STATUS, idEvento } from "@/lib/meta/eventos";
import { configCapi, enviarConversao } from "@/lib/meta/conversoes";
import { rastreioGuardado, type Rastreio } from "@/lib/meta/rastreio";

/**
 * Guarda `fbp`/`fbc` do lead na criacao, para os eventos do quadro poderem
 * ligar a conversao ao anuncio dias depois.
 *
 * UPDATE separado, dentro do after(), e nao um campo a mais no INSERT: se a
 * coluna `rastreio` ainda nao existir no banco (schema.sql aplicado a mao), o
 * INSERT inteiro falharia e o formulario pararia de criar lead. Assim, o pior
 * caso e so perder a atribuicao.
 */
export async function guardarRastreio(leadId: string, rastreio: Rastreio): Promise<void> {
  if (!rastreio.fbp && !rastreio.fbc) return;
  try {
    const { error } = await supabaseAdmin().from("leads").update({ rastreio }).eq("id", leadId);
    if (error) console.error("[meta] falha ao guardar rastreio (o lead NAO foi afetado)", error.message);
  } catch (e) {
    console.error("[meta] falha ao guardar rastreio (o lead NAO foi afetado)", e);
  }
}

/**
 * Evento do quadro: a Mel levou o lead para `status`. Chamado depois que a
 * transicao ja foi GRAVADA -- nunca antes, senao um 409/422 viraria conversao
 * que nao aconteceu.
 *
 * Sem ip nem navegador de proposito: o request e o da Mel. O casamento com o
 * lead vem do telefone, do e-mail e do `fbc` guardado na criacao.
 */
export async function enviarEventoDeStatus(leadId: string, status: Status): Promise<void> {
  const nome = EVENTO_DO_STATUS[status];
  // Sem Meta configurada nem le o banco.
  if (!nome || !configCapi()) return;

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
      console.error(`[meta] nao consegui ler o lead para ${nome}`, error?.message ?? "nao encontrado");
      return;
    }

    await enviarConversao({
      nome,
      id: idEvento(status, leadId),
      origem: "system_generated",
      categoria: lead.categoria,
      pessoa: {
        leadId,
        email: lead.email,
        whatsapp: lead.whatsapp,
        nome: nomeContato((lead.respostas ?? {}) as Respostas),
        ...rastreioGuardado(lead.rastreio),
      },
    });
  } catch (e) {
    console.error(`[meta] falha no evento ${nome} (o painel NAO foi afetado)`, e);
  }
}
