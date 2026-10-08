import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CHAVE_LEAD, caminhoContinuar } from "./retomada";
import { guardarLead, lerLeadSalvo } from "./persistencia";
import { GET } from "@/app/continuar/[id]/route";

test("o link do lembrete grava a chave que a persistencia do formulario lê", async () => {
  const id = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
  const valores = new Map<string, string>();
  const armazenamento = {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => { valores.set(chave, valor); },
    removeItem: (chave: string) => { valores.delete(chave); },
  };
  const resposta = await GET(new Request(`https://mel.invalid/continuar/${id}`), { params: Promise.resolve({ id }) });
  const html = await resposta.text();
  // Executa somente a gravação de retomada extraída da resposta real, sem navegação.
  const gravacao = html.match(/<script>(try\{localStorage\.setItem.*?catch\(e\)\{\})/)?.[1];
  assert.ok(gravacao);
  new Function("localStorage", gravacao)(armazenamento);
  assert.equal(lerLeadSalvo(armazenamento), id);
  assert.equal(valores.get(CHAVE_LEAD), id);
  guardarLead("novo-lead", armazenamento);
  assert.equal(lerLeadSalvo(armazenamento), "novo-lead");
  assert.equal(resposta.headers.get("Referrer-Policy"), "no-referrer");
  assert.ok(!html.includes("fbq"), "o UUID não entra em uma página com Pixel");
});

test("o caminho do link é o da página de passagem", () => {
  const id = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
  assert.equal(caminhoContinuar(id), `/continuar/${id}`);
  assert.ok(fs.existsSync(path.join(process.cwd(), "app/continuar/[id]/route.ts")));
});
