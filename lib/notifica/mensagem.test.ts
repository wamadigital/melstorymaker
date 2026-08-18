import assert from "node:assert/strict";
import { test } from "node:test";
import { mensagemNovoLead } from "./mensagem";

const ADMIN = "https://melstorymaker.com.br/admin";

test("casamento: sujeito, rótulo do arvore.json e data DD/MM/AAAA", () => {
  const m = mensagemNovoLead(
    "casamento",
    { nome: "Lúcia", noivos: "Ana & João", data: "2027-02-21", contato_email: "x@y.com" },
    ADMIN,
  );
  assert.ok(m.includes("Ana & João — Casamento, 21/02/2027"));
  assert.ok(m.includes("Preenchido por Lúcia"));
  assert.ok(m.endsWith(ADMIN));
});

test("quem preencheu é o sujeito: sem linha duplicada", () => {
  const m = mensagemNovoLead("corporativo", { nome: "Acme", empresa: "Acme", data: "2026-05-20" }, ADMIN);
  assert.ok(!m.includes("Preenchido por"));
});

test("dados do lead que NÃO podem atravessar o gateway ficam de fora", () => {
  const m = mensagemNovoLead(
    "casamento",
    {
      nome: "Lúcia", noivos: "Ana & João", data: "2027-02-21",
      contato_email: "lead@exemplo.com", contato_whatsapp: "(19) 99999-8888",
    },
    ADMIN,
  );
  assert.ok(!m.includes("lead@exemplo.com"));
  assert.ok(!m.includes("99999"));
});
