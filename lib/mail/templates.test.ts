import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEmail } from "./templates";

const base = {
  // Quem preencheu (recebe o e-mail) e o casal sao pessoas diferentes.
  nomeContato: "Lúcia",
  nomeDisplay: "Ana & João",
  pdfUrl: "https://x.test/propostas/abc.pdf",
  linkWhatsAppMel: "https://wa.me/5519999998888",
  comAnexo: true,
};

test("assunto pessoal traz o nome, conforme a copy do PRD", () => {
  const email = montarEmail("casamento", base);
  assert.equal(email.subject, "Sua proposta chegou, Lúcia ✨ | Mel Simão Storymaker");
});

test("corporativo usa a copy propria, sem nome no assunto", () => {
  const email = montarEmail("corporativo", { ...base, nomeDisplay: "Acme Ltda" });
  assert.equal(email.subject, "Proposta de cobertura ✨ | Mel Simão Storymaker");
  assert.ok(email.text.includes("Obrigada pelo interesse da Acme Ltda"));
  assert.ok(!email.text.includes("Que alegria"));
});

test("as tres categorias pessoais compartilham a mesma copy", () => {
  const a = montarEmail("debutante", base).text;
  const b = montarEmail("aniversario", base).text;
  const c = montarEmail("casamento", base).text;
  assert.equal(a, b);
  assert.equal(b, c);
  assert.ok(a.includes("Mal posso esperar pra contar essa história com você!"));
});

test("o link do PDF e o do WhatsApp aparecem nas duas versoes", () => {
  for (const cat of ["casamento", "corporativo"] as const) {
    const email = montarEmail(cat, base);
    assert.ok(email.text.includes(base.pdfUrl), `${cat}: link do PDF faltando no texto`);
    assert.ok(email.html.includes(base.pdfUrl), `${cat}: link do PDF faltando no HTML`);
    assert.ok(email.text.includes(base.linkWhatsAppMel), `${cat}: WhatsApp faltando no texto`);
  }
});

test("sem anexo, o e-mail nao promete um anexo que nao existe", () => {
  const email = montarEmail("casamento", { ...base, comAnexo: false });
  assert.ok(!email.text.includes("em anexo"));
  assert.ok(!email.html.includes("em anexo"));
  assert.ok(email.text.includes(base.pdfUrl));
});

test("nome com HTML e escapado (o lead digita o que quiser)", () => {
  const email = montarEmail("casamento", {
    ...base,
    nomeContato: '<img src=x onerror="alert(1)">',
  });
  assert.ok(!email.html.includes("<img"));
  assert.ok(email.html.includes("&lt;img"));
});

test("o & de 'Ana & Joao' vira entidade no HTML", () => {
  const email = montarEmail("casamento", { ...base, nomeContato: "Ana & João" });
  assert.ok(email.html.includes("Ana &amp; João"));
  // No texto puro continua sendo um & normal.
  assert.ok(email.text.includes("Ana & João"));
});

test("o e-mail pessoal cumprimenta quem preencheu, não o casal", () => {
  const email = montarEmail("casamento", base);
  assert.ok(email.text.startsWith("Oi, Lúcia!"));
  // O nome do casal nao aparece: a proposta em anexo ja fala por ela.
  assert.ok(!email.text.includes("Ana & João"));
});
