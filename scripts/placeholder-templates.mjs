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

const CATEGORIAS = {
  debutante: "Festa de 15 anos",
  aniversario: "Aniversário",
  casamento: "Casamento",
  corporativo: "Evento corporativo",
};

// A4 retrato, o formato mais provavel para a proposta exportada do Figma.
// Se a arte real usar outro tamanho, o placeholder deixa de importar.
const LARGURA = 595.28;
const ALTURA = 841.89;
const PAGINAS = 3;

const dir = path.join(process.cwd(), "assets", "templates");
await fs.mkdir(dir, { recursive: true });

for (const [categoria, rotulo] of Object.entries(CATEGORIAS)) {
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
      x: 40,
      y: ALTURA - 50,
      size: 11,
      font: sans,
      color: rgb(0.7, 0.6, 0.55),
    });

    page.drawText(rotulo, {
      x: 40,
      y: ALTURA - 80,
      size: 24,
      font: serif,
      color: rgb(0.23, 0.18, 0.16),
    });

    page.drawText(`página ${i + 1} de ${PAGINAS}`, {
      x: 40,
      y: 40,
      size: 10,
      font: sans,
      color: rgb(0.7, 0.6, 0.55),
    });
  }

  const destino = path.join(dir, `${categoria}.placeholder.pdf`);
  await fs.writeFile(destino, await doc.save());
  console.log(`✓ ${path.relative(process.cwd(), destino)}`);
}

console.log(
  `\n${Object.keys(CATEGORIAS).length} placeholders em ${LARGURA}x${ALTURA}pt. ` +
    `Calibre em /admin/debug-template?categoria=casamento`,
);
