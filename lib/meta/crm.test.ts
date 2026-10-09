import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  montarEventoCrm, processarFilaComDependencias, PRAZO_CRM_MS,
  type DependenciasFilaCrm, type EventoFilaCrm,
} from "./crm";
import { montarEvento, type EventoConversao, type ResultadoCapi } from "./conversoes";

const AGORA = Date.parse("2026-10-09T14:00:00Z");
const base: EventoFilaCrm = {
  event_id: "crm_qualificado_abc", lead_id: "abc", etapa: "qualificado", evento: "CRMLeadQualificado",
  ocorrido_em: new Date(AGORA - 60_000).toISOString(), tentativas: 1, lease_token: "lease1",
  snapshot: { categoria: "casamento", email: "ana@exemplo.invalid", whatsapp: "19999999999", nome: "Ana", rastreio: null },
};

function ambiente(linha = base, resposta: ResultadoCapi = { tipo: "aceito", recebidos: 1 }) {
  const enviados: EventoConversao[] = [];
  const finalizados: { linha: EventoFilaCrm; resultado: Parameters<DependenciasFilaCrm["finalizar"]>[1] }[] = [];
  let disponivel = true;
  const deps: DependenciasFilaCrm = {
    agora: () => AGORA,
    reivindicar: async () => { if (!disponivel) return null; disponivel = false; return linha; },
    enviar: async (eventos) => { enviados.push(...eventos); return resposta; },
    finalizar: async (l, resultado) => { finalizados.push({ linha: l, resultado }); return true; },
  };
  return { deps, enviados, finalizados };
}

test("CRM sempre system_generated e matching do lead, sem contaminar Site legado", () => {
  const evento = montarEventoCrm({ ...base, snapshot: {
    ...(base.snapshot as object), rastreio: { fbc: "fb.1.1700000000000.xyz", ua: "Mozilla/5.0 (iPhone)", ip: "200.1.2.3" },
  } });
  assert.ok(evento);
  const payload = montarEvento(evento, AGORA + 86_400_000);
  assert.equal(payload.action_source, "system_generated");
  assert.deepEqual(payload.custom_data, { event_source: "crm", lead_event_source: "Mel Storymaker", content_category: "casamento" });
  assert.equal(payload.event_time, Date.parse(base.ocorrido_em) / 1000);
  assert.equal(payload.event_id, base.event_id);
  assert.equal(payload.user_data.client_user_agent, "Mozilla/5.0 (iPhone)");
  assert.equal(payload.user_data.client_ip_address, "200.1.2.3");
  assert.equal(payload.user_data.fbc, "fb.1.1700000000000.xyz");
  assert.equal(payload.user_data.external_id, createHash("sha256").update("abc").digest("hex"));
  assert.equal(payload.user_data.em, createHash("sha256").update("ana@exemplo.invalid").digest("hex"));
  assert.equal(payload.user_data.ph, createHash("sha256").update("5519999999999").digest("hex"));
  assert.equal("event_source_url" in payload, false);
});

test("CRM tolera rastreio ausente/antigo sem inventar cookies; recusa dados inconsistentes", () => {
  const evento = montarEventoCrm(base);
  assert.ok(evento);
  assert.equal(evento.pessoa.userAgent, undefined);
  assert.equal(evento.pessoa.fbc, undefined);
  assert.equal(montarEventoCrm({ ...base, ocorrido_em: "lixo" }), null);
  assert.equal(montarEventoCrm({ ...base, evento: "Purchase" }), null);
  assert.equal(montarEventoCrm({ ...base, event_id: "qualificado_abc" }), null);
  assert.equal(montarEventoCrm({ ...base, snapshot: { categoria: "casamento" } }), null);
});

test("todos os estagios CRM tem nome/ID distintos de eventos Site", () => {
  for (const [etapa, nome] of [
    ["lead_criado", "CRMLeadCriado"], ["formulario_completo", "CRMFormularioCompleto"],
    ["enviado", "CRMPropostaEnviada"], ["virou_cliente", "CRMVirouCliente"], ["perdido", "CRMLeadPerdido"],
    ["qualificado", "CRMLeadQualificado"],
  ] as const) {
    const evento = montarEventoCrm({ ...base, etapa, evento: nome, event_id: `crm_${etapa}_abc` });
    assert.ok(evento);
    assert.equal(evento.nome, nome);
    assert.equal(evento.id, `crm_${etapa}_abc`);
    assert.equal(evento.origem, "system_generated");
  }
});

test("fila confirma somente resultado aceito e usa horario do fato", async () => {
  const a = ambiente();
  const resumo = await processarFilaComDependencias(a.deps);
  assert.equal(resumo.enviados, 1);
  assert.equal(resumo.processados, 1);
  assert.equal(a.finalizados[0].resultado.estado, "enviado");
  assert.equal(a.enviados[0].ocorridoEm, Math.floor(Date.parse(base.ocorrido_em) / 1000));
});

test("rede/ACK perdido agenda retry; lease novo preserva ID, timestamp e snapshot", async () => {
  const a = ambiente(base, { tipo: "falha", motivo: "rede", repetir: true });
  await processarFilaComDependencias(a.deps);
  assert.equal(a.finalizados[0].resultado.estado, "pendente");
  assert.equal(a.finalizados[0].resultado.proximaTentativaEm, new Date(AGORA + 15 * 60_000).toISOString());
  const b = ambiente({ ...base, tentativas: 2, lease_token: "lease2" });
  b.deps.agora = () => AGORA + 15 * 60_000;
  await processarFilaComDependencias(b.deps);
  assert.deepEqual(a.enviados[0], b.enviados[0]);
  assert.equal(b.finalizados[0].linha.lease_token, "lease2");
});

test("backoff impede cinco tentativas imediatas e cresce por tentativa", async () => {
  for (const [tentativas, espera] of [[1, 15 * 60_000], [2, 60 * 60_000], [3, 6 * 60 * 60_000], [4, 24 * 60 * 60_000]] as const) {
    const a = ambiente({ ...base, tentativas }, { tipo: "falha", motivo: "http_503", repetir: true });
    await processarFilaComDependencias(a.deps);
    assert.equal(a.finalizados[0].resultado.estado, "pendente");
    assert.equal(a.finalizados[0].resultado.proximaTentativaEm, new Date(AGORA + espera).toISOString());
  }
});

test("quinta tentativa encerra; erro definitivo nao e repetido", async () => {
  for (const [tentativas, resposta] of [
    [5, { tipo: "falha", motivo: "rede", repetir: true }],
    [1, { tipo: "falha", motivo: "http_400", repetir: false }],
  ] as const) {
    const a = ambiente({ ...base, tentativas }, resposta);
    const resumo = await processarFilaComDependencias(a.deps);
    assert.equal(resumo.encerrados, 1);
    assert.equal(a.finalizados[0].resultado.estado, "encerrado");
    assert.equal(a.finalizados[0].resultado.proximaTentativaEm, undefined);
  }
});

test("TTL47h recusa envio e retry que atravessaria o prazo", async () => {
  const a = ambiente({ ...base, ocorrido_em: new Date(AGORA - PRAZO_CRM_MS).toISOString() });
  await processarFilaComDependencias(a.deps);
  assert.equal(a.enviados.length, 0);
  assert.equal(a.finalizados[0].resultado.erro, "prazo_expirado");
  const b = ambiente({ ...base, ocorrido_em: new Date(AGORA - PRAZO_CRM_MS + 60_000).toISOString() },
    { tipo: "falha", motivo: "rede", repetir: true });
  await processarFilaComDependencias(b.deps);
  assert.equal(b.enviados.length, 1);
  assert.equal(b.finalizados[0].resultado.estado, "encerrado");
});

test("ACK de worker antigo nao conta sucesso; falha banco nao repete rede no request", async () => {
  const a = ambiente();
  a.deps.finalizar = async () => false;
  const resumo = await processarFilaComDependencias(a.deps);
  assert.equal(resumo.enviados, 0);
  assert.equal(resumo.falhasBanco, 1);
  assert.equal(a.enviados.length, 1);
  const b = ambiente();
  b.deps.reivindicar = async () => { throw new Error("credencial nao deve ser logada"); };
  assert.equal((await processarFilaComDependencias(b.deps)).falhasBanco, 1);
  assert.equal(b.enviados.length, 0);
});

test("snapshot invalido encerra sem envio; excecao sender vira retry de rede", async () => {
  const a = ambiente({ ...base, snapshot: null });
  await processarFilaComDependencias(a.deps);
  assert.equal(a.enviados.length, 0);
  assert.equal(a.finalizados[0].resultado.erro, "snapshot_invalido");
  const b = ambiente();
  b.deps.enviar = async () => { throw new Error("rede"); };
  await processarFilaComDependencias(b.deps);
  assert.equal(b.finalizados[0].resultado.estado, "pendente");
});

test("fila respeita limite, lead selecionado e reserva de IO", async () => {
  const a = ambiente();
  const ids: (string | undefined)[] = [];
  let tempo = AGORA;
  a.deps.agora = () => tempo;
  a.deps.reivindicar = async (id) => { ids.push(id); return base; };
  a.deps.enviar = async () => { tempo += 26_000; return { tipo: "aceito", recebidos: 1 }; };
  const resumo = await processarFilaComDependencias(a.deps, { leadId: "abc", limite: 6 });
  assert.equal(resumo.processados, 1);
  assert.deepEqual(ids, ["abc"]);
  const b = ambiente();
  b.deps.reivindicar = async () => base;
  assert.equal((await processarFilaComDependencias(b.deps, { limite: 2 })).processados, 2);
});
