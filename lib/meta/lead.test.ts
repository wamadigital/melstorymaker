import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEventoDeStatus, type LinhaLead } from "./lead";

const base: LinhaLead = {
  categoria: "casamento",
  email: "ana@exemplo.com",
  whatsapp: "19988887777",
  respostas: { nome: "Ana Souza" },
};

test("evento do quadro sai como SITE quando o navegador do lead foi guardado", () => {
  const evento = montarEventoDeStatus(
    "abc",
    {
      ...base,
      rastreio: { fbc: "fb.1.1700000000000.xyz", ua: "Mozilla/5.0 (iPhone)", ip: "200.1.2.3" },
    },
    "virou_cliente",
  );

  assert.ok(evento);
  assert.equal(evento.nome, "VirouCliente");
  assert.equal(evento.id, "virou_cliente_abc");
  // So a fonte "Site" vira conversao personalizada no Gerenciador de Eventos.
  assert.equal(evento.origem, "website");
  // Navegador e ip sao os DO LEAD, guardados na criacao -- nunca os da Mel.
  assert.equal(evento.pessoa.userAgent, "Mozilla/5.0 (iPhone)");
  assert.equal(evento.pessoa.ip, "200.1.2.3");
  assert.equal(evento.pessoa.fbc, "fb.1.1700000000000.xyz");
  assert.equal(evento.pessoa.nome, "Ana Souza");
});

test("lead antigo, sem navegador guardado, cai em system_generated", () => {
  // A Meta recusa evento de site sem navegador.
  const soCookies = montarEventoDeStatus("abc", { ...base, rastreio: { fbc: "fb.1.1700000000000.xyz" } }, "enviado");
  assert.equal(soCookies?.origem, "system_generated");
  assert.equal(soCookies?.pessoa.userAgent, undefined);

  const semNada = montarEventoDeStatus("abc", { ...base, rastreio: null }, "perdido");
  assert.equal(semNada?.origem, "system_generated");
  assert.equal(semNada?.nome, "LeadPerdido");
});

test("status sem evento de quadro não monta nada", () => {
  assert.equal(montarEventoDeStatus("abc", base, "aguardando_revisao"), null);
  assert.equal(montarEventoDeStatus("abc", base, "incompleto"), null);
});
