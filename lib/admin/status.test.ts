import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATALHOS_STATUS,
  MENSAGEM_RECUSA,
  estadoDoAtalho,
  mensagemConfirmacaoDeEnvio,
  pedeConfirmacaoDeEnvio,
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

test("marcar como enviado so pergunta quando nada foi enviado de fato", () => {
  assert.equal(pedeConfirmacaoDeEnvio("enviado", null), true);
  assert.equal(pedeConfirmacaoDeEnvio("enviado", "2026-10-01T12:00:00Z"), false);
  assert.equal(pedeConfirmacaoDeEnvio("virou_cliente", null), false);
  assert.match(mensagemConfirmacaoDeEnvio("Ana e João"), /^Marcar a proposta de Ana e João como enviada\?\n\nIsso só muda a coluna\. Nenhum e-mail sai daqui\.$/);
});
