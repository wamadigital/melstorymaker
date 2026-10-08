import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import type { Categoria, Respostas, Status } from "@/lib/form/types";
import type { BaseLead } from "@/lib/form/versao-lead";

// Nunca carrega .env.local. O SDK real fala exclusivamente com o REST falso
// abaixo; notificacao e CAPI tambem sao interceptadas, com credenciais ficticias.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://banco-ficticio.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-ficticio",
  SUPABASE_SERVICE_ROLE_KEY: "service-ficticio",
  MAIL_FROM: "Mel <mel@example.invalid>",
  MAIL_DRY_RUN: "1",
  APP_URL: "https://melstorymaker.invalid",
  MEL_WHATSAPP: "5519988887777",
  NOTIFICA_WHATSAPP_APIKEY: "apikey-ficticia",
  NOTIFICA_DRY_RUN: "0",
  META_PIXEL_ID: "1234567890123456",
  META_CAPI_TOKEN: "token-ficticio",
  META_CAPI_TEST_CODE: "TEST_FICTICIO",
});

const require = createRequire(import.meta.url);
const nextServer = require("next/server") as { after: (tarefa: () => unknown) => void };
const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
type Linha = { id: string; categoria: Categoria; status: Status; respostas: Respostas | null; passo_atual: string | null; updated_at: string; rastreio?: unknown };
const completas: Respostas = {
  contato_whatsapp: "19988887777", nome: "Ana Fictícia", noivos: "Ana & João",
  data: "2099-10-10", horario: "16:00", local_cerimonia: "Cerimônia fictícia",
  local_festa: "Festa fictícia", making_of: "Não", entrega: "Em tempo real",
  contato_email: "ana@example.invalid",
};
const timestamp = (n: number) => new Date(Date.UTC(2026, 9, 8) + n).toISOString();
const linha = (respostas: Respostas | null = completas): Linha => ({ id: ID, categoria: "casamento", status: "incompleto", respostas: structuredClone(respostas), passo_atual: "contato_email", updated_at: timestamp(0) });
const base = (l: Linha): BaseLead => ({ categoria: l.categoria, respostas: l.respostas ?? {}, passo_atual: l.passo_atual });

function trava() {
  let abrir!: () => void;
  const espera = new Promise<void>((resolve) => { abrir = resolve; });
  return { espera, abrir };
}

/** SDK real, transporte controlado; timestamp e filtros SQL simulados. */
function bancoFalso(inicial: Linha) {
  let atual = structuredClone(inicial);
  let revisao = 0;
  const efeitos = { notificacoes: 0, conversoes: [] as Record<string, unknown>[] };
  let antesDaEscrita: ((patch: Record<string, unknown>) => Promise<void> | void) | undefined;
  let antesDaLeitura: (() => Promise<void> | void) | undefined;
  let erroEscrita = false;
  let erroLeitura = false;
  let perderRespostaEscrita = false;
  const filtros: URLSearchParams[] = [];
  const fetchFalso = async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    if (url.hostname === "api.callmebot.com") {
      efeitos.notificacoes += 1;
      return new Response("Message queued");
    }
    if (url.hostname === "graph.facebook.com") {
      const enviado = JSON.parse(String(init?.body));
      efeitos.conversoes.push(...enviado.data);
      return Response.json({ events_received: enviado.data.length });
    }
    assert.equal(url.hostname, "banco-ficticio.invalid", "qualquer rede nao mockada e proibida");
    assert.equal(url.pathname, "/rest/v1/leads");
    assert.ok(url.href.length < 8000, "respostas grandes nunca entram na URI do CAS");
    const projetar = (lido: Linha) => Object.fromEntries(
      (url.searchParams.get("select") ?? "").split(",").map((chave) => [chave, lido[chave as keyof Linha]]),
    );
    if ((init?.method ?? "GET") === "GET") {
      const lido = structuredClone(atual);
      await antesDaLeitura?.();
      if (erroLeitura) return Response.json({ message: "erro ficticio", code: "XX000" }, { status: 500 });
      return Response.json([projetar(lido)]);
    }
    assert.equal(init?.method, "PATCH");
    const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
    await antesDaEscrita?.(patch);
    if (erroEscrita) return Response.json({ message: "erro ficticio", code: "XX000" }, { status: 500 });
    filtros.push(new URLSearchParams(url.search));
    const bate = [...url.searchParams].every(([chave, valor]) => {
      if (chave === "select") return true;
      const salvo = atual[chave as keyof Linha];
      if (valor === "is.null") return salvo === null;
      return valor === `eq.${salvo}`;
    });
    if (!bate) return Response.json([]);
    atual = { ...atual, ...patch, updated_at: timestamp(++revisao) } as Linha;
    if (perderRespostaEscrita) {
      perderRespostaEscrita = false;
      throw new TypeError("Resposta perdida depois de gravar no banco ficticio");
    }
    return Response.json([projetar(structuredClone(atual))]);
  };
  return {
    fetchFalso, efeitos, filtros,
    get linha() { return structuredClone(atual); },
    mudar(patch: Partial<Linha>) { atual = { ...atual, ...structuredClone(patch), updated_at: timestamp(++revisao) }; },
    antesDeGravar(fn: typeof antesDaEscrita) { antesDaEscrita = fn; },
    antesDeLer(fn: typeof antesDaLeitura) { antesDaLeitura = fn; },
    falharEscrita() { erroEscrita = true; },
    falharLeitura() { erroLeitura = true; },
    perderProximaRespostaEscrita() { perderRespostaEscrita = true; },
  };
}

let ip = 0;
const requisicao = (metodo: string, corpo?: unknown) => new Request(`https://melstorymaker.invalid/api/leads/${ID}${metodo === "POST" ? "/submit" : ""}`, {
  method: metodo,
  headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ip}`, "user-agent": "Navegador ficticio", referer: "https://melstorymaker.invalid/formulario" },
  ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
});
const ctx = { params: Promise.resolve({ id: ID }) };

async function comBanco(inicial: Linha, verificar: (banco: ReturnType<typeof bancoFalso>, depois: (() => unknown)[]) => Promise<void>) {
  const banco = bancoFalso(inicial);
  const depois: (() => unknown)[] = [];
  mock.method(globalThis, "fetch", banco.fetchFalso);
  mock.method(nextServer, "after", (tarefa: () => unknown) => { depois.push(tarefa); });
  try { await verificar(banco, depois); } finally { mock.restoreAll(); }
}

test("dois POSTs lendo incompleto juntos: so o UPDATE vencedor notifica e envia CAPI", async () => {
  await comBanco(linha(), async (banco, depois) => {
    const { POST } = await import("./submit/route");
    const barreira = trava();
    let leituras = 0;
    banco.antesDeLer(async () => {
      if (++leituras <= 2) { if (leituras === 2) barreira.abrir(); await barreira.espera; }
    });
    const respostas = await Promise.all([POST(requisicao("POST"), ctx), POST(requisicao("POST"), ctx)]);
    assert.deepEqual(respostas.map((r) => r.status), [200, 200]);
    assert.equal(banco.linha.status, "aguardando_revisao");
    assert.equal(depois.length, 2, "apenas vencedor agenda notificacao e CAPI");
    await Promise.all(depois.map((executar) => executar()));
    assert.equal(banco.efeitos.notificacoes, 1);
    assert.equal(banco.efeitos.conversoes.length, 1);
    assert.equal(banco.efeitos.conversoes[0].event_name, "SubmitApplication");
    assert.equal(banco.efeitos.conversoes[0].event_id, `submit_${ID}`);
    const repetido = await POST(requisicao("POST"), ctx);
    assert.equal(repetido.status, 200);
    assert.equal(depois.length, 2, "repeticao nao agenda efeito nenhum");
  });
});

test("submit recusa a base antiga antes da escrita, sem efeitos", async () => {
  const antiga = linha();
  await comBanco(linha({ ...completas, nome: "Mudou em outra aba" }), async (_banco, depois) => {
    const { POST } = await import("./submit/route");
    const r = await POST(requisicao("POST", { base: base(antiga) }), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "conflito_respostas");
    assert.equal(depois.length, 0);
  });
});

test("novo submit em formulario fechado confirma so a mesma base; outra versao e conflito", async () => {
  const original = linha();
  await comBanco({ ...original, status: "aguardando_revisao" }, async (_banco, depois) => {
    const { POST } = await import("./submit/route");
    const mesmo = await POST(requisicao("POST", { base: base(original) }), ctx);
    assert.equal(mesmo.status, 200);
    const divergente = await POST(requisicao("POST", { base: { ...base(original), respostas: { ...completas, nome: "Rascunho nao enviado" } } }), ctx);
    assert.equal(divergente.status, 409);
    assert.equal((await divergente.json()).codigo, "conflito_respostas");
    const legado = await POST(requisicao("POST"), ctx);
    assert.equal(legado.status, 200, "POST anterior sem base mantem compatibilidade");
    assert.equal(depois.length, 0);
  });
});

test("POST legado aceita stream vazio ou whitespace; JSON malformado continua 400", async () => {
  await comBanco({ ...linha(), status: "aguardando_revisao" }, async (_banco, depois) => {
    const { POST } = await import("./submit/route");
    for (const texto of ["", "   ", "{malformado"]) {
      const req = new Request(`https://melstorymaker.invalid/api/leads/${ID}/submit`, {
        method: "POST", body: texto,
        headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ip}` },
      });
      assert.notEqual(req.body, null, "cobre stream presente mesmo sem JSON");
      const r = await POST(req, ctx);
      assert.equal(r.status, texto === "{malformado" ? 400 : 200);
    }
    assert.equal(depois.length, 0);
  });
});

test("outra aba fecha versao diferente durante submit: perdedor nao confirma seu rascunho", async () => {
  const original = linha();
  await comBanco(original, async (banco, depois) => {
    const { POST } = await import("./submit/route");
    banco.antesDeGravar(() => banco.mudar({ status: "aguardando_revisao", respostas: { ...completas, nome: "Outra aba enviou" } }));
    const r = await POST(requisicao("POST", { base: base(original) }), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "conflito_respostas");
    assert.equal(banco.linha.respostas?.nome, "Outra aba enviou");
    assert.equal(depois.length, 0);
  });
});

test("autosave entre validacao e UPDATE do submit nao fecha a versao validada anterior", async () => {
  await comBanco(linha(), async (banco, depois) => {
    const { POST } = await import("./submit/route");
    banco.antesDeGravar(() => banco.mudar({ respostas: { ...completas, contato_email: "" } }));
    const r = await POST(requisicao("POST"), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "conflito_respostas");
    assert.equal(banco.linha.status, "incompleto");
    assert.equal(banco.linha.respostas?.contato_email, "");
    assert.equal(depois.length, 0);
  });
});

test("falha de leitura ou UPDATE e formulario invalido nao geram efeitos de submit", async () => {
  const { POST } = await import("./submit/route");
  for (const caso of ["leitura", "escrita", "invalido"] as const) {
    await comBanco(linha(caso === "invalido" ? {} : completas), async (banco, depois) => {
      if (caso === "leitura") banco.falharLeitura();
      if (caso === "escrita") banco.falharEscrita();
      const r = await POST(requisicao("POST"), ctx);
      assert.equal(r.status, caso === "invalido" ? 422 : 500);
      assert.equal(banco.linha.status, "incompleto");
      assert.equal(depois.length, 0);
    });
  }
});

test("PATCHs sobre a mesma leitura: o antigo que termina depois nao apaga a resposta nova", async () => {
  await comBanco(linha({ contato_whatsapp: "19988887777" }), async (banco) => {
    const { PATCH } = await import("./route");
    const leu = trava();
    const novoGravou = trava();
    let leituras = 0;
    banco.antesDeLer(async () => { if (++leituras === 2) leu.abrir(); await leu.espera; });
    banco.antesDeGravar(async (patch) => {
      if ((patch.respostas as Respostas).nome === "Snapshot antigo") await novoGravou.espera;
    });
    const antigo = PATCH(requisicao("PATCH", { respostas: { nome: "Snapshot antigo" }, passo_atual: "noivos" }), ctx);
    const novo = await PATCH(requisicao("PATCH", { respostas: { nome: "Snapshot novo", noivos: "Ana & João" }, passo_atual: "data" }), ctx);
    novoGravou.abrir();
    const recusado = await antigo;
    assert.equal(novo.status, 200);
    assert.equal(recusado.status, 409);
    assert.equal((await recusado.json()).codigo, "conflito_respostas");
    assert.equal(banco.linha.respostas?.nome, "Snapshot novo");
    assert.equal(banco.linha.respostas?.noivos, "Ana & João");
    assert.equal(banco.linha.passo_atual, "data");
  });
});

test("PATCH com baseline antigo apos outra aba salvar e recusado, preservando servidor", async () => {
  const antiga = linha({ contato_whatsapp: "19988887777" });
  const atual = linha({ ...antiga.respostas, nome: "Outra aba" });
  await comBanco(atual, async (banco) => {
    const { PATCH } = await import("./route");
    const r = await PATCH(requisicao("PATCH", { base: base(antiga), categoria: antiga.categoria, respostas: { ...antiga.respostas, nome: "Antigo" }, passo_atual: antiga.passo_atual }), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "conflito_respostas");
    assert.equal(banco.linha.respostas?.nome, "Outra aba");
    assert.equal(banco.filtros.length, 0);
  });
});

test("PATCH gravado perde a resposta: replay completo com base antiga recebe ACK sem novo UPDATE", async () => {
  const inicial = linha();
  await comBanco(inicial, async (banco) => {
    const { PATCH } = await import("./route");
    const payload = { categoria: inicial.categoria, respostas: { ...completas, nome: "Snapshot confirmado" }, passo_atual: "noivos", base: base(inicial) };
    banco.perderProximaRespostaEscrita();
    const perdeu = await PATCH(requisicao("PATCH", payload), ctx);
    assert.equal(perdeu.status, 500);
    assert.equal(banco.linha.respostas?.nome, "Snapshot confirmado");
    const replay = await PATCH(requisicao("PATCH", payload), ctx);
    assert.equal(replay.status, 200);
    const ack = await replay.json();
    assert.deepEqual(ack.respostas, payload.respostas);
    assert.equal(ack.categoria, payload.categoria);
    assert.equal(ack.passo_atual, payload.passo_atual);
    assert.equal(banco.filtros.length, 1, "replay so confirma: nao executa outro UPDATE");
  });
});

test("baseline antigo com payload parcial nao e replay dos dados acrescentados em outra aba", async () => {
  const inicial = linha({ contato_whatsapp: "19988887777", nome: "Ana" });
  const atual = linha({ ...inicial.respostas, noivos: "Salvo em outra aba" });
  await comBanco(atual, async (banco) => {
    const { PATCH } = await import("./route");
    const r = await PATCH(requisicao("PATCH", { categoria: atual.categoria, respostas: inicial.respostas, passo_atual: atual.passo_atual, base: base(inicial) }), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "conflito_respostas");
    assert.equal(banco.filtros.length, 0);
    assert.equal(banco.linha.respostas?.noivos, "Salvo em outra aba");
  });
});

test("submit vence enquanto PATCH esta em voo: PATCH nao altera formulario fechado", async () => {
  await comBanco(linha(), async (banco, depois) => {
    const { PATCH } = await import("./route");
    const { POST } = await import("./submit/route");
    const patchLeu = trava();
    const submitGravou = trava();
    banco.antesDeGravar(async (patch) => {
      if (patch.status === "aguardando_revisao") return;
      patchLeu.abrir();
      await submitGravou.espera;
    });
    const atrasado = PATCH(requisicao("PATCH", { respostas: { contato_email: "" } }), ctx);
    await patchLeu.espera;
    const enviado = await POST(requisicao("POST", { base: base(banco.linha) }), ctx);
    submitGravou.abrir();
    assert.equal(enviado.status, 200);
    assert.equal((await atrasado).status, 409);
    assert.equal(banco.linha.status, "aguardando_revisao");
    assert.equal(banco.linha.respostas?.contato_email, completas.contato_email);
    assert.equal(depois.length, 2);
  });
});

test("erro ao conferir perdedor do submit nao informa sucesso nem agenda efeitos", async () => {
  await comBanco(linha(), async (banco, depois) => {
    const { POST } = await import("./submit/route");
    banco.antesDeGravar(() => {
      banco.mudar({ respostas: { ...completas, nome: "Outra aba" } });
      banco.falharLeitura();
    });
    const r = await POST(requisicao("POST"), ctx);
    assert.equal(r.status, 500);
    assert.equal(banco.linha.status, "incompleto");
    assert.equal(depois.length, 0);
  });
});

test("baseline ignora ordem JSON; rastreio concorrente exige releitura sem falso conflito", async () => {
  const inicial = linha({ nome: "Ana", contato_whatsapp: "19988887777" });
  await comBanco(inicial, async (banco) => {
    const { PATCH } = await import("./route");
    let tentativas = 0;
    banco.antesDeGravar(() => { if (++tentativas === 1) banco.mudar({ rastreio: { ua: "Navegador guardado depois" } }); });
    const r = await PATCH(requisicao("PATCH", { categoria: inicial.categoria, base: { ...base(inicial), respostas: { contato_whatsapp: "19988887777", nome: "Ana" } }, respostas: { ...inicial.respostas, noivos: "Ana & João" }, passo_atual: "data" }), ctx);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).respostas.noivos, "Ana & João");
    assert.equal(banco.filtros.length, 2);
    assert.equal(banco.filtros[0].get("updated_at"), `eq.${timestamp(0)}`);
    assert.equal(banco.filtros[1].get("updated_at"), `eq.${timestamp(1)}`);
    for (const filtro of banco.filtros) {
      assert.equal(filtro.has("categoria"), false);
      assert.equal(filtro.has("respostas"), false);
      assert.equal(filtro.has("passo_atual"), false);
    }
  });
});

test("submit repete somente zero linhas por rastreio e agenda efeitos uma vez", async () => {
  const inicial = linha();
  await comBanco(inicial, async (banco, depois) => {
    const { POST } = await import("./submit/route");
    let tentativas = 0;
    banco.antesDeGravar(() => { if (++tentativas === 1) banco.mudar({ rastreio: { ua: "Rastreio concorrente" } }); });
    const r = await POST(requisicao("POST", { base: base(inicial) }), ctx);
    assert.equal(r.status, 200);
    assert.equal(banco.filtros.length, 2);
    assert.equal(banco.linha.status, "aguardando_revisao");
    assert.equal(depois.length, 2);
  });
});

test("tres atualizacoes de metadados esgotam escrita com 500, sem falso conflito ou efeitos", async () => {
  for (const metodo of ["PATCH", "POST"] as const) {
    const inicial = linha();
    await comBanco(inicial, async (banco, depois) => {
      const { PATCH } = await import("./route");
      const { POST } = await import("./submit/route");
      let tentativas = 0;
      banco.antesDeGravar(() => banco.mudar({ rastreio: { tentativa: ++tentativas } }));
      const payload = metodo === "POST" ? { base: base(inicial) } : { ...base(inicial), base: base(inicial) };
      const r = await (metodo === "POST" ? POST : PATCH)(requisicao(metodo, payload), ctx);
      assert.equal(r.status, 500);
      assert.equal((await r.json()).codigo, undefined, "erro repetivel nao e conflito de respostas");
      assert.equal(banco.filtros.length, 3);
      assert.equal(banco.linha.status, "incompleto");
      assert.deepEqual(banco.linha.respostas, inicial.respostas);
      assert.equal(depois.length, 0);
    });
  }
});

test("respostas mudando depois de uma releitura de rastreio continuam protegidas", async () => {
  const inicial = linha();
  await comBanco(inicial, async (banco) => {
    const { PATCH } = await import("./route");
    let tentativas = 0;
    banco.antesDeGravar(() => banco.mudar(++tentativas === 1
      ? { rastreio: { ua: "Primeira mudanca" } }
      : { respostas: { ...completas, nome: "Outra aba venceu" } }));
    const r = await PATCH(requisicao("PATCH", { ...base(inicial), respostas: { ...completas, nome: "Nao sobrescrever" }, base: base(inicial) }), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "conflito_respostas");
    assert.equal(banco.filtros.length, 2);
    assert.equal(banco.linha.respostas?.nome, "Outra aba venceu");
  });
});

test("baseline com 64 mil caracteres salva e conclui sem respostas na URL", async () => {
  const longas = { ...completas, noivos: "A".repeat(64_000) };
  const inicial = linha(longas);
  await comBanco(inicial, async (banco, depois) => {
    const { GET, PATCH } = await import("./route");
    const { POST } = await import("./submit/route");
    const r = await PATCH(requisicao("PATCH", { ...base(inicial), respostas: { ...longas, nome: "Nome atualizado" }, base: base(inicial) }), ctx);
    assert.equal(r.status, 200);
    const ack = await r.json();
    assert.equal(ack.respostas.noivos.length, 64_000);
    assert.equal(ack.updated_at, undefined, "timestamp permanece interno");
    const leitura = await GET(requisicao("GET"), ctx);
    assert.equal((await leitura.json()).updated_at, undefined);
    const enviado = await POST(requisicao("POST", { base: base(banco.linha) }), ctx);
    assert.equal(enviado.status, 200);
    assert.equal(depois.length, 2);
    assert.ok(banco.filtros.every((f) => !f.has("respostas")));
  });
});

test("CAS de categoria ou passo alterado recusa PATCH mesmo com respostas iguais", async () => {
  for (const patch of [{ categoria: "debutante" as const }, { passo_atual: "nome" }]) {
    await comBanco(linha(), async (banco) => {
      const { PATCH } = await import("./route");
      banco.antesDeGravar(() => banco.mudar(patch));
      const r = await PATCH(requisicao("PATCH", { respostas: { nome: "Antigo" } }), ctx);
      assert.equal(r.status, 409);
      assert.equal((await r.json()).codigo, "conflito_respostas");
      assert.equal(banco.linha.respostas?.nome, completas.nome);
    });
  }
});

test("snapshot com base remove respostas antigas apos categoria A -> B -> A coalescida", async () => {
  const inicial = linha({ contato_whatsapp: "19988887777", nome: "Ana", noivos: "Resposta anterior de casamento" });
  await comBanco(inicial, async (banco) => {
    const { PATCH } = await import("./route");
    // A fila reteve so o estado final: categoria casamento, mas o usuario
    // limpou as respostas do fluxo ao passar pela outra categoria.
    const r = await PATCH(requisicao("PATCH", {
      base: base(inicial), categoria: inicial.categoria,
      respostas: { contato_whatsapp: "19988887777" }, passo_atual: "nome",
    }), ctx);
    assert.equal(r.status, 200);
    assert.deepEqual(banco.linha.respostas, { contato_whatsapp: "19988887777" });
    assert.equal(banco.linha.passo_atual, "nome");
    const legado = await PATCH(requisicao("PATCH", { respostas: { nome: "Novo nome" } }), ctx);
    assert.equal(legado.status, 200);
    assert.deepEqual(banco.linha.respostas, { contato_whatsapp: "19988887777", nome: "Novo nome" }, "delta legado continua mesclando");
  });
});

test("PATCH com base exige os tres campos do snapshot; incompleto retorna 400 sem escrita", async () => {
  const inicial = linha();
  await comBanco(inicial, async (banco) => {
    const { PATCH } = await import("./route");
    const completo = { categoria: inicial.categoria, respostas: inicial.respostas, passo_atual: inicial.passo_atual };
    for (const campo of ["categoria", "respostas", "passo_atual"] as const) {
      const faltando = { ...completo };
      delete (faltando as Partial<typeof completo>)[campo];
      const r = await PATCH(requisicao("PATCH", { ...faltando, base: base(inicial) }), ctx);
      assert.equal(r.status, 400);
    }
    assert.equal(banco.filtros.length, 0);
    assert.deepEqual(banco.linha, inicial);
  });
});

test("CAS lida com respostas/passo nulos de lead legado sem filtros JSON", async () => {
  await comBanco({ ...linha(null), passo_atual: null }, async (banco) => {
    const { PATCH } = await import("./route");
    const r = await PATCH(requisicao("PATCH", { respostas: { contato_whatsapp: "19988887777" }, passo_atual: null }), ctx);
    assert.equal(r.status, 200);
    assert.equal(banco.filtros[0].get("updated_at"), `eq.${timestamp(0)}`);
    assert.equal(banco.filtros[0].has("respostas"), false);
    assert.equal(banco.filtros[0].has("passo_atual"), false);
  });
});

test("PATCH em formulario fechado ou com erro de escrita nao mente que salvou", async () => {
  const { PATCH } = await import("./route");
  await comBanco({ ...linha(), status: "aguardando_revisao" }, async () => {
    const r = await PATCH(requisicao("PATCH", { respostas: { nome: "Novo" } }), ctx);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).codigo, "formulario_enviado");
  });
  await comBanco(linha(), async (banco) => {
    banco.falharEscrita();
    const r = await PATCH(requisicao("PATCH", { respostas: { nome: "Novo" } }), ctx);
    assert.equal(r.status, 500);
    assert.equal(banco.linha.respostas?.nome, completas.nome);
  });
});
