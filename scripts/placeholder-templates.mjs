/**
 * Gera 4 PDFs base placeholder em assets/templates/.
 *
 * Existem para destravar o pipeline enquanto a arte real do Figma nao chega:
 * dao paginas com as dimensoes certas para calibrar coordenadas e testar a
 * geracao ponta a ponta. Sao gitignorados -- a arte de verdade e versionada.
 *
 *   npm run templates:placeholder
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Uma arte por TemplateId, nao por categoria: aniversario tem duas, escolhidas
// pela idade (14 ou menos = infantil).
const ARTES = {
  debutante: "Festa de 15 anos",
  aniversario_infantil: "Aniversário infantil",
  aniversario_adulto: "Aniversário adulto",
  casamento: "Casamento",
  corporativo: "Evento corporativo",
};

// Mesmo tamanho da arte real exportada do Figma: os frames tem 1240x1754 px e
// o export em PDF sai em 1240x1754 pt, ou seja, 1 px = 1 pt. Manter o mesmo
// tamanho evita que a proposta de uma categoria sem arte saia com folha de
// dimensao diferente das outras.
const LARGURA = 1240;
const ALTURA = 1754;
const PAGINAS = 7;

const dir = path.join(process.cwd(), "assets", "templates");
await fs.mkdir(dir, { recursive: true });

for (const [arte, rotulo] of Object.entries(ARTES)) {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < PAGINAS; i++) {
    const page = doc.addPage([LARGURA, ALTURA]);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: LARGURA,
      height: ALTURA,
      color: rgb(0.99, 0.98, 0.97),
    });

    page.drawText("PLACEHOLDER — arte real pendente do Figma", {
      x: 80,
      y: ALTURA - 100,
      size: 22,
      font: sans,
      color: rgb(0.7, 0.6, 0.55),
    });

    page.drawText(rotulo, {
      x: 80,
      y: ALTURA - 160,
      size: 48,
      font: serif,
      color: rgb(0.23, 0.18, 0.16),
    });

    page.drawText(`página ${i + 1} de ${PAGINAS}`, {
      x: 80,
      y: 80,
      size: 20,
      font: sans,
      color: rgb(0.7, 0.6, 0.55),
    });
  }

  const destino = path.join(dir, `${arte}.placeholder.pdf`);
  await fs.writeFile(destino, await doc.save());
  console.log(`✓ ${path.relative(process.cwd(), destino)}`);
}

console.log(
  `\n${Object.keys(ARTES).length} placeholders em ${LARGURA}x${ALTURA}pt. ` +
    `Calibre em /admin/debug-template?template=casamento`,
);
