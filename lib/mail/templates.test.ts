import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEmail, montarEmailLembrete } from "./templates";

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

// ------------------------------------------------------ lembrete de quem parou

const lembrete = {
  primeiroNome: "Lúcia",
  nomeDisplay: "Ana & João",
  linkContinuar: "https://melstorymaker.com.br/continuar/3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b",
  linkWhatsAppMel: "https://wa.me/5519999998888",
};

test("lembrete: o link é o de continuar, nas duas versões e nas duas copies", () => {
  // O formulario cru recomecaria do zero no navegador do e-mail: o link certo
  // e o que grava o lead e retoma de onde ele parou.
  for (const cat of ["casamento", "corporativo"] as const) {
    const email = montarEmailLembrete(cat, lembrete);
    assert.ok(email.text.includes(lembrete.linkContinuar), `${cat}: continuar faltando no texto`);
    assert.ok(email.html.includes(lembrete.linkContinuar), `${cat}: continuar faltando no HTML`);
    assert.ok(email.text.includes(lembrete.linkWhatsAppMel), `${cat}: WhatsApp faltando no texto`);
    assert.ok(email.html.includes(lembrete.linkWhatsAppMel), `${cat}: WhatsApp faltando no HTML`);
  }
});

test("lembrete pessoal cumprimenta pelo primeiro nome, no texto e no assunto", () => {
  const email = montarEmailLembrete("casamento", lembrete);
  assert.ok(email.text.startsWith("Oi, Lúcia!"));
  assert.equal(email.subject, "Seu orçamento está te esperando, Lúcia ✨ | Mel Simão Storymaker");
  // Quem le e quem preencheu, nao o casal.
  assert.ok(!email.text.includes("Ana & João"));
});

test("lembrete sem nome não deixa vírgula nem buraco", () => {
  const email = montarEmailLembrete("debutante", { ...lembrete, primeiroNome: "" });
  assert.ok(email.text.startsWith("Oi!\n"));
  assert.equal(email.subject, "Seu orçamento está te esperando ✨ | Mel Simão Storymaker");
  for (const lixo of ["undefined", "null", "Oi, !", ", ✨"]) {
    assert.ok(!email.text.includes(lixo) && !email.html.includes(lixo) && !email.subject.includes(lixo), lixo);
  }
});

test("lembrete corporativo usa a voz da copy corporativa e fala da empresa", () => {
  const email = montarEmailLembrete("corporativo", { ...lembrete, nomeDisplay: "Acme Ltda" });
  assert.ok(email.text.startsWith("Olá!"));
  assert.ok(email.text.includes("um orçamento para a Acme Ltda"));
  assert.ok(email.text.includes("Até já,"));
  assert.ok(!email.text.includes("Com carinho"));
  assert.equal(email.subject, "Seu orçamento está te esperando ✨ | Mel Simão Storymaker");

  const semEmpresa = montarEmailLembrete("corporativo", { ...lembrete, nomeDisplay: "" });
  assert.ok(semEmpresa.text.includes("começou a pedir um orçamento, mas"));
});

test("lembrete escapa o que o lead digitou", () => {
  const email = montarEmailLembrete("corporativo", { ...lembrete, nomeDisplay: '<img src=x onerror="alert(1)">' });
  assert.ok(email.html.includes("&lt;img"));
  const pessoal = montarEmailLembrete("casamento", { ...lembrete, primeiroNome: "<b>Lu</b>" });
  assert.ok(!pessoal.html.includes("<b>Lu</b>"));
});

test("lembrete não tem pixel de abertura (regra 8)", () => {
  for (const cat of ["aniversario", "corporativo"] as const) {
    const { html } = montarEmailLembrete(cat, lembrete);
    assert.ok(!/<img/i.test(html), `${cat}: <img> no e-mail é rastreio de abertura`);
  }
});
