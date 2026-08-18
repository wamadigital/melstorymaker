import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";

/**
 * Fontes da marca. A arte usa DM Sans (Google Fonts, licenca OFL) -- por isso
 * os arquivos podem viver no repo sem questao de licenciamento.
 *
 * Historico util: a arte original do Figma usava Averta, que e comercial. A
 * migracao para DM Sans foi decisao do owner, e e o que permite o PDF sair
 * fiel sem depender de fonte paga no servidor.
 */
export type NomeFonte = "DMSans-Light" | "DMSans-Regular" | "DMSans-Bold";

const ARQUIVOS: Record<NomeFonte, string> = {
  "DMSans-Light": "DMSans-Light.ttf",
  "DMSans-Regular": "DMSans-Regular.ttf",
  "DMSans-Bold": "DMSans-Bold.ttf",
};

// Rede de seguranca para o caso de o .ttf sumir do deploy. Nao e para ser
// acionado: se for, o painel avisa a Mel de que o PDF nao esta fiel a arte.
const FALLBACK: Record<NomeFonte, StandardFonts> = {
  "DMSans-Light": StandardFonts.Helvetica,
  "DMSans-Regular": StandardFonts.Helvetica,
  "DMSans-Bold": StandardFonts.HelveticaBold,
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
