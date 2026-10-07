import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUS, type Status } from "@/lib/form/types";
import {
  ATALHOS_STATUS,
  MENSAGEM_RECUSA,
  estadoDoAtalho,
  mensagemConfirmacaoDeEnvio,
  pedeConfirmacaoDeEnvio,
  proximoPasso,
  recusarMovimento,
} from "./status";

test("atalhos do detalhe: enviado, cliente e perdido, nesta ordem", () => {
  assert.deepEqual([...ATALHOS_STATUS], ["enviado", "virou_cliente", "perdido"]);
});

test("o atalho da coluna em que o lead ja esta aparece como atual, sem bloqueio", () => {
  assert.deepEqual(estadoDoAtalho("enviado", "enviado", { temProposta: true }), { atual: true, bloqueio: null });
  assert.deepEqual(estadoDoAtalho("perdido", "perdido", { temProposta: false }), { atual: true, bloqueio: null });
});

test("'Enviado' sem proposta e bloqueado com a mesma frase do quadro; cliente e perdido nao", () => {
  assert.deepEqual(estadoDoAtalho("aguardando_revisao", "enviado", { temProposta: false }), {
    atual: false,
    bloqueio: MENSAGEM_RECUSA.sem_proposta,
  });
  // Da para fechar negocio no telefone antes de qualquer proposta formal.
  assert.deepEqual(estadoDoAtalho("incompleto", "virou_cliente", { temProposta: false }), { atual: false, bloqueio: null });
  assert.deepEqual(estadoDoAtalho("incompleto", "perdido", { temProposta: false }), { atual: false, bloqueio: null });
  assert.deepEqual(estadoDoAtalho("aguardando_revisao", "enviado", { temProposta: true }), { atual: false, bloqueio: null });
});

test("proximo passo: Novo e revisao vao para Enviado, Enviado, Esfriou e perdido para cliente, cliente e o fim", () => {
  assert.equal(proximoPasso("incompleto"), "enviado");
  assert.equal(proximoPasso("aguardando_revisao"), "enviado");
  assert.equal(proximoPasso("enviado"), "virou_cliente");
  assert.equal(proximoPasso("esfriou"), "virou_cliente");
  assert.equal(proximoPasso("perdido"), "virou_cliente");
  assert.equal(proximoPasso("virou_cliente"), null);
});

test("o proximo passo nunca e a coluna atual, nunca e perdido e so pode esbarrar na falta de proposta", () => {
  for (const de of STATUS) {
    const para = proximoPasso(de);
    if (!para) continue;
    assert.notEqual(para, de);
    assert.notEqual(para, "perdido" as Status);
    // Com proposta, a matriz do quadro sempre deixa: o botao verde nunca
    // aparece travado por uma regra que nao seja "gere a proposta antes".
    assert.equal(recusarMovimento(de, para, { temProposta: true }), null, `${de} -> ${para}`);
  }
});

test("marcar como enviado so pergunta quando nada foi enviado de fato", () => {
  assert.equal(pedeConfirmacaoDeEnvio("enviado", null), true);
  assert.equal(pedeConfirmacaoDeEnvio("enviado", "2026-10-01T12:00:00Z"), false);
  assert.equal(pedeConfirmacaoDeEnvio("virou_cliente", null), false);
  assert.match(mensagemConfirmacaoDeEnvio("Ana e João"), /^Marcar a proposta de Ana e João como enviada\?\n\nIsso só muda a coluna\. Nenhum e-mail sai daqui\.$/);
});
