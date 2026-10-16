import assert from "node:assert/strict";
import { test } from "node:test";
import { arquivoProposta } from "./arquivo";

const ID = "30000000-0000-4000-8000-000000000001";
const TOKEN = "40000000-0000-4000-8000-000000000001";
test("arquivo manual continua compatível e proposta automática usa versão do mesmo lead", () => {
  assert.equal(arquivoProposta(ID), `${ID}.pdf`);
  assert.equal(arquivoProposta(ID, null), `${ID}.pdf`);
  const caminho = `automaticas/${ID}/${TOKEN}.pdf`;
  assert.equal(arquivoProposta(ID, caminho), caminho);
});
test("caminho persistido não pode apontar a outro lead, pasta ou URL", () => {
  for (const caminho of [`automaticas/${TOKEN}/${ID}.pdf`, `../${ID}.pdf`, `automaticas/${ID}/../../x.pdf`,
    `https://site.invalid/${ID}.pdf`, `automaticas/${ID}/${TOKEN}.pdf?x=1`, ""]) {
    assert.throws(() => arquivoProposta(ID, caminho));
  }
});
