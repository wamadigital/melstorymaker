import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { removerPropostasDoLead } from "./arquivos-proposta";

const ID = "30000000-0000-4000-8000-000000000001";
const TOKEN = "40000000-0000-4000-8000-000000000001";
test("exclusão autorizada remove proposta manual, automática e versão não publicada do mesmo lead", async () => {
  const removidos: unknown[] = [];
  let listagens = 0;
  const db = createClient("https://storage.invalid", "service-ficticio", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      if (String(input).includes("/list/")) {
        listagens++;
        return Response.json(listagens === 1 ? [{ name: `${TOKEN}.pdf` }, { name: `${ID}.pdf` }] : []);
      }
      removidos.push(JSON.parse(String(init?.body)));
      return Response.json([{ name: "removido" }]);
    } },
  });
  await removerPropostasDoLead(db, ID);
  assert.deepEqual(removidos, [{ prefixes: [`${ID}.pdf`] },
    { prefixes: [`automaticas/${ID}/${TOKEN}.pdf`, `automaticas/${ID}/${ID}.pdf`] }]);
  assert.equal(listagens, 2);
});
test("falha ao listar versões automáticas impede concluir a exclusão do lead", async () => {
  const db = createClient("https://storage.invalid", "service-ficticio", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => String(input).includes("/list/")
      ? Response.json({ message: "indisponível" }, { status: 503 }) : Response.json([]) },
  });
  await assert.rejects(removerPropostasDoLead(db, ID), /listar_propostas_automaticas/);
});
