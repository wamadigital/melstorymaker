import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CHAVE_LEAD, caminhoContinuar } from "./retomada";

test("o link do lembrete grava a mesma chave que o formulário lê", () => {
  // Divergir aqui nao quebra nada visivel: o link do e-mail so passa a abrir o
  // formulario do zero, e o lead perde as respostas que ja tinha dado. O
  // formulario pode importar a constante ou declarar a propria -- o que nao
  // pode e usar outra.
  const fonte = fs.readFileSync(
    path.join(process.cwd(), "app/formulario/FormularioClient.tsx"),
    "utf8",
  );
  const importa = /from "@\/lib\/form\/retomada"/.test(fonte);
  const propria = /const CHAVE_LEAD = "([^"]+)"/.exec(fonte)?.[1];
  assert.ok(
    importa || propria === CHAVE_LEAD,
    `FormularioClient usa "${propria}", e /continuar grava "${CHAVE_LEAD}"`,
  );
  assert.ok(/localStorage\.(get|set)Item\(CHAVE_LEAD/.test(fonte), "o formulário lê pela constante");
});

test("o caminho do link é o da página de passagem", () => {
  const id = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
  assert.equal(caminhoContinuar(id), `/continuar/${id}`);
  assert.ok(fs.existsSync(path.join(process.cwd(), "app/continuar/[id]/route.ts")));
});
