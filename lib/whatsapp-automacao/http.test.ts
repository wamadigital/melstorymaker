import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { tratarReivindicacao, tratarResultado, type DependenciasHttpWhatsApp } from "./http";

const TOKEN = "token-ficticio-whatsapp-com-32-caracteres";
const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const LEASE = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
const job = { id: ID, leaseToken: LEASE, recipient: "5519988887777", message: "Mensagem ficticia", expiresAt: "2026-10-15T18:00:00Z" };
const req = (body: unknown = {}, authorization = `Bearer ${TOKEN}`) => new Request("https://crm.invalid/api/integracoes/whatsapp", {
  method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
});
function dependencias(ativa = "1") {
  let claims = 0, resultados = 0;
  const deps: DependenciasHttpWhatsApp = {
    ambiente: { WHATSAPP_WORKER_TOKEN: TOKEN, WHATSAPP_AUTOMACAO_ATIVA: ativa },
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
  assert.deepEqual(await r.json(), { active: false, job: null });
  assert.equal((await tratarResultado(req({ leaseToken: LEASE, outcome: "started" }), ID, deps)).status, 409);
  assert.deepEqual(await (await tratarResultado(req({ leaseToken: LEASE, outcome: "sent" }), ID, deps)).json(), { accepted: true, state: "enviado" });
  assert.deepEqual(contagem(), { claims: 0, resultados: 1 });
});

test("contrato de claim e started bem sucedidos devolve ACK explicito no-store", async () => {
  const { deps } = dependencias();
  const r = await tratarReivindicacao(req({ recipient: "nao-controla-destinatario" }), deps);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { active: true, job });
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
