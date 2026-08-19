import assert from "node:assert/strict";
import { test } from "node:test";
import { gerarSlug, RE_SLUG, TAMANHO_SLUG } from "./slug";

test("o slug tem o tamanho combinado e casa com o guarda da rota", () => {
  for (let i = 0; i < 200; i++) {
    const s = gerarSlug();
    assert.equal(s.length, TAMANHO_SLUG);
    assert.match(s, RE_SLUG);
  }
});

test("não sorteia caractere ambíguo: o link é ditado no telefone", () => {
  const proibidos = /[0oO1lI5S]/;
  for (let i = 0; i < 500; i++) {
    assert.doesNotMatch(gerarSlug(), proibidos, "sorteou caractere confundível");
  }
});

test("o guarda recusa o que não é slug", () => {
  for (const ruim of ["", "abc", "abcde", "AB12", "ab-c", "a3f9.pdf", "0000", "../x"]) {
    assert.doesNotMatch(ruim, RE_SLUG, `deveria recusar "${ruim}"`);
  }
});

test("sorteia de verdade: 200 slugs não colapsam num punhado", () => {
  const vistos = new Set(Array.from({ length: 200 }, () => gerarSlug()));
  // Com 810 mil combinações, 200 sorteios quase nunca repetem; abaixo de 190
  // distintos o gerador está viciado.
  assert.ok(vistos.size > 190, `só ${vistos.size} distintos em 200`);
});
