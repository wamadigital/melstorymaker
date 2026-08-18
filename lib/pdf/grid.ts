import "server-only";
import fs from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TemplateId } from "@/lib/form/types";
import { carregarFontes, textoSeguro } from "./fontes";
import { caminhoTemplate } from "./gerar";
import { ajustarTamanho, alinharX, converterY, hexParaRgb } from "./geometria";
import { fontesUsadas, templates } from "./templates.config";

/**
 * PDF de calibracao: a arte base com um grid de coordenadas por cima e os
 * campos do templates.config.ts desenhados com dado de exemplo.
 *
 * Os rotulos do eixo Y trazem as DUAS leituras -- "f" e a coordenada como o
 * Figma mostra (origem no topo) e "p" a do pdf-lib (origem embaixo) -- porque
 * confundir uma com a outra e o jeito mais rapido de perder uma tarde.
 *
 * Existe antes da primeira calibracao de proposito (regra do CLAUDE.md):
 * calibrar no olho custa horas, com o grid custa minutos.
 */

const PASSO_GRID = 20;
const PASSO_ROTULO = 100;

const EXEMPLOS: Record<string, string> = {
  debutante: "Maria Eduarda Albuquerque",
  aniversariante: "João Vitor",
  noivos: "Ana & João",
  empresa: "Acme Tecnologia Ltda",
  tipo_evento: "Confraternização de fim de ano",
  data: "14 de março de 2026",
  horario: "19h30",
  local: "Espaço Villa Bisutti",
  local_cerimonia: "Igreja Nossa Senhora do Brasil",
  local_festa: "Espaço Villa Bisutti",
  local_making_of: "Hotel Fasano",
};

export async function gerarPdfCalibracao(template: TemplateId): Promise<Uint8Array> {
  const config = templates[template];
  const { caminho, placeholder } = await caminhoTemplate(template);

  const pdfDoc = await PDFDocument.load(await fs.readFile(caminho));
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);
  const daMarca = await carregarFontes(pdfDoc, fontesUsadas(template));

  const cinza = rgb(0.75, 0.75, 0.8);
  const azul = rgb(0.1, 0.35, 0.9);
  const magenta = rgb(0.9, 0.1, 0.5);

  pdfDoc.getPages().forEach((page, indice) => {
    const { width, height } = page.getSize();

    // --- grid -------------------------------------------------------------
    for (let x = 0; x <= width; x += PASSO_GRID) {
      const forte = x % PASSO_ROTULO === 0;
      page.drawLine({
        start: { x, y: 0 },
        end: { x, y: height },
        thickness: forte ? 0.5 : 0.2,
        color: cinza,
        opacity: forte ? 0.9 : 0.45,
      });
      if (forte && x > 0) {
        page.drawText(String(x), { x: x + 2, y: height - 12, size: 6, font: mono, color: azul });
      }
    }

    for (let y = 0; y <= height; y += PASSO_GRID) {
      const forte = y % PASSO_ROTULO === 0;
      page.drawLine({
        start: { x: 0, y },
        end: { x: width, y },
        thickness: forte ? 0.5 : 0.2,
        color: cinza,
        opacity: forte ? 0.9 : 0.45,
      });
      if (forte && y > 0) {
        page.drawText(`f${Math.round(height - y)} p${y}`, {
          x: 2,
          y: y + 2,
          size: 6,
          font: mono,
          color: azul,
        });
      }
    }

    page.drawText(
      `${template} | pagina ${indice} | ${Math.round(width)}x${Math.round(height)}pt | ` +
        `f=figma(topo) p=pdf(base)${placeholder ? " | PLACEHOLDER" : ""}`,
      { x: 4, y: 4, size: 7, font: mono, color: magenta },
    );

    // --- campos configurados ----------------------------------------------
    for (const campo of config.campos.filter((c) => c.pagina === indice)) {
      const font = daMarca.obter(campo.font);
      const texto = textoSeguro(font, EXEMPLOS[campo.chave] ?? campo.chave);

      const escala = config.escala;
      const maxLargura = campo.maxLargura ? campo.maxLargura * escala : undefined;
      const tamanho = ajustarTamanho(font, texto, campo.tamanho * escala, maxLargura);
      const larguraTexto = font.widthOfTextAtSize(texto, tamanho);
      const x = alinharX(campo.x * escala, larguraTexto, campo.alinhamento);
      const y = converterY(campo.y, height, tamanho, config.origemCoordenadas, escala);

      // Caixa da maxLargura: mostra ate onde o texto pode crescer antes de encolher.
      if (maxLargura) {
        page.drawRectangle({
          x: alinharX(campo.x * escala, maxLargura, campo.alinhamento),
          y: y - 2,
          width: maxLargura,
          height: tamanho + 4,
          borderColor: magenta,
          borderWidth: 0.4,
          borderOpacity: 0.7,
          opacity: 0,
        });
      }

      // Cruz no ponto de ancoragem exato declarado no config.
      const ancora = campo.x * escala;
      page.drawLine({
        start: { x: ancora - 5, y },
        end: { x: ancora + 5, y },
        thickness: 0.6,
        color: magenta,
      });
      page.drawLine({
        start: { x: ancora, y: y - 5 },
        end: { x: ancora, y: y + 5 },
        thickness: 0.6,
        color: magenta,
      });

      page.drawText(texto, { x, y, size: tamanho, font, color: hexParaRgb(campo.cor) });
      page.drawText(
        `${campo.chave} x${campo.x} y${campo.y} (${config.origemCoordenadas}) ${campo.tamanho}pt`,
        { x: ancora, y: y + tamanho + 3, size: 5.5, font: mono, color: magenta },
      );
    }
  });

  return pdfDoc.save();
}
