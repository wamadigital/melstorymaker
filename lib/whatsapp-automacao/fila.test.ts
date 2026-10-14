import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  automacaoAtiva, criarRepositorioWhatsApp, enfileirarComDependencias,
  type RegistroConfirmacao,
} from "./index";
import { MENSAGEM_CONFIRMACAO, PRAZO_CONFIRMACAO_MS } from "./contrato";

const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const TOKEN = "a8c7f5bc-66f3-41ba-9f2c-93d5e0d94369";
const AGORA = Date.parse("2026-10-14T18:00:00Z");
const confirmacao = { leadId: ID, whatsapp: "19988887777", ocorridoEm: new Date(AGORA).toISOString() };

test("flag ausente/false fica desligada e nao acessa banco", async () => {
  for (const flag of [undefined, "", "0", "false", "yes"]) {
    const ambiente = { WHATSAPP_AUTOMACAO_ATIVA: flag };
    assert.equal(automacaoAtiva(ambiente), false);
    await enfileirarComDependencias(confirmacao, {
      ativo: () => automacaoAtiva(ambiente), agora: () => AGORA,
      registrar: async () => { assert.fail("nao deveria acessar banco"); },
      falha: () => assert.fail("nao deveria falhar"),
    });
  }
  assert.equal(automacaoAtiva({ WHATSAPP_AUTOMACAO_ATIVA: "TRUE" }), true);
});

test("registro usa copia aprovada e timestamp do CAS, aguarda persistencia", async () => {
  let liberar!: () => void;
  let finalizou = false;
  let recebido: RegistroConfirmacao | undefined;
  const espera = new Promise<void>((resolve) => { liberar = resolve; });
  const tarefa = enfileirarComDependencias(confirmacao, {
    ativo: () => true, agora: () => AGORA,
    registrar: async (c) => { recebido = c; await espera; }, falha: () => assert.fail(),
  }).then(() => { finalizou = true; });
  await Promise.resolve();
  assert.equal(finalizou, false);
  assert.deepEqual(recebido, { leadId: ID, recipient: "5519988887777", message: MENSAGEM_CONFIRMACAO, ocorridoEm: confirmacao.ocorridoEm });
  liberar(); await tarefa;
  assert.equal(finalizou, true);
});

test("24h e destinatario invalido impedem enfileirar; falha nao propaga ao submit", async () => {
  let registros = 0, falhas = 0;
  const deps = {
    ativo: () => true, agora: () => AGORA,
    registrar: async () => { registros++; throw new Error("erro privado nao deve vazar"); },
    falha: () => { falhas++; },
  };
  for (const c of [
    { ...confirmacao, whatsapp: "00000000000" },
    { ...confirmacao, ocorridoEm: "invalida" },
    { ...confirmacao, ocorridoEm: new Date(AGORA - PRAZO_CONFIRMACAO_MS).toISOString() },
  ]) await enfileirarComDependencias(c, deps);
  assert.equal(registros, 0);
  await assert.doesNotReject(enfileirarComDependencias(confirmacao, deps));
  assert.equal(registros, 1); assert.equal(falhas, 1);
});

function sdkFicticio(responder: (nome: string, corpo: Record<string, unknown>) => Response) {
  return createClient("https://whatsapp-ficticio.invalid", "service-ficticio", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (entrada, init) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      assert.equal(url.hostname, "whatsapp-ficticio.invalid", "rede externa proibida");
      assert.equal(init?.method, "POST");
      assert.ok(url.pathname.startsWith("/rest/v1/rpc/"), "nenhum acesso de tabela pelo worker");
      assert.ok(init?.signal, "chamada bounded");
      return responder(url.pathname.split("/").at(-1)!, JSON.parse(String(init?.body)));
    } },
  });
}

test("SDK chama RPC dedicada com identidade/tempo fixos e mapeia envelope sem PII extra", async () => {
  const chamadas: { nome: string; corpo: Record<string, unknown> }[] = [];
  const repositorio = criarRepositorioWhatsApp(sdkFicticio((nome, corpo) => {
    chamadas.push({ nome, corpo });
    if (nome === "registrar_confirmacao_whatsapp") return Response.json(ID);
    if (nome === "resultado_whatsapp") return Response.json("enviando");
    return Response.json([{ id: ID, lease_token: TOKEN, destinatario: "5519988887777",
      mensagem: MENSAGEM_CONFIRMACAO, expira_em: "2026-10-15T18:00:00Z", lead_id: "privado" }]);
  }));
  const registro = { leadId: ID, recipient: "5519988887777", message: MENSAGEM_CONFIRMACAO, ocorridoEm: confirmacao.ocorridoEm };
  await repositorio.registrar(registro);
  await repositorio.registrar(registro);
  assert.deepEqual(chamadas[0], chamadas[1], "repeticao leva a mesma chave deduplicada no SQL");
  const job = await repositorio.reivindicar();
  assert.equal(job?.id, ID); assert.equal(job?.leaseToken, TOKEN);
  assert.equal(await repositorio.resultado(ID, { leaseToken: TOKEN, outcome: "started" }), "enviando");
  assert.deepEqual(chamadas.at(-1)?.corpo, { p_id: ID, p_lease_token: TOKEN, p_outcome: "started", p_code: null });
});

test("SDK distingue claim vazio, CAS recusado e erro de banco", async () => {
  const vazio = criarRepositorioWhatsApp(sdkFicticio((nome) => Response.json(nome === "reivindicar_whatsapp" ? [] : null)));
  assert.equal(await vazio.reivindicar(), null);
  assert.equal(await vazio.resultado(ID, { leaseToken: TOKEN, outcome: "started" }), null);
  const erro = criarRepositorioWhatsApp(sdkFicticio(() => Response.json({ message: "privado", code: "XX000" }, { status: 500 })));
  await assert.rejects(erro.reivindicar(), /claim_whatsapp/);
  await assert.rejects(erro.resultado(ID, { leaseToken: TOKEN, outcome: "sent" }), /resultado_whatsapp/);
});
