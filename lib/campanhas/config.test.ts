import assert from "node:assert/strict";
import { test } from "node:test";
import { configuracaoCampanhas } from "./config";
import { consultaPublicoSchema, iniciarCampanhaSchema } from "./contrato";

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

test("iniciar exige confirmação e aceita somente envio real", () => {
  const campanha = {
    id: "10000000-0000-4000-8000-000000000001", nome: "Campanha", modo: "real",
    filtros: { inicio: null, fim: null, categoria: null, status: null, qualificado: null, excluirStatus: [] },
    mensagens: ["Versão A"], intervalo: 2, revisao: "a".repeat(32),
  };
  assert.equal(iniciarCampanhaSchema.safeParse(campanha).success, false);
  assert.equal(iniciarCampanhaSchema.safeParse({ ...campanha, autorizacaoConfirmada: false }).success, false);
  assert.ok(iniciarCampanhaSchema.safeParse({ ...campanha, autorizacaoConfirmada: true }).success);
  assert.equal(iniciarCampanhaSchema.safeParse({ ...campanha, autorizacaoConfirmada: true, modo: "simulacao" }).success, false);
});
