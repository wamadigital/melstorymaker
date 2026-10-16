import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { tratarReivindicacao, tratarResultado, type DependenciasHttpWhatsApp } from "./http";
import { envelopeJob, type ProtocoloWorker } from "./contrato";
import { MENSAGENS_LEMBRETE_FORMULARIO } from "./lembrete-formulario";
import { sequenciaPropostaInicial } from "./proposta-inicial";

const TOKEN = "token-ficticio-whatsapp-com-32-caracteres";
const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const LEASE = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
const sequenciaAprovada = [...MENSAGENS_LEMBRETE_FORMULARIO,
  { message: `https://crm.invalid/continuar/${ID}`, delayBeforeSeconds: 2 as const }];
const job = { id: ID, leaseToken: LEASE, recipient: "5519988887777",
  message: sequenciaAprovada.map((p) => p.message).join("\n\n"),
  expiresAt: "2026-10-15T18:00:00Z", messagesSequence: sequenciaAprovada };
const req = (body: unknown = {}, authorization = `Bearer ${TOKEN}`, protocolo: string | null = "2") => new Request("https://crm.invalid/api/integracoes/whatsapp", {
  method: "POST", headers: { authorization, "content-type": "application/json",
    ...(protocolo === null ? {} : { "X-Mel-Worker-Protocol": protocolo }) }, body: JSON.stringify(body),
});

test("proposta inicial exige protocolo4 e sua própria flag, sem reativar formulário ou lembretes", async () => {
  const sequencia = sequenciaPropostaInicial("Maria Eduarda", "https://crm.invalid/p/a3f9");
  const inicial = { ...job, tipo: "proposta_inicial_15m" as const, messagesSequence: sequencia,
    message: sequencia.map(p => p.message).join("\n\n") };
  let chamadas = 0;
  const deps: DependenciasHttpWhatsApp = {
    ambiente: { WHATSAPP_WORKER_TOKEN: TOKEN, WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_PROPOSTA_INICIAL_ATIVA: "true" },
    reivindicar: async () => { chamadas++; return inicial; },
    resultado: async () => "enviando",
  };
  assert.equal((await (await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, "3"), deps)).json()).active, false);
  assert.equal(chamadas, 0);
  const resposta = await (await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, "4"), deps)).json();
  assert.deepEqual(resposta, { active: true, job: inicial, protocolVersion: 4, reminderActive: false,
    proposalReminderActive: false, proposalInitialActive: true });
  assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }, `Bearer ${TOKEN}`, "4"), ID, deps)).status, 200);
  deps.ambiente.WHATSAPP_PROPOSTA_INICIAL_ATIVA = "false";
  assert.equal((await (await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, "4"), deps)).json()).active, false);
  assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }, `Bearer ${TOKEN}`, "4"), ID, deps)).status, 409);
  assert.equal(chamadas, 1);
});
function dependencias(ativa = "1") {
  let claims = 0, resultados = 0;
  const deps: DependenciasHttpWhatsApp = {
    ambiente: { WHATSAPP_WORKER_TOKEN: TOKEN, WHATSAPP_AUTOMACAO_ATIVA: ativa,
      WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "true", APP_URL: "https://crm.invalid",
      WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: "2026-10-14T18:00:00Z" },
    agora: () => Date.parse("2026-10-15T18:00:00Z"),
    reivindicar: async () => { claims++; return job; },
    resultado: async (_id, resultado) => { resultados++; return resultado.outcome === "sent" ? "enviado" : "enviando"; },
  };
  return { deps, contagem: () => ({ claims, resultados }) };
}

test("auth falha fechado e nao toca fila; nunca aceita token em cookie/query", async () => {
  const { deps, contagem } = dependencias();
  for (const authorization of ["", "Bearer errado", TOKEN]) {
    assert.equal((await tratarReivindicacao(req({}, authorization), deps)).status, 401);
    assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }, authorization), ID, deps)).status, 401);
  }
  assert.deepEqual(contagem(), { claims: 0, resultados: 0 });
  deps.ambiente.WHATSAPP_WORKER_TOKEN = undefined;
  assert.equal((await tratarReivindicacao(req(), deps)).status, 503);
});

test("desativada impede claim e started, mas aceita resultado de envio anterior", async () => {
  const { deps, contagem } = dependencias("0");
  const r = await tratarReivindicacao(req(), deps);
  assert.deepEqual(await r.json(), { active: false, job: null, protocolVersion: 2, reminderActive: false });
  assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }), ID, deps)).status, 409);
  assert.deepEqual(await (await tratarResultado(req({ leaseToken: LEASE, outcome: "sent" }), ID, deps)).json(), { accepted: true, state: "enviado" });
  assert.deepEqual(contagem(), { claims: 0, resultados: 1 });
});

test("contrato de claim e started bem sucedidos devolve ACK explicito no-store", async () => {
  const { deps } = dependencias();
  const r = await tratarReivindicacao(req({ recipient: "nao-controla-destinatario" }), deps);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { active: true, job, protocolVersion: 2, reminderActive: true });
  const inicio = await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }), ID, deps);
  assert.equal(inicio.status, 200);
  assert.equal((await inicio.json()).accepted, true);
});

test("CAS/lease recusado retorna409, nao acceptedfalse ou200", async () => {
  const { deps } = dependencias();
  deps.resultado = async () => null;
  const r = await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }), ID, deps);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).accepted, undefined);
});

test("started nao autoriza envio quando RPC devolve outro estado", async () => {
  const { deps } = dependencias();
  deps.resultado = async () => "indeterminado";
  const log = mock.method(console, "error", () => {});
  try {
    const r = await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }), ID, deps);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).accepted, undefined);
  } finally { log.mock.restore(); }
});

test("payload/UUID invalidos sao recusados antes do banco", async () => {
  const { deps, contagem } = dependencias();
  for (const body of [{}, { leaseToken: LEASE, outcome: "send", recipient: "qualquer" },
    { leaseToken: LEASE, outcome: "failed", code: "erro bruto com token" }]) {
    assert.equal((await tratarResultado(req(body), ID, deps)).status, 400);
  }
  assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "sent" }), "nao-uuid", deps)).status, 400);
  assert.deepEqual(contagem(), { claims: 0, resultados: 0 });
});

test("falhas nao vazam erro/credenciais; ACK inexistente nao autoriza WhatsApp", async () => {
  const { deps } = dependencias();
  deps.reivindicar = async () => { throw new Error("token privado"); };
  deps.resultado = async () => { throw new Error("telefone privado"); };
  const log = mock.method(console, "error", () => {});
  try {
    const claim = await tratarReivindicacao(req(), deps);
    const started = await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }), ID, deps);
    assert.equal(claim.status, 503); assert.equal(started.status, 503);
    assert.ok(!(await claim.text()).includes("privado"));
    assert.equal((await started.json()).accepted, undefined);
    assert.ok(log.mock.calls.every((c) => c.arguments.length === 1 && !String(c.arguments[0]).includes("privado")));
  } finally { log.mock.restore(); }
});

test("headers2/3/4 permitem claim/started; protocolos antigos só reconciliam ACK", async () => {
  for (const header of [null, "1", "", "02", "2,1", "5", "true", "2", "3", "4"]) {
    const { deps } = dependencias();
    const protocolos: (ProtocoloWorker | undefined)[] = [];
    deps.reivindicar = async (protocolo) => { protocolos.push(protocolo); return (protocolo ?? 1) >= 3 ? { ...job, tipo: "lembrete_formulario_24h" } : job; };
    deps.resultado = async (_id, resultado, protocolo) => { protocolos.push(protocolo); return resultado.outcome === "sent" ? "enviado" : "enviando"; };
    const claim = await tratarReivindicacao(req({ protocol: 2 }, `Bearer ${TOKEN}`, header), deps);
    assert.equal(claim.status, 200);
    const ativo = header === "2" || header === "3" || header === "4";
    assert.equal((await claim.json()).active, ativo);
    assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }, `Bearer ${TOKEN}`, header), ID, deps)).status, ativo ? 200 : 409);
    assert.deepEqual(protocolos, ativo ? [Number(header), Number(header)] : []);
    assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "sent" }, `Bearer ${TOKEN}`, header), ID, deps)).status, 200);
    assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started", protocol: 2 }, `Bearer ${TOKEN}`, header), ID, deps)).status, 400);
  }
});

test("fronteira HTTP nao entrega sequencia para worker antigo nem faz fallback concatenado", async () => {
  const { deps } = dependencias();
  const sequencia = [
    ...MENSAGENS_LEMBRETE_FORMULARIO,
    { message: `https://crm.invalid/continuar/${ID}`, delayBeforeSeconds: 2 },
  ];
  const lembrete = envelopeJob({ id: ID, lease_token: LEASE, destinatario: job.recipient,
    mensagem: sequencia.map((p) => p.message).join("\n\n"), expira_em: job.expiresAt,
    tipo: "lembrete_formulario_24h", sequencia }, 2);
  deps.reivindicar = async () => lembrete;
  const log = mock.method(console, "error", () => {});
  try {
    const antigo = await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, null), deps);
    assert.equal(antigo.status, 200);
    assert.deepEqual(await antigo.json(), { active: false, job: null });
    const novo = await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, "2"), deps);
    assert.equal(novo.status, 200);
    assert.deepEqual((await novo.json()).job.messagesSequence, sequencia);
  } finally { log.mock.restore(); }
});

test("somente claim protocolo2 autenticado publica capacidade e configuracao efetiva sem envs", async () => {
  const agora = Date.parse("2026-10-15T18:00:00Z");
  for (const [override, esperado] of [
    [{}, true], [{ WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "false" }, false],
    [{ WHATSAPP_AUTOMACAO_ATIVA: "0" }, false], [{ APP_URL: "http://crm.invalid" }, false],
    [{ WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: "2026-10-16T18:00:00Z" }, false],
    [{ WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: "invalido" }, false],
  ] as const) {
    const { deps } = dependencias();
    deps.agora = () => agora;
    Object.assign(deps.ambiente, {
      WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "true", APP_URL: "https://crm.invalid",
      WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: "2026-10-15T17:00:00Z", ...override,
    });
    const r = await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, "2"), deps);
    const corpo = await r.json();
    assert.equal(corpo.protocolVersion, 2); assert.equal(corpo.reminderActive, esperado);
    assert.deepEqual(Object.keys(corpo), ["active", "job", "protocolVersion", "reminderActive"]);
    assert.ok(!JSON.stringify(corpo).includes(TOKEN));
    const legado = await tratarReivindicacao(req({}, `Bearer ${TOKEN}`, null), deps);
    assert.deepEqual(Object.keys(await legado.json()), ["active", "job"]);
    const negado = await tratarReivindicacao(req({}, "Bearer errado", "2"), deps);
    assert.equal(negado.status, 401);
    assert.deepEqual(await negado.json(), { erro: "Nao autorizado" });
  }
});

test("API bloqueia mensagem única e alteração da copy mesmo se a dependência entregar o job", async () => {
  const log = mock.method(console, "error", () => {});
  try {
    for (const mensagem of [
      { ...job, messagesSequence: undefined },
      { ...job, messagesSequence: job.messagesSequence.map((p, i) => i === 0 ? { ...p, message: "Texto não aprovado" } : p) },
    ]) {
      const { deps } = dependencias();
      deps.reivindicar = async () => mensagem as typeof job;
      const r = await tratarReivindicacao(req(), deps);
      assert.equal(r.status, 503);
      assert.equal((await r.json()).job, undefined);
    }
  } finally { log.mock.restore(); }
});
