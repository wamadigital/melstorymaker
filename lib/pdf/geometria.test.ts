import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ajustarTamanho, alinharX, converterY, hexParaRgb } from "./geometria";

const A4_ALTURA = 841.89;

/**
 * Fonte de mentira com largura previsivel: cada caractere ocupa
 * `porCaractere` x tamanho. `ajustarTamanho` so consulta widthOfTextAtSize,
 * entao isso basta -- e deixa a conta do teste exata, em vez de depender das
 * metricas da Helvetica.
 */
function fontFalsa(porCaractere: number) {
  return {
    widthOfTextAtSize: (t: string, tamanho: number) => t.length * porCaractere * tamanho,
  } as unknown as Parameters<typeof ajustarTamanho>[0];
}

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

// --------------------------------------------------------- recuo preventivo

test("recuo preventivo: texto folgado mantém o tamanho cheio", () => {
  const font = fontFalsa(1); // 1pt de largura por caractere por pt de tamanho
  // 10 chars a 10pt = 100 de largura, contra 1000 de limite: 10% do espaço.
  assert.equal(ajustarTamanho(font, "0123456789", 10, 1000, 2), 10);
});

test("recuo preventivo: passando de 90% da largura, tira os 2pt", () => {
  const font = fontFalsa(1);
  // 95 chars a 10pt = 950, contra 1000: 95% -> entra no recuo, vai a 8pt.
  const texto = "x".repeat(95);
  assert.equal(ajustarTamanho(font, texto, 10, 1000, 2), 8);
});

test("recuo preventivo não é atalho para estourar: o ajuste proporcional segura", () => {
  const font = fontFalsa(1);
  // 150 chars a 10pt = 1500. O recuo leva a 8pt = 1200, ainda acima de 1000,
  // entao o proporcional fecha a conta em 6,6pt e o texto cabe.
  const texto = "y".repeat(150);
  const t = ajustarTamanho(font, texto, 10, 1000, 2);
  assert.ok(t < 8, `esperava menos que 8pt, veio ${t}`);
  assert.ok(
    font.widthOfTextAtSize(texto, t) <= 1000,
    `deveria caber em 1000, ocupou ${font.widthOfTextAtSize(texto, t)}`,
  );
});

test("o piso de 6pt vence o encaixe: nome absurdo é problema da Mel, não da fonte", () => {
  const font = fontFalsa(1);
  // 200 chars exigiriam 5pt para caber. O piso segura em 6 e o texto estoura de
  // proposito -- encolher mais viraria uma linha ilegivel, e o caso real (alguem
  // colando um paragrafo no campo de nome) se resolve editando no painel.
  const t = ajustarTamanho(font, "y".repeat(200), 10, 1000, 2);
  assert.equal(t, 6);
});

test("sem recuo declarado, o comportamento antigo não muda", () => {
  const font = fontFalsa(1);
  const texto = "z".repeat(95);
  assert.equal(ajustarTamanho(font, texto, 10, 1000), 10);
});
