import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { tratarQualificacao } from "./_handler";

// SDK real + REST inteiramente fictício. Não carrega .env.local, não usa
// Supabase/Auth/Meta real e recusa qualquer host fora deste banco de teste.
const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
const INSTANTE = "2026-10-09T18:00:00+00:00";
type Linha = { id: string; qualificado_em: string | null; whatsapp: string | null; status: string; updated_at: string; respostas: Record<string, string> };
const linha = (qualificadoEm: string | null = null): Linha => ({
  id: ID, qualificado_em: qualificadoEm, whatsapp: "19988887777",
  status: "incompleto", updated_at: "2026-10-09T12:00:00Z",
  respostas: { nome: "Ana fictícia", contato_whatsapp: "19988887777" },
});
const req = (corpo: unknown) => new Request(`https://melstorymaker.invalid/api/admin/leads/${ID}/qualificacao`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
});
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const payload = (qualificado: boolean, base: string | null = null) => ({ qualificado, base_qualificado_em: base });
function trava() {
  let abrir!: () => void;
  const espera = new Promise<void>((resolve) => { abrir = resolve; });
  return { espera, abrir };
}

function bancoFicticio(inicial: Linha | null = linha()) {
  let atual = structuredClone(inicial);
  let antesDeEscrever: (() => void | Promise<void>) | undefined;
  let antesDeLer: (() => void | Promise<void>) | undefined;
  let erroLeitura: string | null = null;
  let erroEscrita: string | null = null;
  let autenticado = true;
  let consultas = 0;
  let escritas = 0;
  const patches: Record<string, unknown>[] = [];
  const filtros: URLSearchParams[] = [];
  const tarefas: (() => Promise<void>)[] = [];
  const despachados: string[] = [];
  const fetchFalso = async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    assert.equal(url.hostname, "qualificacao-ficticia.invalid", "rede externa é proibida neste teste");
    assert.equal(url.pathname, "/rest/v1/leads");
    consultas += 1;
    const projetar = (l: Linha) => Object.fromEntries(
      (url.searchParams.get("select") ?? "").split(",").map((k) => [k, l[k as keyof Linha]]),
    );
    if ((init?.method ?? "GET") === "GET") {
      const lido = structuredClone(atual);
      await antesDeLer?.();
      if (erroLeitura) return Response.json({ message: "Leitura fictícia falhou", code: erroLeitura }, { status: 500 });
      return Response.json(lido ? [projetar(lido)] : []);
    }
    assert.equal(init?.method, "PATCH");
    patches.push(JSON.parse(String(init?.body)));
    filtros.push(new URLSearchParams(url.search));
    await antesDeEscrever?.();
    if (erroEscrita) return Response.json({ message: "Escrita fictícia falhou", code: erroEscrita }, { status: 500 });
    const bate = atual && [...url.searchParams].every(([k, valor]) => {
      if (k === "select") return true;
      const salvo = atual![k as keyof Linha];
      return valor === "is.null" ? salvo === null : valor === `eq.${salvo}`;
    });
    if (!bate) return Response.json([]);
    atual = { ...atual!, ...patches.at(-1)!, updated_at: "2026-10-09T19:00:00Z" };
    escritas += 1;
    return Response.json([projetar(atual)]);
  };
  const db = createClient("https://qualificacao-ficticia.invalid", "chave-ficticia", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchFalso },
  });
  const io = {
    sessao: async () => autenticado ? { id: "admin-ficticio" } : null,
    banco: () => db,
    agendar: (tarefa: () => Promise<void>) => { tarefas.push(tarefa); },
    enviar: async (id: string) => { despachados.push(id); },
  };
  return {
    io, patches, filtros, tarefas, despachados,
    get linha() { return structuredClone(atual); }, get consultas() { return consultas; }, get escritas() { return escritas; },
    semSessao() { autenticado = false; },
    mudar(patch: Partial<Linha>) { atual = atual ? { ...atual, ...patch } : null; },
    apagar() { atual = null; },
    antesDeGravar(fn: typeof antesDeEscrever) { antesDeEscrever = fn; },
    antesDaLeitura(fn: typeof antesDeLer) { antesDeLer = fn; },
    falharLeitura(code: string) { erroLeitura = code; },
    falharEscrita(code: string) { erroEscrita = code; },
  };
}

test("qualificação exige sessão antes de acessar banco", async () => {
  const b = bancoFicticio(); b.semSessao();
  const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
  assert.equal(r.status, 401); assert.equal(b.consultas, 0); assert.equal(b.tarefas.length, 0);
});

test("UUID inválido e payload sem base ou inválido não chegam ao banco", async () => {
  for (const [id, corpo, esperado] of [
    ["id-invalido", payload(true), 404],
    [ID, { qualificado: true }, 400],
    [ID, { qualificado: "sim", base_qualificado_em: null }, 400],
    [ID, payload(true, "data-invalida"), 400],
  ] as const) {
    const b = bancoFicticio();
    const r = await tratarQualificacao(req(corpo), contexto(id), b.io);
    assert.equal(r.status, esperado); assert.equal(b.consultas, 0);
  }
});

test("qualificar só grava a marca e agenda um despacho após salvar; sem mudar respostas ou raia", async () => {
  const b = bancoFicticio();
  const antes = b.linha!;
  const r = await tratarQualificacao(req({ ...payload(true), status: "virou_cliente", respostas: {} }), contexto(), b.io);
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.ok(!Number.isNaN(Date.parse(json.qualificado_em)));
  assert.equal(json.qualificado_em, b.linha!.qualificado_em);
  assert.equal(b.linha!.status, antes.status);
  assert.deepEqual(b.linha!.respostas, antes.respostas);
  assert.deepEqual(Object.keys(b.patches[0]), ["qualificado_em"]);
  assert.equal(b.filtros[0].get("qualificado_em"), "is.null");
  assert.equal(b.tarefas.length, 1);
  assert.equal(b.despachados.length, 0);
  await b.tarefas[0](); assert.deepEqual(b.despachados, [ID]);
});

test("repetir uma marca já salva é no-op mesmo com base antiga", async () => {
  for (const [inicial, desejo] of [[INSTANTE, true], [null, false]] as const) {
    const b = bancoFicticio(linha(inicial));
    const r = await tratarQualificacao(req(payload(desejo)), contexto(), b.io);
    assert.equal(r.status, 200);
    assert.equal(b.escritas, 0); assert.equal(b.tarefas.length, 0);
    assert.equal((await r.json()).qualificado_em, inicial);
  }
});

test("desqualificar usa CAS e não envia abandono, proposta ou outro evento", async () => {
  const b = bancoFicticio(linha(INSTANTE));
  const r = await tratarQualificacao(req(payload(false, INSTANTE)), contexto(), b.io);
  assert.equal(r.status, 200); assert.equal(b.linha!.qualificado_em, null);
  assert.equal(b.filtros[0].get("qualificado_em"), `eq.${INSTANTE}`);
  assert.equal(b.filtros[0].has("whatsapp"), false, "desmarcar não depende do contato");
  assert.equal(b.linha!.status, "incompleto"); assert.equal(b.tarefas.length, 0);
});

test("mesmo instante em Z ou offset é aceito como base e usa timestamp lido no filtro", async () => {
  const b = bancoFicticio(linha(INSTANTE));
  const r = await tratarQualificacao(req(payload(false, "2026-10-09T18:00:00Z")), contexto(), b.io);
  assert.equal(r.status, 200);
  assert.equal(b.filtros[0].get("qualificado_em"), `eq.${INSTANTE}`);
});

test("base antiga não desmarca uma qualificação feita em outra tela", async () => {
  const b = bancoFicticio(linha(INSTANTE));
  const r = await tratarQualificacao(req(payload(false)), contexto(), b.io);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).qualificado_em, INSTANTE);
  assert.equal(b.escritas, 0); assert.equal(b.tarefas.length, 0);
});

test("duas qualificações concorrentes sobre null: uma escrita, um despacho e conflito com estado atual", async () => {
  const b = bancoFicticio(); const barreira = trava(); let leituras = 0;
  b.antesDaLeitura(async () => {
    if (++leituras <= 2) { if (leituras === 2) barreira.abrir(); await barreira.espera; }
  });
  const resultados = await Promise.all([
    tratarQualificacao(req(payload(true)), contexto(), b.io), tratarQualificacao(req(payload(true)), contexto(), b.io),
  ]);
  assert.deepEqual(resultados.map((r) => r.status).sort(), [200, 409]);
  assert.equal(b.escritas, 1); assert.equal(b.tarefas.length, 1);
  const conflito = resultados.find((r) => r.status === 409)!;
  assert.equal((await conflito.json()).qualificado_em, b.linha!.qualificado_em);
});

test("mudança concorrente de respostas/status/updated_at não é sobrescrita e não bloqueia a qualificação", async () => {
  const b = bancoFicticio();
  b.antesDeGravar(() => b.mudar({ status: "enviado", updated_at: "2026-10-09T18:30:00Z", respostas: { nome: "Editado na outra aba" } }));
  const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
  assert.equal(r.status, 200);
  assert.equal(b.linha!.status, "enviado"); assert.equal(b.linha!.respostas.nome, "Editado na outra aba");
  assert.equal(b.filtros[0].has("updated_at"), false); assert.equal(b.filtros[0].has("status"), false);
});

test("qualificação alterada entre leitura e UPDATE vira conflito sem desfazer marca recente", async () => {
  const b = bancoFicticio(linha(INSTANTE));
  const recente = "2026-10-09T18:20:00Z";
  b.antesDeGravar(() => b.mudar({ qualificado_em: recente }));
  const r = await tratarQualificacao(req(payload(false, INSTANTE)), contexto(), b.io);
  assert.equal(r.status, 409); assert.equal(b.linha!.qualificado_em, recente);
  assert.equal((await r.json()).qualificado_em, recente); assert.equal(b.tarefas.length, 0);
});

test("WhatsApp removido ou invalidado entre leitura e UPDATE não permite qualificação", async () => {
  for (const whatsapp of [null, "123"] as const) {
    const b = bancoFicticio();
    b.antesDeGravar(() => b.mudar({ whatsapp }));
    const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
    assert.equal(r.status, 422); assert.match((await r.json()).erro, /WhatsApp válido/);
    assert.equal(b.linha!.qualificado_em, null); assert.equal(b.linha!.whatsapp, whatsapp);
    assert.equal(b.filtros[0].get("whatsapp"), "eq.19988887777");
    assert.equal(b.escritas, 0); assert.equal(b.tarefas.length, 0);
  }
});

test("WhatsApp trocado por outro válido durante UPDATE exige conferir contato em vez de qualificar", async () => {
  const b = bancoFicticio();
  b.antesDeGravar(() => b.mudar({ whatsapp: "11999998888" }));
  const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
  assert.equal(r.status, 409);
  const json = await r.json();
  assert.match(json.erro, /WhatsApp mudou/); assert.equal(json.qualificado_em, null);
  assert.equal(b.linha!.whatsapp, "11999998888"); assert.equal(b.linha!.qualificado_em, null);
  assert.equal(b.escritas, 0); assert.equal(b.tarefas.length, 0);
});

test("telefone inválido não qualifica; desmarcar continua disponível", async () => {
  for (const telefone of [null, "123", "11818887777"] as const) {
    const b = bancoFicticio(); b.mudar({ whatsapp: telefone });
    const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
    assert.equal(r.status, 422); assert.equal(b.escritas, 0); assert.equal(b.tarefas.length, 0);
  }
  const b = bancoFicticio(linha(INSTANTE)); b.mudar({ whatsapp: null });
  assert.equal((await tratarQualificacao(req(payload(false, INSTANTE)), contexto(), b.io)).status, 200);
});

test("lead inexistente ou removido durante UPDATE responde 404 sem despacho", async () => {
  for (const durante of [false, true]) {
    const b = bancoFicticio(durante ? linha() : null);
    if (durante) b.antesDeGravar(() => b.apagar());
    const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
    assert.equal(r.status, 404); assert.equal(b.tarefas.length, 0);
  }
});

test("schema ausente na leitura ou escrita responde 503 explícito e nunca confirma marcação", async () => {
  for (const codigo of ["42703", "PGRST204", "42P01", "42883"]) {
    for (const etapa of ["leitura", "escrita"]) {
      const b = bancoFicticio();
      if (etapa === "leitura") b.falharLeitura(codigo); else b.falharEscrita(codigo);
      const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
      assert.equal(r.status, 503); assert.match((await r.json()).erro, /atualização do sistema/);
      assert.equal(b.linha!.qualificado_em, null); assert.equal(b.tarefas.length, 0);
    }
  }
});

test("erro operacional de banco responde 503 sem expor mensagem técnica", async () => {
  const b = bancoFicticio(); b.falharEscrita("XX000");
  const r = await tratarQualificacao(req(payload(true)), contexto(), b.io);
  assert.equal(r.status, 503); assert.match((await r.json()).erro, /Tente de novo/);
  assert.equal(b.linha!.qualificado_em, null); assert.equal(b.tarefas.length, 0);
});
