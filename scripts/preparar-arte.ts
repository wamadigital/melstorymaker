/**
 * Prepara a arte base de uma categoria a partir das páginas exportadas do Figma.
 *
 *   npm run arte:preparar -- casamento 2027 .arte-bruta/casamento
 *
 * Recebe uma pasta com as páginas soltas em PDF (nomeadas em ordem alfabética:
 * 01.pdf, 02.pdf, ...), comprime cada uma, une tudo e grava em
 * assets/templates/<template>.<tabela>.pdf.
 *
 * A TABELA é posicional e obrigatória, não uma flag com padrão: o preço está
 * desenhado na arte, então errar a tabela aqui sobrescreve silenciosamente a
 * arte de um ano com as páginas de outro.
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
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { TEMPLATES, type TemplateId } from "@/lib/form/types";
import { PACOTES, TABELAS_PRECO, type TabelaPreco } from "@/lib/pdf/precos";
import {
  ALTURA_A4,
  ALTURA_RASTER,
  LARGURA_A4,
  LIMITE_ALERTA,
  QUALIDADE_PADRAO,
  garantirGhostscript,
  mb,
  rasterizar,
  validarRaster,
} from "./arte-raster";

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
 *
 * O caminho vetorial FOI TENTADO e nao resolveu: converter so as ondas em PNG
 * (feito no Figma, e que continua valendo) derrubou os grupos de transparencia
 * de 51 para zero, mas os paths so cairam de 96.405 para 78.027 -- porque o
 * Figma exporta TEXTO COMO CONTORNO, sem fonte embutida (zero /FontFile). Cada
 * letra vira dezenas de curvas e o corpo de texto sozinho responde por ~12 mil
 * operacoes por pagina. Nao ha como reduzir isso do lado do Ghostscript, e no
 * celular a pagina continuou branca. Nao repetir a tentativa.
 */

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
  const [template, tabela, pasta] = args.filter((_, i) => !usados.has(i));

  if (
    !template ||
    !(TEMPLATES as readonly string[]).includes(template) ||
    !tabela ||
    !(TABELAS_PRECO as readonly string[]).includes(tabela) ||
    !pasta
  ) {
    console.error(
      `\nUso: npm run arte:preparar -- <template> <tabela> <pasta> [--altura PX] [--qualidade N]\n` +
        `Templates: ${TEMPLATES.join(" | ")}\n` +
        `Tabelas:   ${TABELAS_PRECO.join(" | ")}\n`,
    );
    process.exit(1);
  }

  validarRaster(altura, qualidade);
  await garantirGhostscript();

  const paginas = (await fs.readdir(pasta))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (paginas.length === 0) {
    console.error(`\nNenhum PDF em ${pasta}.\n`);
    process.exit(1);
  }

  // A validação acima já garantiu que os dois valores pertencem às listas.
  const arte = template as TemplateId;
  const tab = tabela as TabelaPreco;

  const dpiEfetivo = Math.round((altura / ALTURA_A4) * 72);
  console.log(
    `\n\x1b[1m${arte}\x1b[0m · tabela \x1b[1m${tab}\x1b[0m — ${paginas.length} página(s), ` +
      `raster ${altura}px (~${dpiEfetivo} DPI em A4), qualidade ${qualidade}\n`,
  );

  // O preço é PIXEL: nenhum teste consegue conferir se a página de Pacotes saiu
  // com os valores certos. O que dá para fazer é mostrar, no momento em que a
  // arte entra no repo, o que ela deveria dizer -- e deixar a conferência com
  // quem está olhando as páginas.
  console.log(`  \x1b[1mConfira na página de Pacotes (tabela ${tab}):\x1b[0m`);
  for (const { nome, valor } of PACOTES[tab][arte]) {
    console.log(`    ${nome.padEnd(22)} R$ ${valor}`);
  }
  console.log(
    `    \x1b[2mopcionais, locomoção, reserva de 30% e validade não mudam entre tabelas\x1b[0m\n`,
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

  const arquivoFinal = path.join(process.cwd(), "assets", "templates", `${arte}.${tab}.pdf`);
  await fs.mkdir(path.dirname(arquivoFinal), { recursive: true });
  await fs.writeFile(arquivoFinal, await doc.save());
  await fs.rm(temp, { recursive: true, force: true });

  const final = (await fs.stat(arquivoFinal)).size;
  console.log(
    `\n  bruto ${mb(brutoTotal)} → comprimido ${mb(comprimidoTotal)} → final ${mb(final)}`,
  );
  console.log(`  \x1b[32m✓\x1b[0m assets/templates/${arte}.${tab}.pdf`);

  if (final > LIMITE_ALERTA) {
    console.warn(
      `\n  \x1b[33m! acima de ${mb(LIMITE_ALERTA)}: o PDF vai por anexo de e-mail.\x1b[0m\n` +
        `    Reduza as fotos na origem, no Figma, antes de baixar o DPI daqui.`,
    );
  }
  console.log(`\n  Calibre em /admin/debug-template?template=${arte}&tabela=${tab}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
