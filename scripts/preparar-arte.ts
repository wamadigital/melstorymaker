/**
 * Prepara a arte base de uma categoria a partir das páginas exportadas do Figma.
 *
 *   npm run arte:preparar -- casamento .arte-bruta/casamento
 *
 * Recebe uma pasta com as páginas soltas em PDF (nomeadas em ordem alfabética:
 * 01.pdf, 02.pdf, ...), comprime cada uma, une tudo e grava em
 * assets/templates/<template>.pdf.
 *
 * POR QUE COMPRIMIR: o Figma exporta as fotos na resolução original. Uma
 * página de galeria saiu com 11,4 MB porque as fotos têm 3024x4032 para ocupar
 * ~260x390 pt no layout. Ghostscript a 150dpi derruba para ~1 MB sem perda
 * visível. Sem esse passo a proposta estoura o limite de anexo de e-mail.
 *
 * O Ghostscript roda SÓ aqui, na preparação do asset. O que vai para o repo e
 * para a Vercel é o PDF já pronto: em produção continua sendo apenas pdf-lib,
 * como manda a decisão travada nº1 do CLAUDE.md.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { TEMPLATES } from "@/lib/form/types";

const exec = promisify(execFile);

/**
 * A arte e desenhada num frame de 1240x1754 PX no Figma, e o export manda cada
 * px como 1 PT -- ou seja, 43,7 x 61,9 cm, mais de quatro A4 de area.
 *
 * Isso quebrava a leitura no celular: o visualizador tenta encaixar 43 cm numa
 * tela de 7, estoura o limite de bitmap e desenha a pagina BRANCA; so ao dar
 * zoom ele re-renderiza em blocos e o conteudo aparece. E ainda sabotava a
 * compressao, porque "150 DPI" era calculado sobre 43 cm.
 *
 * Aqui a pagina volta para largura de A4 preservando a proporcao exata do
 * frame. A altura sai 841,64 pt contra os 842 da A4 -- diferenca de 0,13 mm, e
 * em troca a escala fica sendo 595/1240 redondo, sem tarja nem deslocamento.
 */
const LARGURA_A4 = 595;
const LARGURA_FRAME = 1240;
const ALTURA_FRAME = 1754;
const ESCALA_ARTE = LARGURA_A4 / LARGURA_FRAME;
const ALTURA_DESTINO = +(ALTURA_FRAME * ESCALA_ARTE).toFixed(2);

/**
 * A proposta e 100% DIGITAL -- ninguem imprime isto. O alvo nao e a regra de
 * impressao (150/300 DPI), e a tela: a pagina tem 595 pt de largura e os
 * visualizadores renderizam por volta de 2x, entao 144 DPI (2 x 72) cobre uma
 * pagina inteira com ~1190 px. Isso ja e mais largo que a tela da maioria dos
 * celulares; acima disso sao bytes que so custam tempo em rede movel.
 *
 * Configuravel para o preparo poder comparar: `arte:preparar -- x pasta --dpi 120`.
 */
const DPI_PADRAO = 144;
const LIMITE_ALERTA = 4 * 1024 * 1024;

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;

/** Redimensiona para largura de A4 E comprime, na mesma passada. */
async function comprimir(entrada: string, saida: string, dpi: number) {
  await exec("gs", [
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.5",
    // Pagina de destino + encaixe. Com a proporcao preservada, o encaixe e uma
    // multiplicacao limpa por 595/1240 -- sem tarja e sem deslocamento, entao
    // as coordenadas do Figma seguem valendo via `escala` no config.
    `-dDEVICEWIDTHPOINTS=${LARGURA_A4}`,
    `-dDEVICEHEIGHTPOINTS=${ALTURA_DESTINO}`,
    "-dFIXEDMEDIA",
    "-dPDFFitPage",
    // Downsample DEPOIS do redimensionamento: e a area final da imagem na
    // pagina que decide quantos pixels ela precisa ter.
    "-dDownsampleColorImages=true",
    "-dColorImageDownsampleType=/Bicubic",
    `-dColorImageResolution=${dpi}`,
    "-dDownsampleGrayImages=true",
    "-dGrayImageDownsampleType=/Bicubic",
    `-dGrayImageResolution=${dpi}`,
    "-dJPEGQ=80",
    // Sem isto o Ghostscript reescreve as fontes e pode trocar o desenho das
    // letras; a arte precisa sair idêntica ao Figma.
    "-dSubsetFonts=true",
    "-dEmbedAllFonts=true",
    `-sOutputFile=${saida}`,
    entrada,
  ]);
}

async function main() {
  const args = process.argv.slice(2);
  const iDpi = args.indexOf("--dpi");
  const dpi = iDpi >= 0 ? Number(args[iDpi + 1]) : DPI_PADRAO;
  // Sem --dpi, iDpi e -1 e "iDpi + 1" seria 0 -- descartaria o template.
  const posicionais = args.filter((_, i) => iDpi < 0 || (i !== iDpi && i !== iDpi + 1));
  const [template, pasta] = posicionais;

  if (!template || !(TEMPLATES as readonly string[]).includes(template) || !pasta) {
    console.error(
      `\nUso: npm run arte:preparar -- <template> <pasta-com-paginas> [--dpi N]\n` +
        `Templates: ${TEMPLATES.join(" | ")}\n`,
    );
    process.exit(1);
  }

  if (!Number.isFinite(dpi) || dpi < 48 || dpi > 300) {
    console.error(`\nDPI inválido: ${dpi}. Use algo entre 48 e 300 (padrão ${DPI_PADRAO}).\n`);
    process.exit(1);
  }

  try {
    await exec("gs", ["--version"]);
  } catch {
    console.error("\nGhostscript não encontrado. Instale com `brew install ghostscript`.\n");
    process.exit(1);
  }

  const paginas = (await fs.readdir(pasta))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (paginas.length === 0) {
    console.error(`\nNenhum PDF em ${pasta}.\n`);
    process.exit(1);
  }

  console.log(`\n\x1b[1m${template}\x1b[0m — ${paginas.length} página(s), ${dpi} DPI, largura A4\n`);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "arte-"));
  const doc = await PDFDocument.create();

  let brutoTotal = 0;
  let comprimidoTotal = 0;

  for (const [i, nome] of paginas.entries()) {
    const entrada = path.join(pasta, nome);
    const saida = path.join(temp, `${i}.pdf`);

    const antes = (await fs.stat(entrada)).size;
    await comprimir(entrada, saida, dpi);
    const depois = (await fs.stat(saida)).size;

    brutoTotal += antes;
    comprimidoTotal += depois;

    const origem = await PDFDocument.load(await fs.readFile(saida));
    const copiadas = await doc.copyPages(origem, origem.getPageIndices());
    copiadas.forEach((p) => doc.addPage(p));

    const { width, height } = copiadas[0].getSize();
    console.log(
      `  ${nome.padEnd(14)} ${mb(antes).padStart(8)} → ${mb(depois).padStart(8)}` +
        `  ${Math.round(width)}x${Math.round(height)}pt`,
    );
  }

  // Páginas de tamanhos diferentes indicam frame fora do padrão no Figma, e a
  // proposta sairia com uma folha de outro tamanho no meio.
  const tamanhos = new Set(
    doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`),
  );
  if (tamanhos.size > 1) {
    console.warn(`\n  \x1b[33m! páginas com tamanhos diferentes: ${[...tamanhos].join(", ")}\x1b[0m`);
  }

  const arquivoFinal = path.join(process.cwd(), "assets", "templates", `${template}.pdf`);
  await fs.mkdir(path.dirname(arquivoFinal), { recursive: true });
  await fs.writeFile(arquivoFinal, await doc.save());
  await fs.rm(temp, { recursive: true, force: true });

  const final = (await fs.stat(arquivoFinal)).size;
  console.log(
    `\n  bruto ${mb(brutoTotal)} → comprimido ${mb(comprimidoTotal)} → final ${mb(final)}`,
  );
  console.log(`  \x1b[32m✓\x1b[0m assets/templates/${template}.pdf`);

  if (final > LIMITE_ALERTA) {
    console.warn(
      `\n  \x1b[33m! acima de ${mb(LIMITE_ALERTA)}: o PDF vai por anexo de e-mail.\x1b[0m\n` +
        `    Reduza as fotos na origem, no Figma, antes de baixar o DPI daqui.`,
    );
  }
  console.log(`\n  Calibre em /admin/debug-template?template=${template}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
