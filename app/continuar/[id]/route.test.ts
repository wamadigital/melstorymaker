import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route";
import { CHAVE_LEAD } from "@/lib/form/retomada";

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";

const abrir = (id: string) =>
  GET(new Request(`https://melstorymaker.com.br/continuar/${encodeURIComponent(id)}`), {
    params: Promise.resolve({ id }),
  });

test("grava o lead no navegador e segue para o formulário", async () => {
  const r = await abrir(ID);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /^text\/html/);
  const html = await r.text();
  assert.ok(html.includes(`localStorage.setItem(${JSON.stringify(CHAVE_LEAD)},${JSON.stringify(ID)})`));
  assert.ok(html.includes(`location.replace("/formulario")`));
});

test("o id do lead não vaza para a Meta pelo referrer, nem fica em cache", async () => {
  // O /formulario tem Pixel, e o Pixel manda o referrer em todo evento. Com o
  // `no-referrer` desta pagina, o formulario abre com document.referrer vazio.
  const r = await abrir(ID);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.ok((await r.text()).includes(`<meta name="referrer" content="no-referrer">`));
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-robots-tag"), "noindex");
});

test("id que não é uuid vai para o formulário do zero, sem ecoar nada", async () => {
  const r = await abrir(`"</script><script>alert(1)//`);
  assert.equal(r.status, 307);
  assert.equal(r.headers.get("location"), "https://melstorymaker.com.br/formulario");
  assert.equal(await r.text(), "");
});
