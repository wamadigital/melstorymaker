import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import type { Categoria, Respostas, Status } from "@/lib/form/types";

// O SDK usa exclusivamente REST/CAPI ficticios. Nunca ler .env.local.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://criacao-ficticia.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-ficticio",
  SUPABASE_SERVICE_ROLE_KEY: "service-ficticio",
  MAIL_FROM: "Mel <mel@example.invalid>",
  MAIL_DRY_RUN: "1",
  APP_URL: "https://melstorymaker.invalid",
  MEL_WHATSAPP: "5519988887777",
  META_PIXEL_ID: "1234567890123456",
  META_CAPI_TOKEN: "token-ficticio",
  META_CAPI_TEST_CODE: "TEST_FICTICIO",
});

const nextServer = createRequire(import.meta.url)("next/server") as { after: (tarefa: () => unknown) => void };
const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
type Linha = {
  id: string; categoria: Categoria; status: Status; respostas: Respostas; passo_atual: string | null;
  [chave: string]: unknown;
};
const inicial = (): Linha => ({
  id: ID, categoria: "casamento", status: "incompleto",
  respostas: { contato_whatsapp: "19988887777", nome: "Ana ficticia" }, passo_atual: "nome",
  rastreio: { ua: "Dado privado" }, email: "privado@example.invalid", pdf_url: "arquivo-privado",
  updated_at: "2026-10-08T00:00:00Z",
});
const payload = () => ({
  tentativa_id: ID, categoria: "casamento",
  respostas: { contato_whatsapp: "19988887777" }, passo_atual: "nome",
});

function trava() {
  let abrir!: () => void;
  const espera = new Promise<void>((resolve) => { abrir = resolve; });
  return { espera, abrir };
}

function bancoFalso(linhas: Linha[] = []) {
  const salvas = new Map(linhas.map((l) => [l.id, structuredClone(l)]));
  const consultas: URLSearchParams[] = [];
  const conversoes: Record<string, unknown>[] = [];
  let antesDeInserir: (() => Promise<void>) | null = null;
  let codigoErro: string | null = null;
  let perderResposta = false;
  let erroLeitura = false;
  let insercoes = 0;
  let rastreios = 0;
  const fetchFalso = async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    if (url.hostname === "graph.facebook.com") {
      conversoes.push(...JSON.parse(String(init?.body)).data);
      return Response.json({ events_received: 1 });
    }
    assert.equal(url.hostname, "criacao-ficticia.invalid", "rede externa sem mock e proibida");
    if (url.pathname === "/rest/v1/rpc/reivindicar_meta_crm") return Response.json([]);
    assert.equal(url.pathname, "/rest/v1/leads");
    const projetar = (l: Linha) => Object.fromEntries(
      (url.searchParams.get("select") ?? "").split(",").map((k) => [k, l[k]]),
    );
    if (init?.method === "POST") {
      await antesDeInserir?.();
      if (codigoErro) return Response.json({ message: "Erro ficticio de banco", code: codigoErro }, { status: 500 });
      const l = JSON.parse(String(init.body)) as Linha;
      l.id ??= randomUUID();
      if (salvas.has(l.id)) return Response.json({ message: "UUID ja existe", code: "23505" }, { status: 409 });
      salvas.set(l.id, structuredClone(l));
      insercoes += 1;
      if (perderResposta) {
        perderResposta = false;
        throw new TypeError("ACK ficticio do banco perdido apos INSERT");
      }
      return Response.json(projetar(l), { status: 201 });
    }
    const id = url.searchParams.get("id")?.slice(3);
    assert.ok(id, "leitura/edicao exige UUID especifico");
    if ((init?.method ?? "GET") === "GET") {
      consultas.push(new URLSearchParams(url.search));
      if (erroLeitura) return Response.json({ message: "Leitura ficticia falhou", code: "XX000" }, { status: 500 });
      const l = salvas.get(id);
      return Response.json(l ? [projetar(l)] : []);
    }
    assert.ok(init);
    assert.equal(init.method, "PATCH");
    const patch = JSON.parse(String(init.body));
    assert.deepEqual(Object.keys(patch), ["rastreio"], "replay nunca pode sobrescrever lead");
    salvas.set(id, { ...salvas.get(id)!, ...patch });
    rastreios += 1;
    return new Response(null, { status: 204 });
  };
  return {
    fetchFalso, salvas, consultas, conversoes,
    get insercoes() { return insercoes; }, get rastreios() { return rastreios; },
    bloquearInsert(fn: () => Promise<void>) { antesDeInserir = fn; },
    falharInsert(codigo: string) { codigoErro = codigo; },
    falharLeitura() { erroLeitura = true; },
    perderProximoAckBanco() { perderResposta = true; },
  };
}

let ip = 0;
const requisicao = (corpo: unknown) => new Request("https://melstorymaker.invalid/api/leads", {
  method: "POST", body: JSON.stringify(corpo),
  headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}`, "user-agent": "Navegador ficticio", referer: "https://melstorymaker.invalid/formulario",
    cookie: "_fbp=fb.1.1791580000000.123456789; _fbc=fb.1.1791580000000.clique-ficticio" },
});

async function comBanco(linhas: Linha[], verificar: (banco: ReturnType<typeof bancoFalso>, tarefas: (() => unknown)[]) => Promise<void>) {
  const banco = bancoFalso(linhas);
  const tarefas: (() => unknown)[] = [];
  mock.method(globalThis, "fetch", banco.fetchFalso);
  mock.method(nextServer, "after", (tarefa: () => unknown) => { tarefas.push(tarefa); });
  try { await verificar(banco, tarefas); } finally { mock.restoreAll(); }
}

test("POSTs concorrentes da mesma tentativa criam um lead e uma copia CAPI", async () => {
  await comBanco([], async (banco, tarefas) => {
    const { POST } = await import("./route");
    const barreira = trava();
    let tentativas = 0;
    banco.bloquearInsert(async () => { if (++tentativas === 2) barreira.abrir(); await barreira.espera; });
    const r = await Promise.all([POST(requisicao(payload())), POST(requisicao(payload()))]);
    assert.deepEqual(r.map((s) => s.status).sort(), [200, 201]);
    assert.equal(banco.salvas.size, 1);
    assert.equal(banco.insercoes, 1);
    assert.equal(tarefas.length, 1);
    assert.equal(banco.consultas[0].get("id"), `eq.${ID}`);
    const tracking = banco.salvas.get(ID)!.rastreio as Record<string, unknown>;
    assert.equal(tracking.ua, "Navegador ficticio", "atribuicao nasce antes do after/cron");
    assert.equal(tracking.fbp, "fb.1.1791580000000.123456789");
    assert.equal(tracking.fbc, "fb.1.1791580000000.clique-ficticio");
    await tarefas[0]();
    assert.equal(banco.rastreios, 0, "rastreio pertence ao INSERT, sem UPDATE pos-resposta");
    assert.equal(banco.conversoes.length, 1);
    assert.equal(banco.conversoes[0].event_name, "Lead");
    assert.equal(banco.conversoes[0].event_id, `lead_${ID}`);
  });
});

test("ACK HTTP perdido apos criacao: repetir a tentativa recupera sem novos efeitos", async () => {
  await comBanco([], async (banco, tarefas) => {
    const { POST } = await import("./route");
    const primeiro = await POST(requisicao(payload()));
    assert.equal(primeiro.status, 201); // Resposta descartada como se o navegador nao a recebesse.
    const recuperado = await POST(requisicao(payload()));
    assert.equal(recuperado.status, 200);
    assert.equal((await recuperado.json()).id, ID);
    assert.equal(banco.insercoes, 1);
    assert.equal(tarefas.length, 1);
  });
});

test("ACK do banco perdido apos INSERT tambem recupera a identidade sem duplicar", async () => {
  await comBanco([], async (banco, tarefas) => {
    const { POST } = await import("./route");
    banco.perderProximoAckBanco();
    const perdido = await POST(requisicao(payload()));
    assert.equal(perdido.status, 500);
    const trackingOriginal = structuredClone(banco.salvas.get(ID)!.rastreio);
    const recuperado = await POST(requisicao(payload()));
    assert.equal(recuperado.status, 200);
    assert.equal((await recuperado.json()).id, ID);
    assert.equal(banco.insercoes, 1);
    assert.deepEqual(banco.salvas.get(ID)!.rastreio, trackingOriginal, "ACK perdido nao perde nem reescreve atribuicao");
    assert.equal(tarefas.length, 0, "resultado incerto nao agenda CAPI nem replay cria efeito");
  });
});

test("falha diferente de 23505 nao recupera outro lead nem agenda efeitos", async () => {
  for (const codigo of ["XX000", "42501", "23503"]) {
    await comBanco([inicial()], async (banco, tarefas) => {
      const { POST } = await import("./route");
      banco.falharInsert(codigo);
      const r = await POST(requisicao(payload()));
      assert.equal(r.status, 500);
      assert.equal(banco.consultas.length, 0);
      assert.equal(tarefas.length, 0);
      assert.equal(banco.insercoes, 0);
    });
  }
});

test("23505 recupera somente o UUID solicitado; ausencia ou falha de leitura continua 500", async () => {
  for (const falhaLeitura of [false, true]) {
    await comBanco([inicial()], async (banco, tarefas) => {
      const { POST } = await import("./route");
      banco.falharInsert("23505");
      if (falhaLeitura) banco.falharLeitura();
      const outroId = "b5b72fc4-d18c-47ec-b122-21c31589e874";
      const r = await POST(requisicao({ ...payload(), tentativa_id: outroId }));
      assert.equal(r.status, 500);
      assert.equal(banco.consultas[0].get("id"), `eq.${outroId}`);
      assert.equal(tarefas.length, 0);
      assert.equal(banco.salvas.size, 1);
    });
  }
});

test("clientes legados sem tentativa continuam criando IDs distintos", async () => {
  await comBanco([], async (banco, tarefas) => {
    const { POST } = await import("./route");
    const a = await POST(requisicao({ categoria: "casamento" }));
    const b = await POST(requisicao({ categoria: "casamento" }));
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual((await a.json()).id, (await b.json()).id);
    assert.equal(banco.insercoes, 2);
    assert.equal(tarefas.length, 2);
    banco.falharInsert("23505");
    const erro = await POST(requisicao({ categoria: "casamento" }));
    assert.equal(erro.status, 500);
    assert.equal(banco.consultas.length, 0, "23505 sem identidade nao recupera nada");
  });
});

test("tentativa de lead fechado recupera estado atual sem reabrir ou expor campos privados", async () => {
  const salvo = { ...inicial(), categoria: "debutante" as const, status: "enviado" as const };
  await comBanco([salvo], async (banco, tarefas) => {
    const { POST } = await import("./route");
    const r = await POST(requisicao(payload()));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      id: salvo.id, categoria: salvo.categoria, passo_atual: salvo.passo_atual,
      respostas: salvo.respostas, status: salvo.status,
    });
    assert.deepEqual(banco.salvas.get(ID), salvo);
    assert.equal(tarefas.length, 0);
    assert.equal(banco.insercoes, 0);
  });
});

test("tentativa invalida retorna 400 e passo null novo segue normalizacao existente", async () => {
  await comBanco([], async (banco, tarefas) => {
    const { POST } = await import("./route");
    for (const tentativa_id of ["nao-uuid", "", null, 123]) {
      assert.equal((await POST(requisicao({ ...payload(), tentativa_id }))).status, 400);
    }
    assert.equal(banco.insercoes, 0);
    const novo = await POST(requisicao({ ...payload(), passo_atual: null }));
    assert.equal(novo.status, 201);
    const ack = await novo.json();
    assert.equal(ack.passo_atual, "contato_whatsapp");
    assert.equal(ack.status, "incompleto");
    assert.deepEqual(Object.keys(ack).sort(), ["categoria", "id", "passo_atual", "respostas", "status"]);
    assert.equal(tarefas.length, 1);
  });
});
