import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarCondicao, type CondicaoEscrita } from "./contratos";

// Sem banco: o query builder do PostgREST e trocado por um que so anota os
// filtros. O que se prova aqui e que cada condicao de `salvarRegistro` vira
// filtro do UPDATE -- uma condicao esquecida vira escrita sem guard, e o 409
// que a rota promete nunca acontece.

type Filtro = [metodo: "in" | "is" | "eq", coluna: string, valor: unknown];

class Anotador {
  readonly filtros: Filtro[] = [];
  in(coluna: string, valores: readonly string[]): this {
    this.filtros.push(["in", coluna, [...valores]]);
    return this;
  }
  is(coluna: string, valor: null): this {
    this.filtros.push(["is", coluna, valor]);
    return this;
  }
  eq(coluna: string, valor: string): this {
    this.filtros.push(["eq", coluna, valor]);
    return this;
  }
}

const filtrosDe = (c: CondicaoEscrita) => aplicarCondicao(new Anotador(), c).filtros;

test("a escrita guardada pelo estado lido filtra pelo updated_at lido", () => {
  const lido = "2026-09-30T15:04:05.123456+00:00";
  assert.deepEqual(filtrosDe({ atualizadoEm: lido }), [["eq", "updated_at", lido]]);
  assert.deepEqual(filtrosDe({ status: ["redigido", "pdf_gerado"], atualizadoEm: lido }), [
    ["in", "status", ["redigido", "pdf_gerado"]],
    ["eq", "updated_at", lido],
  ]);
});

test("as condições de antes continuam virando filtro", () => {
  assert.deepEqual(filtrosDe({ status: ["enviado"], token: null }), [
    ["in", "status", ["enviado"]],
    ["is", "assinatura_token", null],
  ]);
  assert.deepEqual(filtrosDe({ status: ["enviado"], token: "dry-1" }), [
    ["in", "status", ["enviado"]],
    ["eq", "assinatura_token", "dry-1"],
  ]);
  assert.deepEqual(filtrosDe({ status: ["pdf_gerado"], pdfSha256: "ab12", atualizadoEm: "t1" }), [
    ["in", "status", ["pdf_gerado"]],
    ["eq", "pdf_sha256", "ab12"],
    ["eq", "updated_at", "t1"],
  ]);
});

test("condição vazia não filtra nada além do lead", () => {
  assert.deepEqual(filtrosDe({}), []);
});
