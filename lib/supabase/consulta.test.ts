import assert from "node:assert/strict";
import { test } from "node:test";
import { lerComRetentativa } from "./consulta";

const JWT_FUTURO = { message: "JWT issued at future" };

test("falha transitória numa tentativa não derruba a leitura", async () => {
  let chamadas = 0;
  const r = await lerComRetentativa<{ id: string }[]>(
    "coluna enviado",
    async () => {
      chamadas++;
      // Foi exatamente assim que apareceu: a 1a falha, a seguinte passa.
      return chamadas === 1
        ? { data: null, error: JWT_FUTURO, count: null }
        : { data: [{ id: "abc" }], error: null, count: 1 };
    },
    { esperaMs: 1 },
  );

  assert.equal(chamadas, 2, "deveria ter repetido uma vez");
  assert.equal(r.error, null);
  assert.deepEqual(r.data, [{ id: "abc" }]);
  assert.equal(r.count, 1);
});

test("erro que persiste ainda é devolvido, depois de esgotar as tentativas", async () => {
  let chamadas = 0;
  const r = await lerComRetentativa(
    "coluna enviado",
    async () => {
      chamadas++;
      return { data: null, error: { message: "column x does not exist", code: "42703" } };
    },
    { esperaMs: 1 },
  );

  assert.equal(chamadas, 3, "não pode desistir na primeira nem repetir para sempre");
  assert.equal(r.error?.code, "42703");
});

test("leitura que dá certo de primeira não repete nada", async () => {
  let chamadas = 0;
  await lerComRetentativa("coluna novo", async () => {
    chamadas++;
    return { data: [], error: null, count: 0 };
  });
  assert.equal(chamadas, 1);
});
