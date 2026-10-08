import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUS } from "@/lib/form/types";
import { textoExclusao, linkContatoInicial, avisoPropostaEnviada } from "./acoes";

test("exclusão no quadro: contrato desconhecido avisa sobre assinado, trilha e envio aberto", () => {
  const texto = textoExclusao("Ana e João", null, true);
  assert.match(texto, /^Excluir o lead Ana e João\?/);
  assert.match(texto, /proposta em PDF/);
  assert.match(texto, /CONTRATO ASSINADO/);
  assert.match(texto, /trilha de auditoria/);
  assert.match(texto, /cancela um envio para assinatura ainda aberto/);
  assert.match(texto, /baixe as cópias antes/);
  assert.match(texto, /Não dá para desfazer\./);
});

test("exclusão no detalhe informa os arquivos e ações conforme o contrato conhecido", () => {
  const semContrato = textoExclusao("", null, false);
  assert.match(semContrato, /lead sem nome/);
  assert.doesNotMatch(semContrato, /contrato/i);
  for (const estado of ["rascunho", "redigido", "pdf_gerado"] as const) {
    assert.match(textoExclusao("Ana", estado, false), /contrato \(dados, texto e PDF\)/);
  }
  assert.match(textoExclusao("Ana", "enviado", false), /cancela o envio para assinatura/);
  assert.match(textoExclusao("Ana", "assinado", false), /CONTRATO ASSINADO, com a trilha de auditoria/);
  // A leitura falhou: não confiar no último estado que a tela conhecia.
  assert.match(textoExclusao("Ana", "rascunho", true), /CONTRATO ASSINADO/);
});

test("contato inicial só abre a conversa vazia de um lead de Novo com telefone BR válido", () => {
  for (const status of STATUS) {
    assert.equal(
      linkContatoInicial(status, "(19) 99999-8888"),
      status === "incompleto" ? "https://wa.me/5519999998888" : null,
      status,
    );
  }
  assert.equal(linkContatoInicial("incompleto", "+55 (19) 99999-8888"), "https://wa.me/5519999998888");
  assert.equal(linkContatoInicial("incompleto", "(11) 3333-4444"), "https://wa.me/551133334444");
  for (const telefone of [null, undefined, "", "   ", "123", "telefone", "00999998888", "19899998888"]) {
    assert.equal(linkContatoInicial("incompleto", telefone), null, String(telefone));
  }
});

test("toast de envio diferencia simulação e e-mail efetivamente enviado", () => {
  const simulado = avisoPropostaEnviada("Ana", true);
  assert.equal(simulado.tipo, "warning");
  assert.match(simulado.texto, /não enviado/);
  assert.doesNotMatch(simulado.texto, /Proposta enviada/);
  assert.deepEqual(avisoPropostaEnviada("Ana", false), { tipo: "success", texto: "Proposta enviada para Ana." });
  assert.deepEqual(avisoPropostaEnviada("", false), { tipo: "success", texto: "Proposta enviada para o lead." });
});
