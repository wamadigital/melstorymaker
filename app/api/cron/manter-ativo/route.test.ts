import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route";

// Exclusivamente fixtures. Não carrega .env.local nem faz chamadas reais.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://manutencao.supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-ficticia";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-ficticia";
process.env.MAIL_FROM = "Mel <mel@example.invalid>";
process.env.MAIL_DRY_RUN = "1";
process.env.APP_URL = "https://mel.example.invalid";
process.env.MEL_WHATSAPP = "5519999999999";

const id = "10000000-0000-4000-8000-000000000001";
const req = (bearer = "segredo-ficticio") => new Request("https://mel.example.invalid/api/cron/manter-ativo", {
  headers: { authorization: `Bearer ${bearer}` },
});

test("sem segredo ou bearer correto o cron não toca o banco e não permite cache", async (t) => {
  let chamadas = 0;
  t.mock.method(globalThis, "fetch", async () => { chamadas++; throw new Error("rede proibida"); });
  delete process.env.CRON_SECRET;
  const indisponivel = await GET(req());
  assert.equal(indisponivel.status, 503);
  assert.equal(indisponivel.headers.get("cache-control"), "no-store");
  process.env.CRON_SECRET = "segredo-ficticio";
  const negado = await GET(req("errado"));
  assert.equal(negado.status, 401);
  assert.equal(negado.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await negado.text(), /segredo-ficticio/);
  assert.equal(chamadas, 0);
});

test("cron executa keepalive, encerramento e depois esfriar; segunda rodada não duplica contagem", async (t) => {
  process.env.CRON_SECRET = "segredo-ficticio";
  const chamadas: string[] = [];
  let encerrado = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "manutencao.supabase.invalid");
    if (init?.method === "HEAD") {
      chamadas.push("keepalive");
      assert.equal(url.searchParams.get("select"), "id");
      return new Response(null, { headers: { "content-range": "0-0/131" } });
    }
    if (url.pathname.endsWith("/rpc/encerrar_eventos_passados")) {
      chamadas.push("encerrar");
      assert.equal(init?.method, "POST");
      const rows = encerrado ? [] : [{ id }];
      encerrado = true;
      return Response.json(rows);
    }
    assert.equal(init?.method, "PATCH");
    assert.ok(url.pathname.endsWith("/leads"));
    assert.equal(url.searchParams.get("status"), "eq.enviado");
    assert.deepEqual(JSON.parse(String(init.body)), { status: "esfriou" });
    chamadas.push("esfriar");
    return Response.json([]);
  });
  const primeira = await GET(req());
  assert.equal(primeira.status, 200);
  assert.equal(primeira.headers.get("cache-control"), "no-store");
  assert.deepEqual(await primeira.json(), { ok: true, leads: 131, encerrados: 1, esfriados: 0 });
  const segunda = await GET(req());
  assert.deepEqual(await segunda.json(), { ok: true, leads: 131, encerrados: 0, esfriados: 0 });
  assert.deepEqual(chamadas, ["keepalive", "encerrar", "esfriar", "keepalive", "encerrar", "esfriar"]);
});

test("falha de encerramento retorna 503 sem esfriar, sem repetir RPC e sem detalhes privados", async (t) => {
  process.env.CRON_SECRET = "segredo-ficticio";
  const chamadas: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      chamadas.push("keepalive");
      return new Response(null, { headers: { "content-range": "0-0/131" } });
    }
    assert.ok(String(input).endsWith("/rpc/encerrar_eventos_passados"));
    chamadas.push("encerrar");
    return Response.json({ message: "email@privado.invalid segredo-dobanco", code: "PGRST001" }, { status: 503 });
  });
  const resposta = await GET(req());
  assert.equal(resposta.status, 503);
  assert.equal(resposta.headers.get("cache-control"), "no-store");
  const json = await resposta.json();
  assert.equal(json.ok, false);
  assert.doesNotMatch(JSON.stringify(json), /privado|segredo-dobanco|PGRST001/);
  assert.deepEqual(chamadas, ["keepalive", "encerrar"]);
});

test("falha no keepalive não começa transições e não vaza o erro do banco", async (t) => {
  process.env.CRON_SECRET = "segredo-ficticio";
  let chamadas = 0;
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    chamadas++;
    assert.equal(init?.method, "HEAD");
    return Response.json({ message: "dados privados", code: "PGRST000" }, { status: 500 });
  });
  const resposta = await GET(req());
  assert.equal(resposta.status, 503);
  assert.equal(resposta.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await resposta.text(), /privados|PGRST000/);
  assert.equal(chamadas, 1);
});
