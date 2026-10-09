import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validarTelefoneBr } from "@/lib/form/validacao";

type Ctx = { params: Promise<{ id: string }> };
type Dependencias = {
  sessao: () => Promise<unknown>;
  banco: () => SupabaseClient;
  agendar: (tarefa: () => Promise<void>) => void;
  enviar: (id: string) => Promise<void>;
};
type ErroBanco = { code?: string; message: string };

const corpo = z.object({
  qualificado: z.boolean(),
  base_qualificado_em: z.iso.datetime({ offset: true }).nullable(),
});
const CAMPOS = "id, qualificado_em, whatsapp";
const ALTERADO = "A qualificação mudou em outra tela. Confira a marcação e tente de novo.";
const CONTATO_ALTERADO = "O WhatsApp mudou em outra tela. Confira o contato antes de qualificar.";
const TELEFONE_INVALIDO = "Salve um WhatsApp válido antes de qualificar o lead.";

function falhaBanco(erro: ErroBanco) {
  // Log sem payload nem dados pessoais. Coluna/schema ausente não significa
  // que a marca foi salva: a atualização do banco precisa preceder o deploy.
  console.error(`[admin] falha na qualificação (${erro.code ?? "banco"})`);
  const schemaAusente = ["42703", "PGRST204", "42P01", "42883"].includes(erro.code ?? "");
  return NextResponse.json({
    erro: schemaAusente
      ? "A qualificação ainda não está disponível no banco. A atualização do sistema precisa ser concluída."
      : "Não consegui salvar a qualificação. Tente de novo em instantes.",
  }, { status: 503 });
}

/** Estado operacional separado do status do Kanban. Não altera respostas. */
export async function tratarQualificacao(req: Request, { params }: Ctx, io: Dependencias) {
  if (!(await io.sessao())) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
  }
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Payload inválido." }, { status: 400 });
  }
  const { qualificado, base_qualificado_em: base } = parsed.data;
  const db = io.banco();
  const { data: lead, error: erroLeitura } = await db
    .from("leads").select(CAMPOS).eq("id", id).maybeSingle();
  if (erroLeitura) return falhaBanco(erroLeitura);
  if (!lead) return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });

  // Repetir o mesmo desejo não muda timestamp nem gera outro evento. A fila
  // durável do CRM já foi registrada pelo trigger da primeira escrita.
  if (!!lead.qualificado_em === qualificado) {
    return NextResponse.json({ ok: true, qualificado_em: lead.qualificado_em });
  }
  const atual = lead.qualificado_em as string | null;
  // Postgres pode representar o mesmo instante com +00:00 ou Z.
  const mesmaBase = atual === base || (atual !== null && base !== null && Date.parse(atual) === Date.parse(base));
  if (!mesmaBase) {
    return NextResponse.json({ erro: ALTERADO, qualificado_em: atual }, { status: 409 });
  }
  if (qualificado && (!lead.whatsapp || validarTelefoneBr(lead.whatsapp))) {
    return NextResponse.json({ erro: TELEFONE_INVALIDO }, { status: 422 });
  }

  let escrita = db.from("leads")
    .update({ qualificado_em: qualificado ? new Date().toISOString() : null })
    .eq("id", id);
  // Sem updated_at ou status no guard: um autosave de outras respostas,
  // lembrete ou mudança de raia não invalida nem é sobrescrito por esta ação.
  escrita = atual === null ? escrita.is("qualificado_em", null) : escrita.eq("qualificado_em", atual);
  // O contato validado também precisa continuar sendo o mesmo no UPDATE.
  // Não restringir ao desmarcar: essa ação continua disponível sem telefone.
  if (qualificado) escrita = escrita.eq("whatsapp", lead.whatsapp);
  const { data: salvo, error } = await escrita.select("qualificado_em").maybeSingle();
  if (error) return falhaBanco(error);
  if (!salvo) {
    const { data: novo, error: erroReleitura } = await db
      .from("leads").select("qualificado_em, whatsapp").eq("id", id).maybeSingle();
    if (erroReleitura) return falhaBanco(erroReleitura);
    if (!novo) return NextResponse.json({ erro: "Lead não encontrado." }, { status: 404 });
    if (qualificado && (!novo.whatsapp || validarTelefoneBr(novo.whatsapp))) {
      return NextResponse.json({ erro: TELEFONE_INVALIDO }, { status: 422 });
    }
    return NextResponse.json({
      erro: qualificado && novo.whatsapp !== lead.whatsapp ? CONTATO_ALTERADO : ALTERADO,
      qualificado_em: novo.qualificado_em,
    }, { status: 409 });
  }

  // Só depois da gravação atômica. Desmarcar revoga a marca operacional,
  // sem inventar abandono ou desfazer um evento histórico já ocorrido.
  if (qualificado) io.agendar(() => io.enviar(id));
  return NextResponse.json({ ok: true, qualificado_em: salvo.qualificado_em });
}
