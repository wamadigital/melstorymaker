/**
 * Parâmetros e rotina de rasterização da arte, compartilhados por
 * `arte:preparar` (monta uma arte inteira) e `arte:derivar` (troca páginas de
 * uma arte já publicada para criar a de outra tabela de preço).
 *
 * Vivem aqui, e não duplicados nos dois scripts, porque descrevem A MESMA
 * transformação: se as duas rotinas divergirem, a página trocada sai com
 * nitidez diferente das vizinhas dentro do mesmo PDF — e como a arte inteira é
 * imagem, isso aparece na tela do lead.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";

const exec = promisify(execFile);

/** Página final: A4 — o frame do Figma (1240x1754 px) tem praticamente a mesma proporção. */
export const LARGURA_A4 = 595;
export const ALTURA_A4 = 842;

/**
 * Altura do JPEG de cada página, em px.
 *
 * 2000 sobre uma página de 842 pt dá ~171 DPI efetivos. Número definido pelo
 * owner em 20/08/2026, subindo dos 1280 (~109 DPI) da primeira versão: a 1280
 * o texto DA ARTE ficava visivelmente mole ao dar zoom no celular.
 *
 * Antes de baixar este número de novo, lembre que ele é o único controle de
 * nitidez que resta — a arte inteira é imagem.
 */
export const ALTURA_RASTER = 2000;

/** Qualidade do JPEG. 82 é o ponto onde artefato para de aparecer em foto. */
export const QUALIDADE_PADRAO = 82;

export const LIMITE_ALERTA = 4 * 1024 * 1024;

export const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;

export async function garantirGhostscript() {
  try {
    await exec("gs", ["--version"]);
  } catch {
    console.error("\nGhostscript não encontrado. Instale com `brew install ghostscript`.\n");
    process.exit(1);
  }
}

/**
 * Rasteriza uma página do Figma em JPEG.
 *
 * O -r do Ghostscript é relativo ao tamanho declarado da página de ORIGEM
 * (1240x1754 pt), então a resolução vai calculada para o resultado ter
 * exatamente `altura` px de altura, independentemente disso.
 */
export async function rasterizar(
  entrada: string,
  saida: string,
  altura: number,
  qualidade: number,
) {
  const doc = await PDFDocument.load(await fs.readFile(entrada));
  const { height } = doc.getPage(0).getSize();
  const r = (altura / height) * 72;

  await exec("gs", [
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-sDEVICE=jpeg",
    `-dJPEGQ=${qualidade}`,
    `-r${r.toFixed(4)}`,
    // Antialias no texto e nos vetores: sem isto o padrão topográfico vira
    // serrilhado visível e a tipografia da arte fica dura.
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    "-o",
    saida,
    entrada,
  ]);
}

/** Valida os limites das flags `--altura` e `--qualidade`, comuns aos dois scripts. */
export function validarRaster(altura: number, qualidade: number) {
  if (!Number.isFinite(altura) || altura < 600 || altura > 4000) {
    console.error(`\nAltura inválida: ${altura}px. Use entre 600 e 4000 (padrão ${ALTURA_RASTER}).\n`);
    process.exit(1);
  }
  if (!Number.isFinite(qualidade) || qualidade < 40 || qualidade > 95) {
    console.error(`\nQualidade inválida: ${qualidade}. Use entre 40 e 95 (padrão ${QUALIDADE_PADRAO}).\n`);
    process.exit(1);
  }
}
