import "server-only";
import type {
  Aviso,
  DadosContrato,
  DocumentoContrato,
  PosicaoAssinatura,
  RegistroContrato,
} from "@/lib/contrato/tipos";
import {
  caminhoRascunho,
  guardarPdf,
  lerRegistro,
  salvarRegistro,
  sha256Hex,
  type CondicaoEscrita,
  type PatchContrato,
} from "@/lib/supabase/contratos";
import { ALTERADO_EM_OUTRA_ABA, Recusa, SEM_PDF, STATUS_EDITAVEIS, recusarSeTravado } from "./_comum";

// As escritas que dependem do TEXTO que a rota leu: o texto editado, o PDF
// desenhado a partir dele e o texto redigido de novo.
//
// Todas sao guardadas pelo `updated_at` lido, alem do status. So o status nao
// bastava: duas abas (celular e notebook), a Mel salva uma clausula numa
// enquanto a outra termina "Gerar PDF", e o registro ficava em "pdf_gerado"
// com o texto novo e o PDF (e o sha256) do texto anterior. O envio conferia o
// sha, que batia com o PDF velho, e mandava ao cliente um contrato diferente
// do que a Mel via no painel.
//
// Fora do `route.ts` para o teste simular essas duas abas com um banco falso.

export type IoContrato = {
  ler: (leadId: string) => Promise<RegistroContrato | null>;
  salvar: (leadId: string, patch: PatchContrato, condicao?: CondicaoEscrita) => Promise<RegistroContrato | null>;
  guardarPdf: (caminho: string, bytes: Uint8Array, opcoes: { substituir: boolean }) => Promise<"gravado" | "ja_existia">;
};

export const IO_BANCO: IoContrato = { ler: lerRegistro, salvar: salvarRegistro, guardarPdf };

/** As duas leituras vem do banco (jsonb), entao a ordem das chaves e a mesma. */
const mesmoJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Relê o registro e confirma que ele ainda pode receber o que a rota calculou
 * antes: nao travou (enviado/assinado) e os campos de que a escrita depende
 * (`esperado`) sao os mesmos. Devolve a releitura, cujo `updated_at` guarda a
 * escrita seguinte -- da releitura ate o UPDATE, qualquer escrita no meio vira
 * 409 em vez de ser sobrescrita.
 *
 * Uma escrita que nao mexe no que importa (os avisos da revisao da IA,
 * terminando em outra aba) passa: comparar so o `updated_at` da primeira
 * leitura derrubaria a redacao inteira por causa de um aviso.
 */
async function releituraCompativel(
  id: string,
  esperado: Partial<Pick<RegistroContrato, "documento" | "dados">>,
  io: IoContrato,
): Promise<RegistroContrato> {
  const agora = await io.ler(id);
  if (!agora) throw new Recusa(409, ALTERADO_EM_OUTRA_ABA);
  recusarSeTravado(agora.status);
  const campos = Object.keys(esperado) as (keyof typeof esperado)[];
  if (campos.some((campo) => !mesmoJson(agora[campo], esperado[campo]))) {
    throw new Recusa(409, ALTERADO_EM_OUTRA_ABA);
  }
  return agora;
}

/**
 * Grava o texto que a Mel editou, calculado sobre `lido`.
 *
 * Guardado pelo `updated_at` de `lido`: o novo texto saiu de `lido.documento`,
 * e qualquer escrita depois dele (outra aba editando, ou gerando o PDF) faz
 * esta virar 409. E SEMPRE zera o PDF e volta a "redigido": texto novo, PDF
 * nenhum -- sem depender do status que a rota leu.
 */
export async function gravarTextoEditado(
  id: string,
  lido: RegistroContrato,
  documento: DocumentoContrato,
  io: IoContrato = IO_BANCO,
): Promise<RegistroContrato> {
  const registro = await io.salvar(
    id,
    { documento, status: "redigido", ...SEM_PDF },
    { status: STATUS_EDITAVEIS, atualizadoEm: lido.updated_at },
  );
  if (!registro) throw new Recusa(409, ALTERADO_EM_OUTRA_ABA);
  return registro;
}

/**
 * Registra o PDF recem-desenhado a partir de `documento`.
 *
 * Relê antes de subir o arquivo: se o texto mudou (ou o contrato foi para
 * assinatura) enquanto o PDF era desenhado, este PDF ja nasceu velho e nem
 * chega ao bucket. Depois do upload, a gravacao e guardada pelo `updated_at`
 * da releitura -- um texto editado DURANTE o upload tambem vira 409, e o
 * registro nunca fica em "pdf_gerado" com o PDF de outro texto.
 */
export async function gravarPdfGerado(
  id: string,
  documento: DocumentoContrato,
  pdf: { bytes: Uint8Array; posicoes: PosicaoAssinatura[] },
  io: IoContrato = IO_BANCO,
): Promise<RegistroContrato> {
  const antes = await releituraCompativel(id, { documento }, io);

  const pdf_path = caminhoRascunho(id);
  await io.guardarPdf(pdf_path, pdf.bytes, { substituir: true });

  const registro = await io.salvar(
    id,
    {
      pdf_path,
      pdf_sha256: sha256Hex(pdf.bytes),
      pdf_gerado_em: new Date().toISOString(),
      posicoes_assinatura: pdf.posicoes,
      status: "pdf_gerado",
    },
    { status: STATUS_EDITAVEIS, atualizadoEm: antes.updated_at },
  );
  if (!registro) throw new Recusa(409, ALTERADO_EM_OUTRA_ABA);
  return registro;
}

/**
 * Grava o texto montado pela redacao ("Gerar texto do contrato").
 *
 * `base` e o registro logo depois de a rota salvar os dados, ANTES da IA
 * (que leva de segundos a minutos). Se nesse meio tempo outra aba mudou os
 * dados ou o texto, o texto montado aqui e de uma versao que nao existe mais:
 * 409, e nada e gravado. Zera o PDF e a revisao: eram de outro texto.
 */
export async function gravarTextoRedigido(
  id: string,
  base: RegistroContrato,
  novo: { documento: DocumentoContrato; avisos: Aviso[]; dados?: DadosContrato },
  io: IoContrato = IO_BANCO,
): Promise<RegistroContrato> {
  const agora = await releituraCompativel(id, { dados: base.dados, documento: base.documento }, io);
  const registro = await io.salvar(
    id,
    {
      // Os dados so voltam aqui quando a redacao os completou (a interpretacao
      // do pagamento personalizado): gravados junto do texto que sai deles.
      ...(novo.dados ? { dados: novo.dados } : {}),
      documento: novo.documento,
      avisos: novo.avisos,
      status: "redigido",
      redigido_em: new Date().toISOString(),
      // A revisao anterior era de outro texto.
      revisado_em: null,
      ...SEM_PDF,
    },
    { status: STATUS_EDITAVEIS, atualizadoEm: agora.updated_at },
  );
  if (!registro) throw new Recusa(409, ALTERADO_EM_OUTRA_ABA);
  return registro;
}
