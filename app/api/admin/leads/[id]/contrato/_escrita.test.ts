import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Hex } from "@/lib/supabase/contratos";
import { ALTERADO_EM_OUTRA_ABA, Recusa, STATUS_EDITAVEIS } from "./_comum";
import { gravarPdfGerado, gravarTextoEditado, gravarTextoRedigido } from "./_escrita";
import {
  ID,
  bancoFalso,
  dadosFicticios,
  documentoFicticio,
  pdfBateComOTexto,
  pdfDe,
} from "./_teste-banco";

// Duas abas do painel (celular e notebook) escrevendo no mesmo contrato. O
// banco falso troca o `updated_at` a cada escrita, como o trigger, e os
// ganchos encaixam a "outra aba" entre a leitura e a escrita de uma rota.
// Tudo ficticio.

const V1 = documentoFicticio("Texto da primeira versão.");
const V2 = documentoFicticio("Texto editado na outra aba.");

function recusa(status: number, mensagem: string | RegExp) {
  return (e: unknown) => {
    assert.ok(e instanceof Recusa, `esperava Recusa, veio ${String(e)}`);
    assert.equal(e.status, status);
    if (typeof mensagem === "string") assert.equal(e.message, mensagem);
    else assert.match(e.message, mensagem);
    return true;
  };
}

// ----------------------------------------------------------- texto x PDF --

test("texto salvo em outra aba DURANTE o upload do PDF: o PDF não é registrado sobre o texto novo", async () => {
  const banco = bancoFalso({ status: "redigido", documento: V1 });
  const lidoPeloPdf = await banco.io.ler(ID);
  const lidoPeloEditor = await banco.io.ler(ID);

  // A aba do editor salva enquanto a outra ainda sobe o PDF da v1.
  banco.noProximoUpload(() => gravarTextoEditado(ID, lidoPeloEditor!, V2, banco.io));

  await assert.rejects(
    gravarPdfGerado(ID, lidoPeloPdf!.documento!, pdfDe(V1), banco.io),
    recusa(409, ALTERADO_EM_OUTRA_ABA),
  );
  const linha = banco.linha;
  assert.deepEqual(linha.documento, V2);
  assert.equal(linha.status, "redigido");
  assert.equal(linha.pdf_sha256, null);
  assert.ok(pdfBateComOTexto(linha));
});

test("PDF gerado em outra aba entre a leitura e a gravação do texto: o texto não é gravado por cima", async () => {
  const banco = bancoFalso({ status: "redigido", documento: V1 });
  const lidoPeloEditor = await banco.io.ler(ID);

  await gravarPdfGerado(ID, V1, pdfDe(V1), banco.io);
  assert.equal(banco.linha.status, "pdf_gerado");

  await assert.rejects(gravarTextoEditado(ID, lidoPeloEditor!, V2, banco.io), recusa(409, ALTERADO_EM_OUTRA_ABA));
  const linha = banco.linha;
  // Continua coerente: o PDF registrado e o do texto registrado.
  assert.deepEqual(linha.documento, V1);
  assert.equal(linha.pdf_sha256, sha256Hex(pdfDe(V1).bytes));
  assert.ok(pdfBateComOTexto(linha));
});

test("texto editado sempre derruba o PDF e volta a “redigido”", async () => {
  const banco = bancoFalso({ status: "redigido", documento: V1 });
  await gravarPdfGerado(ID, V1, pdfDe(V1), banco.io);
  const lido = await banco.io.ler(ID);

  const r = await gravarTextoEditado(ID, lido!, V2, banco.io);
  assert.equal(r.status, "redigido");
  assert.deepEqual(r.documento, V2);
  const linha = banco.linha;
  assert.equal(linha.pdf_path, null);
  assert.equal(linha.pdf_sha256, null);
  assert.equal(linha.pdf_gerado_em, null);
  assert.equal(linha.posicoes_assinatura, null);
});

test("PDF desenhado sobre um texto que mudou antes da releitura nem chega ao bucket", async () => {
  const banco = bancoFalso({ status: "redigido", documento: V1 });
  const lidoPeloPdf = await banco.io.ler(ID);
  await gravarTextoEditado(ID, (await banco.io.ler(ID))!, V2, banco.io);

  await assert.rejects(
    gravarPdfGerado(ID, lidoPeloPdf!.documento!, pdfDe(V1), banco.io),
    recusa(409, ALTERADO_EM_OUTRA_ABA),
  );
  assert.equal(banco.arquivos.size, 0);
});

test("contrato enviado para assinatura enquanto o PDF era desenhado: o rascunho não é sobrescrito", async () => {
  const banco = bancoFalso({ status: "redigido", documento: V1 });
  const lidoPeloPdf = await banco.io.ler(ID);
  banco.deFora({ status: "enviado" });

  await assert.rejects(
    gravarPdfGerado(ID, lidoPeloPdf!.documento!, pdfDe(V1), banco.io),
    recusa(409, /aguardando assinaturas/),
  );
  assert.equal(banco.arquivos.size, 0);
  assert.equal(banco.linha.status, "enviado");
});

test("aviso da revisão gravado em outra aba não derruba o PDF: o texto é o mesmo", async () => {
  const banco = bancoFalso({ status: "redigido", documento: V1 });
  const lidoPeloPdf = await banco.io.ler(ID);
  banco.deFora({ avisos: [{ origem: "ia", gravidade: "sugestao", texto: "Aviso fictício da revisão." }] });

  const r = await gravarPdfGerado(ID, lidoPeloPdf!.documento!, pdfDe(V1), banco.io);
  assert.equal(r.status, "pdf_gerado");
  assert.ok(pdfBateComOTexto(banco.linha));
});

// ------------------------------------------------------------- redacao --

async function redacaoEmAndamento() {
  const banco = bancoFalso({ status: "redigido", documento: V1, dados: dadosFicticios("antes") });
  // A rota de redacao salvou os dados e agora espera a IA.
  const salvo = await banco.io.salvar(ID, { dados: dadosFicticios("observação nova") }, { status: STATUS_EDITAVEIS });
  assert.ok(salvo);
  return { banco, salvo };
}

const REDIGIDO = { documento: documentoFicticio("Texto redigido de novo."), avisos: [] };

test("texto editado em outra aba durante a IA: a redação não é gravada por cima", async () => {
  const { banco, salvo } = await redacaoEmAndamento();
  await gravarTextoEditado(ID, (await banco.io.ler(ID))!, V2, banco.io);

  await assert.rejects(gravarTextoRedigido(ID, salvo, REDIGIDO, banco.io), recusa(409, ALTERADO_EM_OUTRA_ABA));
  assert.deepEqual(banco.linha.documento, V2);
});

test("dados salvos em outra aba durante a IA: o texto montado com os dados velhos não é gravado", async () => {
  const { banco, salvo } = await redacaoEmAndamento();
  banco.deFora({ dados: dadosFicticios("mudei na outra aba") });

  await assert.rejects(gravarTextoRedigido(ID, salvo, REDIGIDO, banco.io), recusa(409, ALTERADO_EM_OUTRA_ABA));
  assert.deepEqual(banco.linha.documento, V1);
});

test("escrita entre a releitura e a gravação da redação também vira 409", async () => {
  const { banco, salvo } = await redacaoEmAndamento();
  banco.depoisDaProximaLeitura(() => banco.deFora({ dados: dadosFicticios("no último instante") }));

  await assert.rejects(gravarTextoRedigido(ID, salvo, REDIGIDO, banco.io), recusa(409, ALTERADO_EM_OUTRA_ABA));
  assert.deepEqual(banco.linha.documento, V1);
});

test("aviso da revisão gravado durante a IA não derruba a redação; o PDF e a revisão velhos saem", async () => {
  const { banco, salvo } = await redacaoEmAndamento();
  await gravarPdfGerado(ID, V1, pdfDe(V1), banco.io);
  banco.deFora({ revisado_em: "2026-09-30T12:30:00.000Z" });

  // O PDF gerado mudou o status, mas nao o texto nem os dados: segue.
  const r = await gravarTextoRedigido(ID, salvo, REDIGIDO, banco.io);
  assert.equal(r.status, "redigido");
  assert.deepEqual(r.documento, REDIGIDO.documento);
  assert.equal(r.revisado_em, null);
  assert.equal(r.pdf_sha256, null);
  assert.equal(banco.linha.pdf_path, null);
});
