import assert from "node:assert/strict";
import { test } from "node:test";
import { configuracaoCampanhas } from "./config";
import { consultaPublicoSchema, testeCampanhaSchema } from "./contrato";

test("a fila depende do worker e mantém a cadência do disparador", () => {
  const ambiente = { WHATSAPP_CAMPANHAS_WORKER_ATIVO: "true", WHATSAPP_WORKER_TOKEN: "x".repeat(32) };
  assert.deepEqual(configuracaoCampanhas(ambiente), { workerAtivo: true, enviosAtivos: true, cadencia: 60 });
  assert.equal(configuracaoCampanhas({ ...ambiente, WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS: "90" }).cadencia, 90);
  assert.equal(configuracaoCampanhas({ ...ambiente, WHATSAPP_WORKER_TOKEN: "" }).enviosAtivos, false);
});

test("a prévia aceita vários status de exclusão e rejeita valores fora do Kanban", () => {
  const consulta = {
    filtros: { inicio: null, fim: null, categoria: null, status: null, qualificado: null, excluirStatus: ["perdido", "esfriou"] },
    modo: "real", pagina: 0,
  };
  assert.ok(consultaPublicoSchema.safeParse(consulta).success);
  assert.equal(consultaPublicoSchema.safeParse({
    ...consulta, filtros: { ...consulta.filtros, excluirStatus: ["perdido", "externo"] },
  }).success, false);
});

test("o teste usa um conteúdo e preserva o número da variação escolhida", () => {
  const teste = testeCampanhaSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    nome: " Campanha ", telefone: "5519988763916", mensagem: " B ", numero: 2,
  });
  assert.equal(teste.mensagem, "B");
  assert.equal(teste.numero, 2);
});
