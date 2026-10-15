import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { automacaoAtiva, criarRepositorioWhatsApp } from "./index";
import { MENSAGENS_LEMBRETE_FORMULARIO } from "./lembrete-formulario";

const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const TOKEN = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
const AGORA = Date.parse("2026-10-15T18:00:00Z");
const ambiente = {
  WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_LEMBRETE_FORMULARIO_ATIVO: "true",
  WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM: "2026-10-14T18:00:00Z", APP_URL: "https://crm.invalid",
};
const sequencia = [...MENSAGENS_LEMBRETE_FORMULARIO,
  { message: `https://crm.invalid/continuar/${ID}`, delayBeforeSeconds: 2 }];
const linha = { id: ID, lease_token: TOKEN, destinatario: "5519988887777",
  mensagem: sequencia.map((p) => p.message).join("\n\n"), expira_em: "2026-10-16T18:00:00Z",
  tipo: "lembrete_formulario_24h", sequencia, lead_id: "privado" };
function sdkFicticio(responder: (nome: string, corpo: Record<string, unknown>) => Response) {
  return createClient("https://whatsapp-ficticio.invalid", "service-ficticio", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (entrada, init) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      assert.equal(url.hostname, "whatsapp-ficticio.invalid", "rede externa proibida");
      assert.equal(init?.method, "POST");
      assert.ok(url.pathname.startsWith("/rest/v1/rpc/"));
      assert.ok(init?.signal);
      return responder(url.pathname.split("/").at(-1)!, JSON.parse(String(init?.body)));
    } },
  });
}

test("sem flag, configuração completa ou protocolo2 não há acesso ao claim legado", async () => {
  for (const flag of [undefined, "", "0", "false", "yes"]) {
    assert.equal(automacaoAtiva({ WHATSAPP_AUTOMACAO_ATIVA: flag }), false);
    const db = sdkFicticio(() => { assert.fail("nenhuma RPC deve ser chamada"); });
    const repo = criarRepositorioWhatsApp(db, { ambiente: { ...ambiente, WHATSAPP_AUTOMACAO_ATIVA: flag }, agora: () => AGORA, protocolo: 2 });
    assert.equal(await repo.reivindicar(), null);
    assert.equal(await repo.resultado(ID, { leaseToken: TOKEN, outcome: "started" }), null);
  }
  assert.equal(automacaoAtiva({ WHATSAPP_AUTOMACAO_ATIVA: "TRUE" }), true);
  const db = sdkFicticio(() => { assert.fail("worker antigo não reivindica"); });
  assert.equal(await criarRepositorioWhatsApp(db, { ambiente, agora: () => AGORA }).reivindicar(), null);
});

test("SDK usa somente batch/claim V3 e entrega apenas a sequência aprovada sem PII extra", async () => {
  const nomes: string[] = [];
  const repo = criarRepositorioWhatsApp(sdkFicticio((nome) => {
    nomes.push(nome);
    return Response.json(nome.startsWith("enfileirar_") ? 1 : [linha]);
  }), { ambiente, agora: () => AGORA, protocolo: 2 });
  const job = await repo.reivindicar();
  assert.deepEqual(nomes, ["enfileirar_lembretes_formulario_whatsapp_v3", "reivindicar_whatsapp_v3"]);
  assert.equal(job?.id, ID);
  assert.deepEqual(job?.messagesSequence, sequencia);
  assert.ok(!JSON.stringify(job).includes("privado"));
  assert.equal("registrar" in repo, false, "o registro de confirmação foi removido");
});

test("resposta antiga da fila nunca libera confirmação ou mensagem alternativa", async () => {
  for (const alteracao of [{ tipo: "confirmacao_recebimento", sequencia: null },
    { tipo: "lembrete_7_dias" }, { tipo: "lembrete_30_dias" }, { tipo: undefined },
    { sequencia: sequencia.map((p, i) => i === 0 ? { ...p, message: "Texto não aprovado" } : p) }]) {
    const repo = criarRepositorioWhatsApp(sdkFicticio((nome) => Response.json(nome.startsWith("enfileirar_") ? 0 : [{ ...linha, ...alteracao }])),
      { ambiente, agora: () => AGORA, protocolo: 2 });
    await assert.rejects(repo.reivindicar());
  }
});

test("started exige lembrete habilitado mas ACK anterior continua reconciliável após pausa", async () => {
  const chamadas: { nome: string; corpo: Record<string, unknown> }[] = [];
  const db = sdkFicticio((nome, corpo) => { chamadas.push({ nome, corpo }); return Response.json(corpo.p_outcome === "started" ? "enviando" : "enviado"); });
  const repo = criarRepositorioWhatsApp(db, { ambiente, agora: () => AGORA, protocolo: 2 });
  assert.equal(await repo.resultado(ID, { leaseToken: TOKEN, outcome: "started" }), "enviando");
  assert.equal(chamadas[0].nome, "resultado_whatsapp_v3");
  const pausado = criarRepositorioWhatsApp(db, { ambiente: {}, agora: () => AGORA, protocolo: 2 });
  assert.equal(await pausado.resultado(ID, { leaseToken: TOKEN, outcome: "started" }), null);
  assert.equal(chamadas.length, 1);
  assert.equal(await pausado.resultado(ID, { leaseToken: TOKEN, outcome: "sent" }), "enviado");
  assert.equal(chamadas[1].nome, "resultado_whatsapp");
});

test("claim vazio e erro de banco não viram autorização de envio", async () => {
  const vazio = criarRepositorioWhatsApp(sdkFicticio((nome) => Response.json(nome.startsWith("enfileirar_") ? 0 : [])),
    { ambiente, agora: () => AGORA, protocolo: 2 });
  assert.equal(await vazio.reivindicar(), null);
  const erro = criarRepositorioWhatsApp(sdkFicticio((nome) => nome.startsWith("enfileirar_") ? Response.json(0)
    : Response.json({ message: "privado", code: "XX000" }, { status: 500 })), { ambiente, agora: () => AGORA, protocolo: 2 });
  await assert.rejects(erro.reivindicar(), /claim_whatsapp/);
});
