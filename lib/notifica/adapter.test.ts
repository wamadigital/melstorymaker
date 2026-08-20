import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * O `env` do projeto e um Proxy preguicoso que le `process.env` na primeira
 * leitura e cacheia. Os testes nao carregam `.env.local`, entao da para montar
 * o ambiente aqui -- mas UMA vez por arquivo, porque o cache e do modulo.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.MAIL_FROM = "Mel <mel@wama.digital>";
process.env.MAIL_DRY_RUN = "1";
process.env.APP_URL = "https://melstorymaker.com.br";
process.env.MEL_WHATSAPP = "5519988887777";
process.env.NOTIFICA_WHATSAPP_APIKEY = "chave-de-teste";
// De proposito AUSENTE: e o cenario que quebrou em produca0 em 20/08/2026.
delete process.env.NOTIFICA_WHATSAPP_FONE;
delete process.env.NOTIFICA_DRY_RUN;

test("sem NOTIFICA_WHATSAPP_FONE, a notificação vai para o MEL_WHATSAPP", async () => {
  const chamadas: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    chamadas.push(String(url));
    return new Response("Message queued");
  });

  const { notificarMel } = await import("./adapter");
  await notificarMel("olá");

  assert.equal(chamadas.length, 1, "deveria ter chamado o gateway uma vez");
  // O bug real: com a apikey configurada e o fone nao, a funcao devolvia sem
  // chamar ninguem e a Mel nunca era avisada.
  assert.ok(
    chamadas[0].includes("phone=5519988887777"),
    `esperava o número do MEL_WHATSAPP na URL, veio: ${chamadas[0]}`,
  );
  assert.ok(chamadas[0].includes("apikey=chave-de-teste"));

  mock.restoreAll();
});
