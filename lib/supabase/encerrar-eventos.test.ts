import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { encerrarEventosPassados } from "./encerrar-eventos";

const id = "10000000-0000-4000-8000-000000000001";
const criarBanco = (fetch: typeof globalThis.fetch) => createClient("https://qa.invalid", "service-ficticia", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
});

test("RPC usa POST sem parâmetros de data, com timeout de 5s e retorna somente ids confirmados", async (t) => {
  const chamadas: { url: string; metodo: string | undefined; corpo: unknown }[] = [];
  const timeoutReal = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    assert.equal(ms, 5_000);
    return timeoutReal(ms);
  });
  const db = criarBanco(async (input, init) => {
    chamadas.push({ url: String(input), metodo: init?.method, corpo: init?.body });
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json([{ id }, { id }]);
  });
  assert.deepEqual(await encerrarEventosPassados(db), { ids: [id], erro: null });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://qa.invalid/rest/v1/rpc/encerrar_eventos_passados");
  assert.equal(chamadas[0].metodo, "POST");
  assert.equal(chamadas[0].corpo, "{}");
});

test("resultado vazio confirma execução idempotente, sem inventar ids", async () => {
  let primeira = true;
  const db = criarBanco(async () => {
    const rows = primeira ? [{ id }] : [];
    primeira = false;
    return Response.json(rows);
  });
  assert.deepEqual(await encerrarEventosPassados(db), { ids: [id], erro: null });
  assert.deepEqual(await encerrarEventosPassados(db), { ids: [], erro: null });
});

test("erro HTTP ou de rede não repete escrita nem expõe conteúdo do banco", async () => {
  for (const rede of [false, true]) {
    let chamadas = 0;
    const db = criarBanco(async () => {
      chamadas++;
      if (rede) throw new Error("nome privado email@privado.invalid token-secreto");
      return Response.json({ message: "nome privado email@privado.invalid token-secreto", code: "PGRST000" }, { status: 503 });
    });
    const resultado = await encerrarEventosPassados(db);
    assert.deepEqual(resultado.ids, []);
    assert.ok(resultado.erro);
    assert.doesNotMatch(resultado.erro, /privado|secreto|PGRST/);
    assert.equal(chamadas, 1);
  }
});

test("retorno inesperado ou UUID inválido não se apresenta como sucesso", async () => {
  for (const retorno of [null, {}, [{ id: "não-é-uuid" }], [{ id: 1 }], [{ outro: id }]]) {
    const resultado = await encerrarEventosPassados(criarBanco(async () => Response.json(retorno)));
    assert.deepEqual(resultado.ids, []);
    assert.ok(resultado.erro);
  }
});

test("requisição abortada é falha segura, sem retentativa", async () => {
  let chamadas = 0;
  const db = criarBanco(async () => {
    chamadas++;
    throw new DOMException("abortado", "AbortError");
  });
  assert.ok((await encerrarEventosPassados(db)).erro);
  assert.equal(chamadas, 1);
});
