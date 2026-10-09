import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { GET } from "./route";

// Somente ambiente ficticio; nao ler .env.local nem permitir rede neste arquivo.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.MAIL_FROM = "Mel <mel@exemplo.invalid>";
process.env.MAIL_DRY_RUN = "1";
process.env.APP_URL = "https://mel.exemplo.invalid";
process.env.MEL_WHATSAPP = "5519999999999";
process.env.META_PIXEL_ID = "";
process.env.META_CAPI_TOKEN = "";

test("cron sem segredo falha fechado, sem consulta nem envio", async (t) => {
  delete process.env.CRON_SECRET;
  mock.method(globalThis, "fetch", async () => { throw new Error("rede proibida"); });
  t.after(() => mock.restoreAll());
  const r = await GET(new Request("https://mel.exemplo.invalid/api/cron/meta-crm"));
  assert.equal(r.status, 503);
});

test("cron rejeita bearer incorreto; segredo nao aparece na resposta", async () => {
  process.env.CRON_SECRET = "segredo-ficticio";
  const r = await GET(new Request("https://mel.exemplo.invalid/api/cron/meta-crm", { headers: { authorization: "Bearer errado" } }));
  assert.equal(r.status, 401);
  assert.equal((await r.text()).includes("segredo-ficticio"), false);
});

test("cron autorizado sem CAPI retorna desligada sem consumir tentativas", async (t) => {
  process.env.CRON_SECRET = "segredo-ficticio";
  let chamadas = 0;
  mock.method(globalThis, "fetch", async () => { chamadas++; throw new Error("rede proibida"); });
  t.after(() => mock.restoreAll());
  const r = await GET(new Request("https://mel.exemplo.invalid/api/cron/meta-crm", { headers: { authorization: "Bearer segredo-ficticio" } }));
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.desligada, true);
  assert.equal(json.processados, 0);
  assert.equal(chamadas, 0);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
