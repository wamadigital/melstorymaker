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
 * ESTRATEGIA: a arte base vira IMAGEM, uma por pagina.
 *
 * O export do Figma e vetorial e traz ~96 mil operacoes de path (o padrao
 * topografico) mais 51 grupos de transparencia. Visualizador de PDF de celular
 * tem orcamento de renderizacao: diante disso ele desiste e pinta a pagina
 * BRANCA -- so ao dar zoom, que o obriga a redesenhar em blocos menores, o
 * conteudo aparece. Foi o que aconteceu em campo, e reduzir a pagina para A4
 * sozinho nao resolveu.
 *
 * Rasterizando, cada pagina vira um JPEG e o PDF passa a ser a coisa mais
 * simples que um visualizador sabe abrir. O texto que o lead LE como dado
 * (nome, data) nao esta aqui: ele e desenhado pelo pdf-lib por cima, em
 * runtime, e continua vetorial e nitido em qualquer zoom.
 *
 * Custo assumido: o texto DA ARTE (titulos, corpo, precos) vira pixel e
 * amolece em zoom extremo. Decisao do owner em 19/08/2026, com o PDF branco no
 * celular como alternativa.
 */

/** Pagina final: A4 — o frame do Figma (1240x1754 px) tem praticamente a mesma proporcao. */
const LARGURA_A4 = 595;
const ALTURA_A4 = 842;

/**
 * Altura do JPEG de cada pagina, em px. 1280 sobre uma pagina de 842 pt da
 * ~109 DPI efetivos -- mais que a largura da tela de qualquer celular, e uma
 * fracao do peso do vetor. Numero definido pelo owner.
 */
const ALTURA_RASTER = 1280;

/** Qualidade do JPEG. 82 e o ponto onde artefato para de aparecer em foto. */
const QUALIDADE_PADRAO = 82;

const LIMITE_ALERTA = 4 * 1024 * 1024;

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;

/**
 * Rasteriza uma pagina do Figma em JPEG.
 *
 * O -r do Ghostscript e relativo ao tamanho declarado da pagina de ORIGEM
 * (1240x1754 pt), entao a resolucao vai calculada para o resultado ter
 * exatamente ALTURA_RASTER px de altura, independentemente disso.
 */
async function rasterizar(entrada: string, saida: string, altura: number, qualidade: number) {
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
    // Antialias no texto e nos vetores: sem isto o padrao topografico vira
    // serrilhado visivel e a tipografia da arte fica dura.
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    "-o",
    saida,
    entrada,
  ]);
}

async function main() {
  const args = process.argv.slice(2);
  const opcao = (nome: string, padrao: number) => {
    const i = args.indexOf(nome);
    return i >= 0 ? Number(args[i + 1]) : padrao;
  };
  const altura = opcao("--altura", ALTURA_RASTER);
  const qualidade = opcao("--qualidade", QUALIDADE_PADRAO);
  // Descarta as flags E seus valores; o resto sao os posicionais.
  const usados = new Set<number>();
  for (const f of ["--altura", "--qualidade"]) {
    const i = args.indexOf(f);
    if (i >= 0) { usados.add(i); usados.add(i + 1); }
  }
  const [template, pasta] = args.filter((_, i) => !usados.has(i));

  if (!template || !(TEMPLATES as readonly string[]).includes(template) || !pasta) {
    console.error(
      `\nUso: npm run arte:preparar -- <template> <pasta> [--altura PX] [--qualidade N]\n` +
        `Templates: ${TEMPLATES.join(" | ")}\n`,
    );
    process.exit(1);
  }

  if (!Number.isFinite(altura) || altura < 600 || altura > 4000) {
    console.error(`\nAltura inválida: ${altura}px. Use entre 600 e 4000 (padrão ${ALTURA_RASTER}).\n`);
    process.exit(1);
  }
  if (!Number.isFinite(qualidade) || qualidade < 40 || qualidade > 95) {
    console.error(`\nQualidade inválida: ${qualidade}. Use entre 40 e 95 (padrão ${QUALIDADE_PADRAO}).\n`);
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

  const dpiEfetivo = Math.round((altura / ALTURA_A4) * 72);
  console.log(
    `\n\x1b[1m${template}\x1b[0m — ${paginas.length} página(s), ` +
      `raster ${altura}px (~${dpiEfetivo} DPI em A4), qualidade ${qualidade}\n`,
  );

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "arte-"));
  const doc = await PDFDocument.create();

  let brutoTotal = 0;
  let comprimidoTotal = 0;

  for (const [i, nome] of paginas.entries()) {
    const entrada = path.join(pasta, nome);
    const jpg = path.join(temp, `${i}.jpg`);

    const antes = (await fs.stat(entrada)).size;
    await rasterizar(entrada, jpg, altura, qualidade);
    const bytesJpg = await fs.readFile(jpg);
    const depois = bytesJpg.length;

    brutoTotal += antes;
    comprimidoTotal += depois;

    const img = await doc.embedJpg(bytesJpg);
    const pg = doc.addPage([LARGURA_A4, ALTURA_A4]);
    pg.drawImage(img, { x: 0, y: 0, width: LARGURA_A4, height: ALTURA_A4 });

    console.log(
      `  ${nome.padEnd(14)} ${mb(antes).padStart(8)} → ${mb(depois).padStart(8)}` +
        `  ${img.width}x${img.height}px`,
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
