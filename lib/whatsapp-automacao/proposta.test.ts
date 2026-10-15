import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { sequenciaLembreteProposta } from "./lembretes-proposta";
import { envelopeJob, resultadoSchema } from "./contrato";
import { criarRepositorioWhatsApp } from "./index";
import { solicitarLembreteProposta } from "./solicitar-proposta";

const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const LEASE = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
const LINK = "https://crm.invalid/p/a3f9";
const ambiente = { WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_LEMBRETE_PROPOSTA_ATIVO: "true" };
const activity = { checkedAt: "2026-10-15T12:00:00Z", coverageStartedAt: "2026-09-15T12:00:00Z", lastInteractionAt: null, complete: true };
const linha = (marco: 7 | 30) => {
  const sequencia = sequenciaLembreteProposta(marco, LINK);
  return { id: ID, lease_token: LEASE, destinatario: "5519988887777", mensagem: sequencia.map((p) => p.message).join("\n\n"),
    expira_em: "2026-10-16T12:00:00Z", tipo: marco === 7 ? "lembrete_proposta_7d" : "lembrete_proposta_30d", sequencia };
};
function transporte(responder: (nome: string, corpo: Record<string, unknown>) => unknown) {
  const chamadas: { nome: string; corpo: Record<string, unknown> }[] = [];
  const db = createClient("https://propostas-ficticias.invalid", "credencial-ficticia", {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.hostname, "propostas-ficticias.invalid", "rede real proibida");
      const nome = url.pathname.split("/").at(-1)!;
      const corpo = init?.body ? JSON.parse(String(init.body)) : {};
      chamadas.push({ nome, corpo });
      return Response.json(responder(nome, corpo));
    } },
  });
  return { db, chamadas };
}

test("propostas têm quatro/cinco mensagens e pausas exatas, sem juntar o link ao texto", () => {
  assert.deepEqual(sequenciaLembreteProposta(7, LINK).map((p) => p.delayBeforeSeconds), [0, 2, 3, 2]);
  assert.deepEqual(sequenciaLembreteProposta(30, LINK).map((p) => p.delayBeforeSeconds), [0, 4, 4, 3, 5]);
  assert.equal(sequenciaLembreteProposta(7, LINK)[2].message, LINK);
  assert.equal(sequenciaLembreteProposta(30, LINK)[1].message, LINK);
});

test("apenas protocolo3 entrega proposta; rejeita copy/pausa/link diferente", () => {
  for (const marco of [7, 30] as const) {
    const l = linha(marco);
    assert.throws(() => envelopeJob(l, 1));
    assert.throws(() => envelopeJob(l, 2));
    const job = envelopeJob({ ...l, telefone_privado: "não-vazar" }, 3);
    assert.equal(job.tipo, l.tipo);
    assert.ok(!JSON.stringify(job).includes("não-vazar"));
    for (const sequencia of [l.sequencia.slice(1), l.sequencia.map((p, i) => i === 0 ? { ...p, message: "Texto não aprovado" } : p),
      l.sequencia.map((p, i) => i === 1 ? { ...p, delayBeforeSeconds: 0 } : p)]) {
      assert.throws(() => envelopeJob({ ...l, sequencia }, 3));
    }
  }
  for (const link of ["http://crm.invalid/p/a3f9", "https://user:senha@crm.invalid/p/a3f9", "Clique: https://crm.invalid/p/a3f9", "https://crm.invalid/p/a3f9#x"]) {
    assert.throws(() => sequenciaLembreteProposta(7, link));
  }
});

test("prova de atividade contém apenas timestamps e completude, sem conteúdo de conversa", () => {
  assert.equal(resultadoSchema.safeParse({ leaseToken: LEASE, outcome: "started", activity }).success, true);
  assert.equal(resultadoSchema.safeParse({ leaseToken: LEASE, outcome: "started", activity: { ...activity, message: "conteúdo privado" } }).success, false);
  assert.equal(resultadoSchema.safeParse({ leaseToken: LEASE, outcome: "started", activity: { ...activity, checkedAt: "ontem" } }).success, false);
});

test("fila de proposta nunca nasce do polling: V4 só reivindica o clique já registrado", async () => {
  const { db, chamadas } = transporte((nome) => { assert.equal(nome, "reivindicar_whatsapp_v4"); return [linha(7)]; });
  const repositorio = criarRepositorioWhatsApp(db, { ambiente, protocolo: 3 });
  assert.equal((await repositorio.reivindicar())?.tipo, "lembrete_proposta_7d");
  assert.deepEqual(chamadas, [{ nome: "reivindicar_whatsapp_v4", corpo: {
    p_formulario_ativo: false, p_inicio_em: null, p_propostas_ativo: true,
  } }]);
});

test("started leva prova ao banco e ACK V4 continua aceito depois de pausar", async () => {
  const amb = { ...ambiente };
  const { db, chamadas } = transporte((nome, corpo) => {
    assert.equal(nome, "resultado_whatsapp_v4");
    return corpo.p_outcome === "started" ? "enviando" : "enviado";
  });
  const repositorio = criarRepositorioWhatsApp(db, { ambiente: amb, protocolo: 3 });
  await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "started", activity });
  assert.equal(chamadas[0].corpo.p_historico_completo, true);
  assert.equal(chamadas[0].corpo.p_historico_cobertura_inicio_em, activity.coverageStartedAt);
  amb.WHATSAPP_AUTOMACAO_ATIVA = "false";
  assert.equal(await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "started", activity }), null);
  assert.equal(await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "sent" }), "enviado");
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[1].corpo.p_propostas_ativo, false);
});

test("solicitação pausada não consulta banco; clique ativo envia só IDs e revisão", async () => {
  const revisao = "2026-09-01T12:00:00Z";
  const { db, chamadas } = transporte((nome) => nome === "leads" ? { enviado_em: revisao }
    : { id: ID, estado: "pendente", reutilizado: false });
  const entrada = { id: ID, marco: 7 as const, solicitante: LEASE };
  assert.equal((await solicitarLembreteProposta(db, entrada, {})).status, 503);
  assert.equal(chamadas.length, 0);
  assert.equal((await solicitarLembreteProposta(db, entrada, ambiente)).status, 202);
  assert.deepEqual(chamadas[1], { nome: "enfileirar_lembrete_proposta_whatsapp", corpo: {
    p_lead_id: ID, p_marco: 7, p_proposta_enviado_em: revisao, p_solicitado_por: LEASE,
  } });
});

test("clique de outra aba após ACK devolve Enviado para desabilitar o botão", async () => {
  for (const marco of [7, 30] as const) {
    const { db, chamadas } = transporte((nome) => nome === "leads"
      ? { enviado_em: "2026-09-01T12:00:00Z" } : { erro: "ja_enviado" });
    const resultado = await solicitarLembreteProposta(db, { id: ID, marco, solicitante: LEASE }, ambiente);
    assert.deepEqual(resultado, { status: 200, corpo: { ok: true, estado: "enviado" } });
    assert.equal(chamadas.filter((c) => c.nome === "enfileirar_lembrete_proposta_whatsapp").length, 1);
  }
});
