import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";

/**
 * Nomes logicos usados no templates.config.ts. O config nunca aponta para um
 * caminho de arquivo: trocar o .ttf da marca nao encosta na configuracao de
 * coordenadas.
 */
export type NomeFonte =
  | "BrandSerif-Bold"
  | "BrandSerif-Regular"
  | "BrandSans-Bold"
  | "BrandSans-Regular";

const ARQUIVOS: Record<NomeFonte, string> = {
  "BrandSerif-Bold": "BrandSerif-Bold.ttf",
  "BrandSerif-Regular": "BrandSerif-Regular.ttf",
  "BrandSans-Bold": "BrandSans-Bold.ttf",
  "BrandSans-Regular": "BrandSans-Regular.ttf",
};

// Usadas enquanto as fontes da marca nao chegam no repo. Servem para calibrar
// coordenadas; NAO servem para a proposta final ir pro lead.
const FALLBACK: Record<NomeFonte, StandardFonts> = {
  "BrandSerif-Bold": StandardFonts.TimesRomanBold,
  "BrandSerif-Regular": StandardFonts.TimesRoman,
  "BrandSans-Bold": StandardFonts.HelveticaBold,
  "BrandSans-Regular": StandardFonts.Helvetica,
};

export const DIR_FONTES = path.join(process.cwd(), "assets", "fonts");

const avisadas = new Set<string>();

export type Fontes = {
  obter: (nome: NomeFonte) => PDFFont;
  /** true quando ao menos uma fonte caiu no fallback. O painel avisa a Mel. */
  usouFallback: boolean;
};

/**
 * Carrega e embute as fontes necessarias.
 *
 * `registerFontkit` precisa acontecer ANTES de qualquer embedFont de fonte
 * custom -- sem isso o pdf-lib recusa o .ttf com um erro que nao explica nada.
 */
export async function carregarFontes(pdfDoc: PDFDocument, nomes: NomeFonte[]): Promise<Fontes> {
  pdfDoc.registerFontkit(fontkit);

  const mapa = new Map<NomeFonte, PDFFont>();
  let usouFallback = false;

  for (const nome of new Set(nomes)) {
    const arquivo = path.join(DIR_FONTES, ARQUIVOS[nome]);
    try {
      const bytes = await fs.readFile(arquivo);
      // subset: so os glifos usados entram no PDF, o que segura o tamanho do
      // anexo bem abaixo do limite de e-mail.
      mapa.set(nome, await pdfDoc.embedFont(bytes, { subset: true }));
    } catch {
      usouFallback = true;
      if (!avisadas.has(nome)) {
        avisadas.add(nome);
        console.warn(
          `[pdf] fonte da marca "${nome}" nao encontrada em ${arquivo}. ` +
            `Usando ${FALLBACK[nome]} como fallback -- a proposta NAO esta fiel a arte.`,
        );
      }
      mapa.set(nome, await pdfDoc.embedFont(FALLBACK[nome]));
    }
  }

  return {
    obter: (nome) => {
      const f = mapa.get(nome);
      if (!f) throw new Error(`Fonte "${nome}" nao foi carregada antes do uso.`);
      return f;
    },
    usouFallback,
  };
}

/**
 * Remove caracteres que a fonte nao consegue codificar.
 *
 * As fontes padrao do PDF usam WinAnsi: acento portugues passa, mas um emoji
 * digitado no nome do lead faz o drawText lancar excecao e derruba a geracao
 * inteira. Melhor perder o emoji do que perder a proposta.
 */
export function textoSeguro(font: PDFFont, texto: string): string {
  if (!texto) return "";
  try {
    font.encodeText(texto);
    return texto;
  } catch {
    return [...texto]
      .filter((c) => {
        try {
          font.encodeText(c);
          return true;
        } catch {
          return false;
        }
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }
}
