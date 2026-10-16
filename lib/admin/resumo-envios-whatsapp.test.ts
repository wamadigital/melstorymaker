import assert from "node:assert/strict";
import { test } from "node:test";
import { historicoWhatsApp, resumoEnviosWhatsApp } from "./disparos-whatsapp";
import type { DisparoWhatsApp, LeadCartao } from "./tipos";

const ANTIGO = "2026-10-01T12:00:00Z";
const RECENTE = "2026-10-15T12:00:00Z";
const TIPOS = ["lembrete_formulario_24h", "proposta_inicial_15m", "lembrete_proposta_7d", "lembrete_proposta_30d"] as const;
const ROTULOS = ["Finalize o formulário", "Proposta comercial", "Lembrete após 7 dias", "Lembrete após 30 dias"];

test("resumo sem envios mantém as quatro mensagens atuais, na ordem do fluxo", () => {
  for (const lead of [{}, { disparos_whatsapp: [] }]) {
    const resumo = resumoEnviosWhatsApp(lead);
    assert.deepEqual(resumo.map(({ tipo }) => tipo), TIPOS);
    assert.deepEqual(resumo.map(({ rotulo }) => rotulo), ROTULOS);
    assert.ok(resumo.every(({ enviado }) => !enviado));
  }
});

test("cada combinação de ACKs marca somente seus tipos e mantém quatro linhas", () => {
  for (let combinacao = 0; combinacao < 16; combinacao++) {
    const disparos = TIPOS.filter((_, i) => combinacao & (1 << i))
      .map((tipo) => ({ tipo, enviado_em: RECENTE }));
    const resumo = resumoEnviosWhatsApp({ disparos_whatsapp: disparos });
    assert.equal(resumo.length, 4);
    assert.deepEqual(resumo.map(({ enviado }) => enviado), TIPOS.map((_, i) => Boolean(combinacao & (1 << i))));
    assert.equal(resumo.some(({ enviado }) => enviado), combinacao !== 0, "o ícone exige pelo menos um envio");
  }
});

test("contato manual, carimbos legados e confirmação retirada não marcam envios atuais", () => {
  const lead = {
    lembrete_7_em: RECENTE, lembrete_30_em: RECENTE, chamado_whatsapp_em: RECENTE,
    disparos_whatsapp: [{ tipo: "confirmacao_recebimento", enviado_em: RECENTE }] satisfies DisparoWhatsApp[],
  };
  const antes = historicoWhatsApp(lead);
  assert.equal(antes.length, 4, "o histórico anterior continua preservado para outros consumidores");
  assert.ok(resumoEnviosWhatsApp(lead).every(({ enviado }) => !enviado));
  assert.deepEqual(historicoWhatsApp(lead), antes);
});

test("revisão anterior, duplicatas e ordem dos ACKs não apagam nem duplicam um tipo enviado", () => {
  const disparos: DisparoWhatsApp[] = [
    { tipo: "lembrete_proposta_7d", enviado_em: RECENTE, proposta_enviado_em: ANTIGO },
    { tipo: "lembrete_formulario_24h", enviado_em: ANTIGO },
    { tipo: "lembrete_proposta_7d", enviado_em: ANTIGO, proposta_enviado_em: "2026-09-01T12:00:00Z" },
  ];
  const lead = { disparos_whatsapp: disparos, enviado_em: RECENTE, status: "virou_cliente" };
  const antes = JSON.stringify(lead);
  const esperado = resumoEnviosWhatsApp(lead);
  assert.deepEqual(esperado.map(({ enviado }) => enviado), [true, false, true, false]);
  assert.deepEqual(resumoEnviosWhatsApp({ disparos_whatsapp: [...disparos].reverse() }), esperado);
  assert.equal(JSON.stringify(lead), antes);
});

test("carimbos ilegíveis ou tipos desconhecidos não inventam entrega", () => {
  for (const enviado_em of [null, "", "não é data", "2026-10-15", "2026-02-30T12:00:00Z", "2026-10-15T12:00:00"]) {
    const lead = { disparos_whatsapp: [
      ...TIPOS.map((tipo) => ({ tipo, enviado_em })),
      { tipo: "tipo_futuro", enviado_em: RECENTE }, null,
    ] } as unknown as LeadCartao;
    assert.ok(resumoEnviosWhatsApp(lead).every(({ enviado }) => !enviado), String(enviado_em));
  }
});

test("solicitação na fila ou indeterminada ainda não é envio confirmado", () => {
  const lead = {
    solicitacoes_whatsapp: TIPOS.slice(1).map((tipo) => ({
      tipo, estado: "indeterminado", ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO, motivo: null,
    })),
    disparos_whatsapp: [],
  };
  assert.ok(resumoEnviosWhatsApp(lead).every(({ enviado }) => !enviado));
});
