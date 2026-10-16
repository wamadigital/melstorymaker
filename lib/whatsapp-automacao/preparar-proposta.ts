import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { passosVisiveis } from "@/lib/form/engine";
import { validarPassos, somenteDigitos } from "@/lib/form/validacao";
import { CATEGORIAS } from "@/lib/form/types";
import { nomeContato } from "@/lib/leads";
import { gerarProposta, ArteFaltandoError, CamposFaltandoError } from "@/lib/pdf/gerar";
import { BUCKET_PROPOSTAS, garantirSlug, urlPublicaProposta } from "@/lib/supabase/admin";
import { sequenciaPropostaInicial } from "./proposta-inicial";

const preparoSchema = z.object({
  lead_id: z.string().uuid(), lease_token: z.string().uuid(),
  categoria: z.enum(CATEGORIAS), respostas: z.record(z.string(), z.string()),
  destinatario: z.string().regex(/^55\d{10,11}$/).nullable(),
});
class PreparoRecusado extends Error {}

/** A reserva do banco vence em 90s. Upload imutável não sobrescreve a proposta manual. */
export async function prepararUmaPropostaAutomatica(
  db: SupabaseClient,
  dependencias: {
    gerar?: typeof gerarProposta;
    slug?: (id: string) => Promise<string>;
    url?: (slug: string) => string;
    hoje?: () => Date;
  } = {},
): Promise<void> {
  const { data, error } = await db.rpc("reivindicar_preparo_proposta_whatsapp", { p_ativo: true })
    .abortSignal(AbortSignal.timeout(5_000));
  if (error) throw new Error("claim_preparo_proposta");
  if (!data?.[0]) return;
  const p = preparoSchema.parse(data[0]);
  const arquivo = `automaticas/${p.lead_id}/${p.lease_token}.pdf`;
  let definitivo = false;
  try {
    const respostas = p.respostas;
    const erros = validarPassos(passosVisiveis(p.categoria, respostas), respostas, (dependencias.hoje ?? (() => new Date()))());
    let telefone = somenteDigitos(respostas.contato_whatsapp ?? "");
    if (!telefone.startsWith("55") || telefone.length < 12) telefone = `55${telefone}`;
    if (Object.keys(erros).length || !p.destinatario || telefone !== p.destinatario) {
      throw new PreparoRecusado("respostas_invalidas");
    }
    const nome = nomeContato(respostas);
    // Valida nome antes de renderizar, reservar link ou subir um arquivo.
    sequenciaPropostaInicial(nome, "https://validacao.invalid/p/a3f9");
    const resultado = await (dependencias.gerar ?? gerarProposta)(p.categoria, respostas);
    if (resultado.usouPlaceholder || resultado.usouFallbackDeFonte || resultado.bytes.length > 5 * 1024 * 1024) {
      throw new PreparoRecusado("arte_nao_final");
    }
    const slug = await (dependencias.slug ?? ((id: string) => garantirSlug(id, db)))(p.lead_id);
    const link = (dependencias.url ?? urlPublicaProposta)(slug);
    sequenciaPropostaInicial(nome, link);
    const { error: upload } = await db.storage.from(BUCKET_PROPOSTAS).upload(arquivo, resultado.bytes,
      { contentType: "application/pdf", upsert: false });
    if (upload) throw new Error("upload_proposta");
    const { data: salvo, error: gravacao } = await db.rpc("concluir_preparo_proposta_whatsapp", {
      p_lead_id: p.lead_id, p_token: p.lease_token, p_nome: nome, p_link: link, p_arquivo: arquivo,
    }).abortSignal(AbortSignal.timeout(5_000));
    // Resposta perdida pode significar COMMIT concluído. Nesse caso nunca
    // apagar o objeto: ele já pode estar publicado e enfileirado para envio.
    if (gravacao) throw new Error("resultado_preparo_desconhecido");
    if (salvo === false) {
      await db.storage.from(BUCKET_PROPOSTAS).remove([arquivo]);
      return;
    }
    if (salvo !== true) throw new Error("resultado_preparo_invalido");
  } catch (erro) {
    definitivo = erro instanceof PreparoRecusado || erro instanceof ArteFaltandoError ||
      erro instanceof CamposFaltandoError || (erro instanceof Error && erro.message === "snapshot_proposta_inicial_invalido");
    const codigo = definitivo ? "dados_ou_arte_invalidos" : "falha_preparo";
    const { error: falha } = await db.rpc("falhar_preparo_proposta_whatsapp", {
      p_lead_id: p.lead_id, p_token: p.lease_token, p_codigo: codigo, p_definitivo: definitivo,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (falha) throw new Error("registro_falha_preparo");
    // Só código fixo: nunca nomes, respostas, telefone ou conteúdo do SDK.
    console.warn("[whatsapp:proposta]", codigo);
  }
}
