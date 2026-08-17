import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ajustarTamanho, alinharX, converterY, hexParaRgb } from "./geometria";

const A4_ALTURA = 841.89;

async function fonte() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

test("origem figma inverte o eixo e desconta a baseline", () => {
  // Texto de 32pt a 100pt do topo da pagina A4.
  assert.equal(converterY(100, A4_ALTURA, 32, "figma", 1), A4_ALTURA - 100 - 32);
});

test("origem pdf usa o valor como esta", () => {
  // Coordenada lida direto do grid de calibracao ja esta no sistema do pdf-lib.
  assert.equal(converterY(520, A4_ALTURA, 32, "pdf", 1), 520);
});

test("escala aplica ao frame do Figma exportado em outro tamanho", () => {
  // Frame de 1190pt exportado numa pagina de 595pt: tudo vale metade.
  const escala = 0.5;
  assert.equal(converterY(200, A4_ALTURA, 16, "figma", escala), A4_ALTURA - 100 - 16);
});

test("topo do Figma (y=0) cai no topo da pagina do PDF", () => {
  const y = converterY(0, A4_ALTURA, 12, "figma", 1);
  assert.equal(y, A4_ALTURA - 12);
  assert.ok(y < A4_ALTURA && y > A4_ALTURA - 20);
});

test("texto que ja cabe nao encolhe", async () => {
  const f = await fonte();
  assert.equal(ajustarTamanho(f, "Ana", 32, 420), 32);
});

test("nome longo encolhe ate caber, sem quebrar linha", async () => {
  const f = await fonte();
  const nome = "Maria Eduarda Albuquerque dos Santos Nascimento";
  const max = 300;

  const tamanho = ajustarTamanho(f, nome, 32, max);
  assert.ok(tamanho < 32, "deveria ter encolhido");
  assert.ok(f.widthOfTextAtSize(nome, tamanho) <= max, "ainda estoura a largura");
});

test("encolhimento respeita o piso de 6pt", async () => {
  const f = await fonte();
  const absurdo = "x".repeat(2000);
  assert.equal(ajustarTamanho(f, absurdo, 32, 100), 6);
});

test("sem maxLargura o tamanho e preservado", async () => {
  const f = await fonte();
  assert.equal(ajustarTamanho(f, "qualquer coisa bem longa aqui", 32, undefined), 32);
});

test("alinhamento centraliza e alinha a direita", () => {
  assert.equal(alinharX(297, 100, "centro"), 247);
  assert.equal(alinharX(500, 100, "direita"), 400);
  assert.equal(alinharX(90, 100, "esquerda"), 90);
  assert.equal(alinharX(90, 100, undefined), 90);
});

test("hex da arte vira rgb normalizado", () => {
  const c = hexParaRgb("#3A2E2A");
  assert.ok(Math.abs(c.red - 0x3a / 255) < 1e-9);
  assert.ok(Math.abs(c.green - 0x2e / 255) < 1e-9);
  assert.ok(Math.abs(c.blue - 0x2a / 255) < 1e-9);
});

test("hex curto e hex invalido nao derrubam a geracao", () => {
  assert.deepEqual(hexParaRgb("#fff"), hexParaRgb("#ffffff"));
  const preto = hexParaRgb("nao-e-cor");
  assert.equal(preto.red, 0);
  assert.equal(preto.green, 0);
  assert.equal(preto.blue, 0);
});
