import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { Categoria, Respostas } from "@/lib/form/types";
import { FORMATADORES } from "./formatadores";
import { carregarFontes, textoSeguro } from "./fontes";
import { ajustarTamanho, alinharX, converterY, hexParaRgb } from "./geometria";
import { fontesUsadas, templates, type CampoTemplate, type TemplateConfig } from "./templates.config";

export const DIR_TEMPLATES = path.join(process.cwd(), "assets", "templates");

export type ResultadoPdf = {
  bytes: Uint8Array;
  /** true quando a arte real ainda nao esta no repo (rodou sobre placeholder). */
  usouPlaceholder: boolean;
  /** true quando alguma fonte da marca faltou e caiu no fallback. */
  usouFallbackDeFonte: boolean;
};

/** Resolve "respostas.nome" no contexto do lead. */
function resolver(caminho: string, contexto: Record<string, unknown>): string {
  const valor = caminho.split(".").reduce<unknown>((acc, chave) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[chave];
    return undefined;
  }, contexto);

  return valor == null ? "" : String(valor);
}

function desenharCampo(
  page: PDFPage,
  campo: CampoTemplate,
  config: TemplateConfig,
  font: PDFFont,
  bruto: string,
) {
  const formatado = campo.formato ? FORMATADORES[campo.formato](bruto) : bruto;
  const texto = textoSeguro(font, formatado.trim());
  if (!texto) return;

  const { height } = page.getSize();
  const escala = config.escala;

  const tamanhoBase = campo.tamanho * escala;
  const maxLargura = campo.maxLargura ? campo.maxLargura * escala : undefined;
  const tamanho = ajustarTamanho(font, texto, tamanhoBase, maxLargura);

  page.drawText(texto, {
    x: alinharX(campo.x * escala, font.widthOfTextAtSize(texto, tamanho), campo.alinhamento),
    y: converterY(campo.y, height, tamanho, config.origemCoordenadas, escala),
    size: tamanho,
    font,
    color: hexParaRgb(campo.cor),
  });
}

/**
 * Caminho do PDF base. Prefere a arte real e cai no placeholder gerado por
 * script enquanto o export do Figma nao chega, para o pipeline nunca travar.
 */
export async function caminhoTemplate(
  categoria: Categoria,
): Promise<{ caminho: string; placeholder: boolean }> {
  const real = path.join(process.cwd(), templates[categoria].basePdf);
  try {
    await fs.access(real);
    return { caminho: real, placeholder: false };
  } catch {
    const provisorio = path.join(DIR_TEMPLATES, `${categoria}.placeholder.pdf`);
    try {
      await fs.access(provisorio);
      return { caminho: provisorio, placeholder: true };
    } catch {
      throw new Error(
        `Template da categoria "${categoria}" nao encontrado. Coloque a arte em ` +
          `${templates[categoria].basePdf} ou rode \`npm run templates:placeholder\`.`,
      );
    }
  }
}

/** Aplica os campos dinamicos sobre a arte da categoria. */
export async function gerarProposta(
  categoria: Categoria,
  respostas: Respostas,
): Promise<ResultadoPdf> {
  const config = templates[categoria];
  const { caminho, placeholder } = await caminhoTemplate(categoria);

  const pdfDoc = await PDFDocument.load(await fs.readFile(caminho));
  const fontes = await carregarFontes(pdfDoc, fontesUsadas(categoria));
  const paginas = pdfDoc.getPages();
  const contexto = { respostas };

  for (const campo of config.campos) {
    const page = paginas[campo.pagina];
    if (!page) {
      console.warn(
        `[pdf] campo "${campo.chave}" aponta para a pagina ${campo.pagina}, ` +
          `mas ${categoria} tem ${paginas.length}. Campo ignorado.`,
      );
      continue;
    }

    const bruto = resolver(campo.fonte, contexto);
    // Campo vazio nao e erro: making_of = "Nao" deixa local_making_of sem valor.
    if (!bruto) continue;

    desenharCampo(page, campo, config, fontes.obter(campo.font), bruto);
  }

  return {
    bytes: await pdfDoc.save(),
    usouPlaceholder: placeholder,
    usouFallbackDeFonte: fontes.usouFallback,
  };
}
