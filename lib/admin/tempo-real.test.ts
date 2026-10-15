import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { EVENTO_QUADRO, TOPICO_QUADRO } from "./tempo-real";

const ler = (arquivo: string) => fs.readFileSync(path.join(process.cwd(), arquivo), "utf8");
const bloco = ler("supabase/quadro-tempo-real.sql");

test("o trigger publica no topico e no evento que o quadro escuta", () => {
  assert.match(bloco, new RegExp(`realtime\\.send\\('\\{\\}'::jsonb, '${EVENTO_QUADRO}', '${TOPICO_QUADRO}', true\\)`));
  assert.match(bloco, new RegExp(`realtime\\.topic\\(\\) = '${TOPICO_QUADRO}'`));
});

test("o aviso sai vazio: nenhuma coluna do lead vai para o canal", () => {
  // `new.` ou `old.` no bloco seria dado do lead entrando no payload, e o
  // realtime.messages guarda o payload por 3 dias.
  assert.doesNotMatch(bloco, /\b(new|old)\./i);
  assert.doesNotMatch(bloco, /broadcast_changes/);
});

test("a unica policy e de leitura em realtime.messages; leads continua sem nenhuma", () => {
  const policies = [...bloco.matchAll(/create policy[\s\S]*?;/gi)].map((m) => m[0]);
  assert.equal(policies.length, 1);
  assert.match(policies[0], /on realtime\.messages\s+for select\s+to authenticated/);
  assert.doesNotMatch(ler("supabase/schema.sql"), /create policy[^;]*\bon (public\.)?leads\b/i);
});

test("schema.sql traz o mesmo bloco, byte a byte", () => {
  assert.ok(ler("supabase/schema.sql").includes(bloco.trim()));
});

test("schema.sql traz o incremento de atualizacao WhatsApp, byte a byte", () => {
  assert.ok(ler("supabase/schema.sql").includes(ler("supabase/quadro-whatsapp.sql").trim()));
});
