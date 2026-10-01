import assert from "node:assert/strict";
import { test } from "node:test";
import { repassarQuery } from "./url";

test("sem query e sem fixos, devolve o destino puro", () => {
  assert.equal(repassarQuery("/formulario", ""), "/formulario");
  assert.equal(repassarQuery("/formulario", {}), "/formulario");
});

test("repassa fbclid e utm do searchParams da página, inclusive valores repetidos", () => {
  const url = repassarQuery("/formulario", { fbclid: "IwAR1", utm_source: "instagram", tag: ["a", "b"], vazio: undefined });
  assert.equal(url, "/formulario?fbclid=IwAR1&utm_source=instagram&tag=a&tag=b");
});

test("aceita a string de location.search", () => {
  assert.equal(repassarQuery("/formulario", "?fbclid=IwAR2&utm_medium=paid"), "/formulario?fbclid=IwAR2&utm_medium=paid");
});

test("os fixos ganham do que vier na query com o mesmo nome", () => {
  const url = repassarQuery("/formulario", "?evento=debutante&fbclid=X", { evento: "casamento", cta: "hero" });
  const params = new URLSearchParams(url.split("?")[1]);
  assert.deepEqual(params.getAll("evento"), ["casamento"]);
  assert.equal(params.get("cta"), "hero");
  assert.equal(params.get("fbclid"), "X");
});
