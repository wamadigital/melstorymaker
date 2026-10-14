import assert from "node:assert/strict";
import { test } from "node:test";
import { ehAdmin, lerListaAdmins } from "./acesso";

test("sem a variavel, ou so com lixo, ninguem entra (falha fechada)", () => {
  for (const bruto of [undefined, "", "  ", ",", " , ,", "mel", "@", "@wama", "a@b@wama.digital"]) {
    const lista = lerListaAdmins(bruto);
    assert.equal(lista, null, `"${bruto}" deveria fechar o painel`);
    assert.equal(ehAdmin("mel@wama.digital", lista), false);
  }
});

test("e-mail exato, sem caixa e sem espaco em volta", () => {
  const lista = lerListaAdmins(" Mel@Wama.Digital , henrique@wama.digital ");
  assert.ok(lista);
  assert.equal(ehAdmin("mel@wama.digital", lista), true);
  assert.equal(ehAdmin("MEL@WAMA.DIGITAL", lista), true);
  assert.equal(ehAdmin(" henrique@wama.digital ", lista), true);
});

test("e-mail fora da lista nao entra, nem parecido", () => {
  const lista = lerListaAdmins("mel@wama.digital");
  for (const email of [
    "intruso@gmail.com",
    "mel@wama.digital.evil.com",
    "mel@wama.digitall",
    "xmel@wama.digital",
    "mel+painel@wama.digital",
    "outra@wama.digital",
  ]) {
    assert.equal(ehAdmin(email, lista), false, email);
  }
});

test("conta sem e-mail (telefone, anonima) nunca entra", () => {
  const lista = lerListaAdmins("mel@wama.digital,@wama.digital");
  for (const email of [undefined, null, "", "   "]) assert.equal(ehAdmin(email, lista), false);
});

test("@dominio libera o dominio exato, e so ele", () => {
  const lista = lerListaAdmins("@wama.digital");
  assert.ok(lista);
  assert.equal(ehAdmin("e2e-1760000000000@wama.digital", lista), true);
  assert.equal(ehAdmin("Quadro-1@WAMA.digital", lista), true);
  assert.equal(ehAdmin("x@sub.wama.digital", lista), false);
  assert.equal(ehAdmin("x@wama.digital.evil.com", lista), false);
  assert.equal(ehAdmin("x@evilwama.digital", lista), false);
  // O dominio sozinho nao e um e-mail.
  assert.equal(ehAdmin("wama.digital", lista), false);
  assert.equal(ehAdmin("@wama.digital", lista), false);
});

test("item torto e ignorado sem derrubar os validos", () => {
  const lista = lerListaAdmins("mel, @, mel@wama.digital, @semponto, a@b@c.com");
  assert.ok(lista);
  assert.deepEqual([...lista.emails], ["mel@wama.digital"]);
  assert.deepEqual([...lista.dominios], []);
  assert.equal(ehAdmin("mel@wama.digital", lista), true);
});
