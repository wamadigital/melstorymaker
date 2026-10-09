import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, mock } from "node:test";

// Mesmo esquema de `lib/notifica/adapter.test.ts`: o `env` e cacheado no
// primeiro acesso, entao o ambiente e montado UMA vez, antes do import.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.MAIL_FROM = "Mel <mel@wama.digital>";
process.env.MAIL_DRY_RUN = "1";
process.env.APP_URL = "https://melstorymaker.com.br/";
process.env.MEL_WHATSAPP = "5519988887777";
process.env.META_PIXEL_ID = "28251176377887999";
process.env.META_CAPI_TOKEN = "token-de-teste";
process.env.META_CAPI_TEST_CODE = "TEST123";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

test("montarEvento: dado pessoal com hash no formato da Meta, identificador técnico cru", async () => {
  const { montarEvento } = await import("./conversoes");
  const evento = montarEvento(
    {
      nome: "Lead",
      id: "lead_abc",
      origem: "website",
      url: "https://melstorymaker.com.br/formulario?fbclid=xyz",
      categoria: "casamento",
      pessoa: {
        leadId: "abc",
        email: "  Ana@Exemplo.COM ",
        // Como o banco guarda: sem DDI.
        whatsapp: "19988887777",
        nome: "MARIA José da Silva",
        fbp: "fb.1.1700000000000.123456",
        fbc: "fb.1.1700000000000.xyz",
        ip: "200.1.2.3",
        userAgent: "Mozilla/5.0",
      },
    },
    1_700_000_123_999,
  );

  assert.equal(evento.event_name, "Lead");
  assert.equal(evento.event_id, "lead_abc");
  assert.equal(evento.event_time, 1_700_000_123, "segundos, nao milissegundos");
  assert.equal(evento.action_source, "website");
  assert.equal(evento.event_source_url, "https://melstorymaker.com.br/formulario?fbclid=xyz");
  assert.deepEqual(evento.custom_data, { content_category: "casamento" });

  const u = evento.user_data;
  assert.equal(u.em, sha("ana@exemplo.com"));
  // O 55 entra antes do hash: sem DDI o telefone nao casa com o da conta Meta.
  assert.equal(u.ph, sha("5519988887777"));
  assert.equal(u.fn, sha("maria"));
  assert.equal(u.external_id, sha("abc"));
  assert.equal(u.country, sha("br"));
  assert.equal(u.fbp, "fb.1.1700000000000.123456");
  assert.equal(u.fbc, "fb.1.1700000000000.xyz");
  assert.equal(u.client_ip_address, "200.1.2.3");
  assert.equal(u.client_user_agent, "Mozilla/5.0");
});

test("montarEvento: evento do quadro sem e-mail nem ip não inventa campo", async () => {
  const { montarEvento } = await import("./conversoes");
  const evento = montarEvento(
    {
      nome: "VirouCliente",
      id: "virou_cliente_abc",
      origem: "system_generated",
      pessoa: { leadId: "abc", email: null, whatsapp: "5519988887777", nome: "" },
    },
    0,
  );

  assert.equal(evento.action_source, "system_generated");
  assert.equal("event_source_url" in evento, false);
  assert.equal("custom_data" in evento, false);
  // Numero ja com 55 nao ganha outro.
  assert.equal(evento.user_data.ph, sha("5519988887777"));
  for (const campo of ["em", "fn", "fbp", "fbc", "client_ip_address", "client_user_agent"]) {
    assert.equal(campo in evento.user_data, false, `${campo} nao deveria existir`);
  }
});

test("enviarConversao: token no corpo, código de teste junto, URL do formulário como padrão", async () => {
  const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    chamadas.push({ url: String(url), corpo: JSON.parse(String(init.body)) });
    return new Response('{"events_received":1}');
  });

  const { enviarConversao } = await import("./conversoes");
  await enviarConversao({
    nome: "SubmitApplication",
    id: "submit_abc",
    origem: "website",
    pessoa: { leadId: "abc", userAgent: "Mozilla/5.0" },
  });

  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.0\/28251176377887999\/events$/);
  assert.equal(chamadas[0].url.includes("token"), false, "token nunca na URL");
  assert.equal(chamadas[0].corpo.access_token, "token-de-teste");
  assert.equal(chamadas[0].corpo.test_event_code, "TEST123");

  const [evento] = chamadas[0].corpo.data as Record<string, unknown>[];
  // Evento de site sem Referer: a Meta recusa sem URL, e a pagina so pode ter
  // sido o formulario. A barra final do APP_URL nao duplica.
  assert.equal(evento.event_source_url, "https://melstorymaker.com.br/formulario");

  mock.restoreAll();
});

test("enviarConversao: Meta fora do ar ou recusando não lança", async () => {
  mock.method(globalThis, "fetch", async () => new Response('{"error":{}}', { status: 400 }));
  const { enviarConversao } = await import("./conversoes");
  await assert.doesNotReject(
    enviarConversao({ nome: "Lead", id: "lead_x", origem: "system_generated", pessoa: { leadId: "x" } }),
  );
  mock.restoreAll();

  mock.method(globalThis, "fetch", async () => {
    throw new Error("rede caiu");
  });
  await assert.doesNotReject(
    enviarConversao({ nome: "Lead", id: "lead_x", origem: "system_generated", pessoa: { leadId: "x" } }),
  );
  mock.restoreAll();
});

test("montarEvento: visitante sem lead sai sem external_id, com os parâmetros do evento", async () => {
  const { montarEvento } = await import("./conversoes");
  const evento = montarEvento(
    {
      nome: "ViuSecao",
      id: "ViuSecao.abc12345",
      origem: "website",
      url: "https://melstorymaker.com.br/casamento",
      dados: { pagina: "casamento", secao: "pacotes" },
      pessoa: { fbp: "fb.1.1700000000000.123456", ip: "200.1.2.3", userAgent: "Mozilla/5.0" },
    },
    0,
  );
  assert.equal("external_id" in evento.user_data, false);
  assert.deepEqual(evento.custom_data, { pagina: "casamento", secao: "pacotes" });
  assert.equal(evento.user_data.fbp, "fb.1.1700000000000.123456");
});

test("enviarConversoes: o lote vai numa chamada só, na ordem", async () => {
  const chamadas: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    chamadas.push(JSON.parse(String(init.body)));
    return new Response('{"events_received":2}');
  });
  const { enviarConversoes } = await import("./conversoes");
  await enviarConversoes([
    { nome: "PageView", id: "PageView.a1b2c3d4", origem: "website", url: "https://melstorymaker.com.br/casamento", pessoa: {} },
    { nome: "RolouPagina", id: "RolouPagina.a1b2c3d4", origem: "website", dados: { profundidade: "50" }, pessoa: {} },
  ]);
  assert.equal(chamadas.length, 1);
  const data = chamadas[0].data as Record<string, unknown>[];
  assert.deepEqual(
    data.map((e) => e.event_name),
    ["PageView", "RolouPagina"],
  );
  // Sem URL, o padrão continua o do formulário.
  assert.equal(data[1].event_source_url, "https://melstorymaker.com.br/formulario");
  mock.restoreAll();

  // Lote vazio nem chama a Meta.
  let chamou = false;
  mock.method(globalThis, "fetch", async () => {
    chamou = true;
    return new Response("{}");
  });
  await enviarConversoes([]);
  assert.equal(chamou, false);
  mock.restoreAll();
});

test("CAPI confirmado exige HTTP OK e ACK exato; erro/rede nao expõem corpo", async (t) => {
  const { enviarConversoesConfirmadas } = await import("./conversoes");
  const eventos = [{ nome: "CRMLeadQualificado", id: "crm_qualificado_abc", origem: "system_generated" as const, pessoa: { leadId: "abc" } }];
  const casos = [
    { status: 200, corpo: '{"events_received":1}', esperado: { tipo: "aceito", recebidos: 1 } },
    { status: 200, corpo: '{"events_received":0}', esperado: { tipo: "falha", motivo: "ack_invalido", repetir: true } },
    { status: 200, corpo: '{"events_received":2}', esperado: { tipo: "falha", motivo: "ack_invalido", repetir: true } },
    { status: 200, corpo: 'invalido token-de-teste', esperado: { tipo: "falha", motivo: "ack_invalido", repetir: true } },
    { status: 400, corpo: '{"error":{"message":"token-de-teste"}}', esperado: { tipo: "falha", motivo: "http_400", repetir: false } },
    { status: 400, corpo: '{"error":{"is_transient":true}}', esperado: { tipo: "falha", motivo: "http_400", repetir: true } },
    { status: 429, corpo: '{}', esperado: { tipo: "falha", motivo: "http_429", repetir: true } },
    { status: 503, corpo: '{}', esperado: { tipo: "falha", motivo: "http_503", repetir: true } },
  ];
  let resposta = casos[0];
  mock.method(globalThis, "fetch", async () => new Response(resposta.corpo, { status: resposta.status }));
  t.after(() => mock.restoreAll());
  for (const caso of casos) {
    resposta = caso;
    assert.deepEqual(await enviarConversoesConfirmadas(eventos), caso.esperado);
  }
});

test("timestamp persistido CRM vence relogio atual; transporte preserva nome, ID e metadados", async (t) => {
  let corpo: Record<string, unknown> = {};
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    corpo = JSON.parse(String(init.body));
    return new Response('{"events_received":1}');
  });
  t.after(() => mock.restoreAll());
  const { enviarConversoesConfirmadas } = await import("./conversoes");
  assert.deepEqual(await enviarConversoesConfirmadas([{
    nome: "CRMVirouCliente", id: "crm_virou_cliente_abc", origem: "system_generated", ocorridoEm: 1_700_000_123,
    dados: { event_source: "crm", lead_event_source: "Mel Storymaker" }, pessoa: { leadId: "abc" },
  }]), { tipo: "aceito", recebidos: 1 });
  const [evento] = corpo.data as Record<string, unknown>[];
  assert.equal(evento.event_time, 1_700_000_123);
  assert.equal(evento.event_id, "crm_virou_cliente_abc");
  assert.equal(evento.event_name, "CRMVirouCliente");
  assert.equal(evento.action_source, "system_generated");
  assert.deepEqual(evento.custom_data, { event_source: "crm", lead_event_source: "Mel Storymaker" });
});
