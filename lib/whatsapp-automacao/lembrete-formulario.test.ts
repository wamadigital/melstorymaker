import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { criarRepositorioWhatsApp, type AmbienteWhatsApp } from "./index";
import { tratarResultado } from "./http";
import { MENSAGEM_CONFIRMACAO } from "./contrato";
import { configuracaoLembreteFormulario, PREFIXO_LEMBRETE_FORMULARIO } from "./lembrete-formulario";

const AGORA = Date.parse("2026-10-14T18:00:00Z");
const INICIO = "2026-10-14T15:00:00-03:00";
const INICIO_NORMALIZADO = "2026-10-14T18:00:00.000Z";
const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const LEASE = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
const TOKEN = "token-ficticio-do-worker-para-testes-offline";
const ambienteValido = (): AmbienteWhatsApp => ({
  WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "1",
  WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: INICIO, APP_URL: "https://crm.invalid/",
  WHATSAPP_WORKER_TOKEN: TOKEN,
});
const linha = {
  id: ID, lease_token: LEASE, destinatario: "5519988887777", mensagem: MENSAGEM_CONFIRMACAO,
  expira_em: "2026-10-15T18:00:00+00:00", tipo: "confirmacao_recebimento", lead_id: "privado",
};
type Chamada = { nome: string; corpo: Record<string, unknown> };
function transporte(responder: (chamada: Chamada) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const db = createClient("https://lembrete-ficticio.invalid", "service-ficticio", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (entrada, init) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      assert.equal(url.hostname, "lembrete-ficticio.invalid", "rede real proibida");
      assert.equal(init?.method, "POST");
      assert.ok(init?.signal, "todo RPC tem timeout");
      assert.ok(url.pathname.startsWith("/rest/v1/rpc/"), "acesso somente a RPCs");
      const chamada = { nome: url.pathname.split("/").at(-1)!, corpo: JSON.parse(String(init?.body)) };
      chamadas.push(chamada);
      return responder(chamada);
    } },
  });
  return { db, chamadas };
}

test("lembrete exige master e flag propria explicitas; ausencia permanece desligada", () => {
  for (const flag of [undefined, "", "0", "false", "yes", " true "]) {
    assert.equal(configuracaoLembreteFormulario({ ...ambienteValido(), WHATSAPP_AUTOMACAO_ATIVA: flag }, AGORA), null);
    assert.equal(configuracaoLembreteFormulario({ ...ambienteValido(), WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: flag }, AGORA), null);
  }
  assert.equal(configuracaoLembreteFormulario({}, AGORA), null);
  assert.ok(configuracaoLembreteFormulario({ ...ambienteValido(), WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "TRUE" }, AGORA));
});

test("inicio exige ISO com timezone, calendario valido e instante que ja chegou", () => {
  for (const inicio of [undefined, "", "2026-10-14", "2026-10-14T15:00:00", "2026-02-30T00:00:00Z",
    "2026-10-14T18:00:00+99:99", "2026-10-14T18:00:00.001Z"]) {
    assert.equal(configuracaoLembreteFormulario({ ...ambienteValido(), WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: inicio }, AGORA), null, String(inicio));
  }
  assert.equal(configuracaoLembreteFormulario(ambienteValido(), Number.NaN), null);
  assert.deepEqual(configuracaoLembreteFormulario(ambienteValido(), AGORA), {
    inicioEm: INICIO_NORMALIZADO, appUrl: "https://crm.invalid",
  });
});

test("APP_URL aceita somente origem HTTPS e normaliza barras finais", () => {
  for (const appUrl of [undefined, "", "http://crm.invalid", "//crm.invalid", "https://user:senha@crm.invalid/",
    "https://@crm.invalid", "https://crm.invalid/formulario", "https://crm.invalid/a/..", "https://crm.invalid/%2e/",
    "https://crm.invalid?x=1", "https://crm.invalid/?", "https://crm.invalid#x", "https://crm.invalid/#",
    " https://crm.invalid", "https://crm.invalid/ ", "https://crm.invalid\\", "javascript:alert(1)"]) {
    assert.equal(configuracaoLembreteFormulario({ ...ambienteValido(), APP_URL: appUrl }, AGORA), null, String(appUrl));
  }
  assert.equal(configuracaoLembreteFormulario({ ...ambienteValido(), APP_URL: "https://crm.invalid///" }, AGORA)?.appUrl, "https://crm.invalid");
});

test("flag desligada ou config invalida usa somente V1 antes de aplicar o SQL novo", async () => {
  const configuracoes = [
    {}, { ...ambienteValido(), WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "false" },
    { ...ambienteValido(), APP_URL: "http://crm.invalid" },
    { ...ambienteValido(), WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: "2026-10-15T00:00:00Z" },
  ];
  for (const ambiente of configuracoes) {
    const { db, chamadas } = transporte(({ nome }) => {
      assert.ok(["reivindicar_whatsapp", "resultado_whatsapp"].includes(nome), "SQL V2 indisponivel neste cenario");
      return Response.json(nome === "reivindicar_whatsapp" ? [linha] : "enviado");
    });
    const repositorio = criarRepositorioWhatsApp(db, { ambiente, agora: () => AGORA, falhaLembretes: () => assert.fail() });
    assert.equal((await repositorio.reivindicar())?.id, ID);
    assert.equal(await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "sent" }), "enviado");
    assert.deepEqual(chamadas.map((c) => c.nome), ["reivindicar_whatsapp", "resultado_whatsapp"]);
    assert.deepEqual(chamadas[0].corpo, {});
    assert.deepEqual(chamadas[1].corpo, { p_id: ID, p_lease_token: LEASE, p_outcome: "sent", p_code: null });
  }
});

test("claim ativo aguarda batch com prefixo e origem normalizada, depois chama V2 sem mudar envelope", async () => {
  let liberar!: () => void;
  const espera = new Promise<void>((resolve) => { liberar = resolve; });
  const { db, chamadas } = transporte(async ({ nome }) => {
    if (nome === "enfileirar_lembretes_formulario_whatsapp") { await espera; return Response.json(2); }
    assert.equal(nome, "reivindicar_whatsapp_v2");
    return Response.json([{ ...linha, tipo: "lembrete_formulario_24h", mensagem: PREFIXO_LEMBRETE_FORMULARIO + `https://crm.invalid/continuar/${ID}` }]);
  });
  const repositorio = criarRepositorioWhatsApp(db, { ambiente: ambienteValido(), agora: () => AGORA });
  const claim = repositorio.reivindicar();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(chamadas.length, 1, "claim nao ultrapassa batch pendente");
  assert.deepEqual(chamadas[0], { nome: "enfileirar_lembretes_formulario_whatsapp", corpo: {
    p_inicio_em: INICIO_NORMALIZADO, p_mensagem_prefixo: PREFIXO_LEMBRETE_FORMULARIO, p_app_url: "https://crm.invalid",
  } });
  liberar();
  const job = await claim;
  assert.deepEqual(Object.keys(job!), ["id", "leaseToken", "recipient", "message", "expiresAt"]);
  assert.ok(!JSON.stringify(job).includes("privado"));
  assert.ok(job?.message.endsWith(`/continuar/${ID}`));
  assert.deepEqual(chamadas[1], { nome: "reivindicar_whatsapp_v2", corpo: {
    p_lembrete_ativo: true, p_inicio_em: INICIO_NORMALIZADO,
  } });
});

test("erro HTTP ou de transporte no batch preserva claim de confirmacao sem logar PII", async () => {
  const log = mock.method(console, "error", () => {});
  try {
    for (const falhaTransporte of [false, true]) {
      const { db, chamadas } = transporte(({ nome }) => {
        if (nome === "enfileirar_lembretes_formulario_whatsapp") {
          if (falhaTransporte) throw new Error("telefone/token/texto privados");
          return Response.json({ code: "XX000", message: "telefone/token/texto privados" }, { status: 500 });
        }
        return Response.json([linha]);
      });
      const repositorio = criarRepositorioWhatsApp(db, { ambiente: ambienteValido(), agora: () => AGORA });
      assert.equal((await repositorio.reivindicar())?.message, MENSAGEM_CONFIRMACAO);
      assert.equal(chamadas.at(-1)?.nome, "reivindicar_whatsapp_v2");
    }
    assert.equal(log.mock.calls.length, 2);
    assert.ok(log.mock.calls.every((c) => c.arguments.length === 1 && !String(c.arguments[0]).includes("privados")));
  } finally { log.mock.restore(); }
});

test("resultado consulta configuracao atual: V2 quando valido e V1 apos desativar sem repetir batch", async () => {
  const ambiente = ambienteValido();
  const { db, chamadas } = transporte(() => Response.json("enviado"));
  const repositorio = criarRepositorioWhatsApp(db, { ambiente, agora: () => AGORA });
  await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "sent" });
  assert.deepEqual(chamadas[0], { nome: "resultado_whatsapp_v2", corpo: {
    p_id: ID, p_lease_token: LEASE, p_outcome: "sent", p_code: null,
    p_lembrete_ativo: true, p_inicio_em: INICIO_NORMALIZADO,
  } });
  ambiente.WHATSAPP_LEMBRETE_FORMULARIO_ATIVO = "false";
  await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "sent" });
  assert.equal(chamadas[1].nome, "resultado_whatsapp");
  assert.equal(chamadas[1].corpo.p_lembrete_ativo, undefined);
  ambiente.WHATSAPP_LEMBRETE_FORMULARIO_ATIVO = "true";
  ambiente.APP_URL = "http://crm.invalid";
  await repositorio.resultado(ID, { leaseToken: LEASE, outcome: "sent" });
  assert.equal(chamadas[2].nome, "resultado_whatsapp");
  assert.equal(chamadas.length, 3, "resultado nao enfileira nem reivindica");
});

test("apos desligar lembrete, rota honra recusa V1 de started e permite ACK tardio do mesmo token", async () => {
  const ambiente = { ...ambienteValido(), WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "false" };
  const { db, chamadas } = transporte(({ nome, corpo }) => {
    assert.equal(nome, "resultado_whatsapp");
    return Response.json(corpo.p_outcome === "started" ? null : "enviado");
  });
  const repositorio = criarRepositorioWhatsApp(db, { ambiente, agora: () => AGORA });
  const deps = { ambiente, reivindicar: repositorio.reivindicar, resultado: repositorio.resultado };
  const req = (outcome: string) => new Request(`https://crm.invalid/api/integracoes/whatsapp/${ID}/resultado`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ leaseToken: LEASE, outcome }),
  });
  assert.equal((await tratarResultado(req("started"), ID, deps)).status, 409);
  const ack = await tratarResultado(req("sent"), ID, deps);
  assert.equal(ack.status, 200);
  assert.deepEqual(await ack.json(), { accepted: true, state: "enviado" });
  assert.ok(chamadas.every((c) => c.corpo.p_lease_token === LEASE));
});

test("rascunho de copy preserva separador para link e nao contem URL ou prazo inventado", () => {
  assert.equal(PREFIXO_LEMBRETE_FORMULARIO,
    "Oi! Aqui é a Mel 💛\n\nFicou alguma dúvida para finalizar o formulário do seu evento? Se precisar de ajuda, pode me chamar por aqui 😊\n\nSuas respostas estão salvas. Para continuar de onde parou:\n");
  assert.ok(!PREFIXO_LEMBRETE_FORMULARIO.includes("http"));
});
