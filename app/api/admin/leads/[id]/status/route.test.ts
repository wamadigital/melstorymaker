import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { STATUS, type Status } from "@/lib/form/types";
import { MENSAGEM_RECUSA, recusarMovimento } from "@/lib/admin/status";
import { eventoPassado } from "@/lib/admin/evento-passado";

// Executa a rota real com dependências fechadas na VM: nenhuma sessão, banco,
// variável de ambiente, tarefa Next ou chamada Meta de produção é acessada.
const ID = "10000000-0000-4000-8000-000000000001";
const AGORA = Date.parse("2026-10-23T18:00:00Z");
const fonte = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Contrato = { status: string; assinatura_status: string | null; assinado_em: string | null };
type Linha = {
  id: string; status: Status; nome_display: string; pdf_url: string | null;
  enviado_em: string | null; data_evento: string | null; contratos: Contrato | Contrato[] | null;
};
const linha = (patch: Partial<Linha> = {}): Linha => ({
  id: ID, status: "perdido", nome_display: "Fixture", pdf_url: "https://mel.example.invalid/p/a3f9",
  enviado_em: "2026-10-01T18:00:00Z", data_evento: "2026-10-23", contratos: [], ...patch,
});
const contrato = (patch: Partial<Contrato> = {}): Contrato => ({
  status: "pdf_gerado", assinatura_status: null, assinado_em: null, ...patch,
});

function montar({ lead = linha(), agora = AGORA, sessao = true, salvo, erroEscrita = false }: {
  lead?: Linha | null; agora?: number; sessao?: boolean;
  salvo?: Pick<Linha, "status" | "enviado_em"> | null; erroEscrita?: boolean;
} = {}) {
  const consultas: { operacao: "ler" | "gravar"; colunas: string; filtros: [string, unknown][]; patch?: Record<string, unknown> }[] = [];
  const tarefas: (() => Promise<void>)[] = [];
  const eventos: [string, Status][] = [];
  const mod: { exports: { PATCH?: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> } } = { exports: {} };
  class Relogio extends Date {
    constructor(valor?: string | number) { super(valor ?? agora); }
    static now() { return agora; }
  }
  runInNewContext(fonte, {
    exports: mod.exports, Date: Relogio, console: { log() {}, error() {} },
    require(nome: string) {
      if (nome === "next/server") return {
        NextResponse: { json: (corpo: unknown, init?: ResponseInit) => Response.json(corpo, init) },
        after: (tarefa: () => Promise<void>) => { tarefas.push(tarefa); },
      };
      if (nome === "zod") return { z };
      if (nome === "@/lib/form/types") return { STATUS };
      if (nome === "@/lib/admin/status") return { MENSAGEM_RECUSA, recusarMovimento };
      if (nome === "@/lib/admin/evento-passado") return { eventoPassado };
      if (nome === "@/lib/supabase/server") return { getSessaoAdmin: async () => sessao ? { id: "admin-ficticio" } : null };
      if (nome === "@/lib/meta/lead") return { enviarEventoDeStatus: async (id: string, status: Status) => { eventos.push([id, status]); } };
      if (nome === "@/lib/supabase/admin") return { supabaseAdmin: () => ({ from(tabela: string) {
        assert.equal(tabela, "leads");
        const consulta: (typeof consultas)[number] = { operacao: "ler", colunas: "", filtros: [] };
        const construtor = {
          select(colunas: string) { consulta.colunas = colunas; return construtor; },
          update(patch: Record<string, unknown>) { consulta.operacao = "gravar"; consulta.patch = patch; return construtor; },
          eq(campo: string, valor: unknown) { consulta.filtros.push([campo, valor]); return construtor; },
          async maybeSingle() {
            consultas.push(consulta);
            if (consulta.operacao === "ler") return { data: lead, error: null };
            if (erroEscrita) return { data: null, error: { message: "Falha fictícia" } };
            const destino = consulta.patch!.status as Status;
            return { data: salvo === undefined ? { status: destino, enviado_em: lead?.enviado_em ?? null } : salvo, error: null };
          },
        };
        return construtor;
      } }) };
      throw new Error(`Importação inesperada no teste: ${nome}`);
    },
  });
  return {
    consultas, tarefas, eventos,
    patch: (corpo: unknown = { status: "aguardando_revisao", de: "perdido" }, id = ID) => mod.exports.PATCH!(
      new Request(`https://mel.example.invalid/api/admin/leads/${id}/status`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
      }), { params: Promise.resolve({ id }) },
    ),
  };
}

test("status exige autenticação, UUID e payload válidos antes de acessar o banco", async () => {
  const semSessao = montar({ sessao: false });
  assert.equal((await semSessao.patch()).status, 401);
  assert.equal(semSessao.consultas.length, 0);
  for (const [id, corpo, esperado] of [
    ["id-invalido", { status: "enviado" }, 404],
    [ID, { status: "fora-do-funil" }, 400],
    [ID, { status: "enviado", de: "fora-do-funil" }, 400],
  ] as const) {
    const tela = montar();
    assert.equal((await tela.patch(corpo, id)).status, esperado);
    assert.equal(tela.consultas.length, 0);
    assert.equal(tela.tarefas.length, 0);
  }
});

test("evento de ontem não reativa nas raias ativas e não agenda evento Site", async () => {
  for (const destino of ["aguardando_revisao", "enviado", "esfriou"] as const) {
    const tela = montar({ lead: linha({ data_evento: "2026-10-22", contratos: [contrato()] }) });
    const r = await tela.patch({ status: destino, de: "perdido" });
    assert.equal(r.status, 422);
    assert.match((await r.json()).erro, /data deste evento já passou/);
    assert.equal(tela.consultas.length, 1);
    assert.match(tela.consultas[0].colunas, /data_evento/);
    assert.match(tela.consultas[0].colunas, /contratos\(status, assinatura_status, assinado_em\)/);
    assert.equal(tela.tarefas.length, 0);
    assert.deepEqual(tela.eventos, []);
  }
});

test("o evento permanece ativo hoje e só expira na meia-noite de São Paulo", async () => {
  for (const [instante, esperado] of [
    ["2026-10-24T02:59:59.999Z", 200],
    ["2026-10-24T03:00:00.000Z", 422],
  ] as const) {
    const tela = montar({ agora: Date.parse(instante) });
    assert.equal((await tela.patch()).status, esperado);
    assert.equal(tela.consultas.filter(c => c.operacao === "gravar").length, esperado === 200 ? 1 : 0);
    assert.equal(tela.tarefas.length, esperado === 200 ? 1 : 0);
  }
});

test("data ausente ou inválida não é classificada como evento passado", async () => {
  for (const data_evento of [null, "", "2026-02-30", "data-indefinida"]) {
    const tela = montar({ lead: linha({ data_evento }) });
    assert.equal((await tela.patch()).status, 200);
  }
});

test("contrato assinado, assinatura concluída ou data de assinatura preservam a reativação", async () => {
  for (const protegido of [
    contrato({ status: "assinado" }),
    contrato({ assinatura_status: "concluido" }),
    contrato({ assinado_em: "2026-10-20T18:00:00Z" }),
  ]) {
    for (const contratos of [protegido, [contrato(), protegido]]) {
      const tela = montar({ lead: linha({ data_evento: "2026-10-22", contratos }) });
      const r = await tela.patch({ status: "enviado", de: "perdido" });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).status, "enviado");
      assert.equal(tela.consultas.filter(c => c.operacao === "gravar").length, 1);
    }
  }
});

test("contrato apenas enviado, cancelado ou ausente não libera evento passado", async () => {
  for (const contratos of [null, [], [contrato({ status: "enviado", assinatura_status: "enviado" })], [contrato({ assinatura_status: "cancelado" })]]) {
    const tela = montar({ lead: linha({ data_evento: "2026-10-22", contratos }) });
    assert.equal((await tela.patch()).status, 422);
    assert.equal(tela.consultas.length, 1);
    assert.equal(tela.tarefas.length, 0);
  }
});

test("evento passado ainda permite registrar fechamento como cliente sem proposta", async () => {
  const tela = montar({ lead: linha({ data_evento: "2026-10-22", pdf_url: null }) });
  const r = await tela.patch({ status: "virou_cliente", de: "perdido" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "virou_cliente");
  assert.equal(tela.tarefas.length, 1);
  await tela.tarefas[0]();
  assert.deepEqual(tela.eventos, [[ID, "virou_cliente"]]);
});

test("encerrar evento passado como perdido continua permitido e idempotente", async () => {
  const tela = montar({ lead: linha({ status: "enviado", data_evento: "2026-10-22" }) });
  assert.equal((await tela.patch({ status: "perdido", de: "enviado" })).status, 200);
  assert.equal(tela.tarefas.length, 1);
  const jaPerdido = montar({ lead: linha({ data_evento: "2026-10-22" }) });
  assert.equal((await jaPerdido.patch({ status: "perdido", de: "enviado" })).status, 200);
  assert.equal(jaPerdido.consultas.length, 1);
  assert.equal(jaPerdido.tarefas.length, 0);
});

test("estado da tela divergente e CAS perdido retornam 409 sem despacho", async () => {
  const defasado = montar({ lead: linha({ status: "esfriou" }) });
  assert.equal((await defasado.patch()).status, 409);
  assert.equal(defasado.consultas.length, 1);
  assert.equal(defasado.tarefas.length, 0);
  const corrida = montar({ salvo: null });
  assert.equal((await corrida.patch()).status, 409);
  const escrita = corrida.consultas.find(c => c.operacao === "gravar")!;
  assert.deepEqual(escrita.filtros, [["id", ID], ["status", "perdido"]]);
  assert.equal(corrida.tarefas.length, 0);
});

test("trigger que devolve perdido ao virar o dia não confirma Enviado nem gera evento Site", async () => {
  const tela = montar({ salvo: { status: "perdido", enviado_em: "2026-10-01T18:00:00Z" } });
  const r = await tela.patch({ status: "enviado", de: "perdido" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).status, "perdido");
  assert.equal(tela.consultas.filter(c => c.operacao === "gravar").length, 1);
  assert.equal(tela.tarefas.length, 0);
  assert.deepEqual(tela.eventos, []);
});

test("lead ausente e falha de escrita não confirmam movimento nem agendam evento", async () => {
  const ausente = montar({ lead: null });
  assert.equal((await ausente.patch()).status, 404);
  assert.equal(ausente.consultas.length, 1);
  const falha = montar({ erroEscrita: true });
  assert.equal((await falha.patch()).status, 500);
  assert.equal(falha.tarefas.length, 0);
});

test("escrita válida agenda o evento somente depois de persistir o estado solicitado", async () => {
  const tela = montar({ lead: linha({ enviado_em: null }) });
  const r = await tela.patch({ status: "enviado", de: "perdido" });
  assert.equal(r.status, 200);
  const escrita = tela.consultas.find(c => c.operacao === "gravar")!;
  assert.equal(escrita.patch!.status, "enviado");
  assert.equal(escrita.patch!.enviado_em, "2026-10-23T18:00:00.000Z");
  assert.deepEqual(tela.eventos, []);
  assert.equal(tela.tarefas.length, 1);
  await tela.tarefas[0]();
  assert.deepEqual(tela.eventos, [[ID, "enviado"]]);
});
