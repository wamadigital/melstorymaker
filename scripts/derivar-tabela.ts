/**
 * Deriva a arte de uma TABELA DE PREÇO a partir da arte de outra, trocando só
 * as páginas que mudaram.
 *
 *   npm run arte:derivar -- casamento 2026 2027 .arte-2027/casamento
 *
 * A pasta traz apenas as páginas novas, exportadas do Figma e nomeadas pelo
 * NÚMERO DA PÁGINA que substituem (`03.pdf` troca a terceira). Todas as outras
 * são copiadas byte a byte da arte de origem.
 *
 * POR QUE DERIVAR EM VEZ DE REMONTAR: entre duas tabelas muda o preço e mais
 * nada. Remontar a arte inteira a partir de um reexport do Figma abriria espaço
 * para as páginas comuns saírem diferentes — bastaria alguém ter mexido numa
 * foto desde o último preparo, e as duas tabelas passariam a divergir em coisas
 * que não têm nada a ver com preço. Copiando as páginas da arte já publicada, a
 * única diferença possível é a que se quis fazer.
 *
 * O Ghostscript roda SÓ aqui, na preparação do asset, como no `arte:preparar`:
 * em produção continua sendo apenas pdf-lib (decisão travada nº1 do CLAUDE.md).
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

function arquivoDaTabela(arte: TemplateId, tabela: TabelaPreco) {
  return path.join(process.cwd(), "assets", "templates", `${arte}.${tabela}.pdf`);
}

async function main() {
  const args = process.argv.slice(2);
  const opcao = (nome: string, padrao: number) => {
    const i = args.indexOf(nome);
    return i >= 0 ? Number(args[i + 1]) : padrao;
  };
  const altura = opcao("--altura", ALTURA_RASTER);
  const qualidade = opcao("--qualidade", QUALIDADE_PADRAO);

  const usados = new Set<number>();
  for (const f of ["--altura", "--qualidade"]) {
    const i = args.indexOf(f);
    if (i >= 0) { usados.add(i); usados.add(i + 1); }
  }
  const [arteBruta, origemBruta, destinoBruta, pasta] = args.filter((_, i) => !usados.has(i));

  const ehArte = (v: string) => (TEMPLATES as readonly string[]).includes(v);
  const ehTabela = (v: string) => (TABELAS_PRECO as readonly string[]).includes(v);

  if (!arteBruta || !ehArte(arteBruta) || !origemBruta || !ehTabela(origemBruta) ||
      !destinoBruta || !ehTabela(destinoBruta) || !pasta) {
    console.error(
      `\nUso: npm run arte:derivar -- <arte> <tabelaOrigem> <tabelaDestino> <pasta> ` +
        `[--altura PX] [--qualidade N]\n` +
        `Artes:   ${TEMPLATES.join(" | ")}\n` +
        `Tabelas: ${TABELAS_PRECO.join(" | ")}\n\n` +
        `A pasta traz só as páginas que mudam, nomeadas pelo número da página: 03.pdf, 04.pdf...\n`,
    );
    process.exit(1);
  }

  const arte = arteBruta as TemplateId;
  const origem = origemBruta as TabelaPreco;
  const destino = destinoBruta as TabelaPreco;

  if (origem === destino) {
    console.error(`\nOrigem e destino são a mesma tabela (${origem}). Nada a derivar.\n`);
    process.exit(1);
  }

  validarRaster(altura, qualidade);
  await garantirGhostscript();

  const arquivoOrigem = arquivoDaTabela(arte, origem);
  try {
    await fs.access(arquivoOrigem);
  } catch {
    console.error(`\nArte de origem não encontrada: ${path.relative(process.cwd(), arquivoOrigem)}\n`);
    process.exit(1);
  }

  // Mapa "número da página (1-based)" -> arquivo da página nova.
  const trocas = new Map<number, string>();
  for (const nome of (await fs.readdir(pasta)).sort()) {
    if (!nome.toLowerCase().endsWith(".pdf")) continue;
    const n = Number.parseInt(path.basename(nome, path.extname(nome)), 10);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`\nArquivo "${nome}" não tem número de página. Use 03.pdf, 04.pdf...\n`);
      process.exit(1);
    }
    trocas.set(n, path.join(pasta, nome));
  }

  if (trocas.size === 0) {
    console.error(`\nNenhuma página em ${pasta}. Sem troca não há o que derivar.\n`);
    process.exit(1);
  }

  const base = await PDFDocument.load(await fs.readFile(arquivoOrigem));
  const total = base.getPageCount();

  for (const n of trocas.keys()) {
    if (n > total) {
      console.error(`\nA arte de ${origem} tem ${total} páginas; não existe página ${n}.\n`);
      process.exit(1);
    }
  }

  console.log(
    `\n\x1b[1m${arte}\x1b[0m — tabela ${origem} → \x1b[1m${destino}\x1b[0m, ` +
      `${total} página(s), trocando ${[...trocas.keys()].sort((a, b) => a - b).join(", ")}\n`,
  );

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "derivar-"));
  const doc = await PDFDocument.create();

  for (let n = 1; n <= total; n++) {
    const nova = trocas.get(n);

    if (!nova) {
      const [copiada] = await doc.copyPages(base, [n - 1]);
      doc.addPage(copiada);
      console.log(`  pág ${String(n).padStart(2)}  copiada de ${origem}`);
      continue;
    }

    const jpg = path.join(temp, `${n}.jpg`);
    await rasterizar(nova, jpg, altura, qualidade);
    const bytesJpg = await fs.readFile(jpg);
    const img = await doc.embedJpg(bytesJpg);
    const pg = doc.addPage([LARGURA_A4, ALTURA_A4]);
    pg.drawImage(img, { x: 0, y: 0, width: LARGURA_A4, height: ALTURA_A4 });

    console.log(
      `  pág ${String(n).padStart(2)}  \x1b[1mnova\x1b[0m de ${path.relative(process.cwd(), nova)}` +
        `  ${mb(bytesJpg.length)}  ${img.width}x${img.height}px`,
    );
  }

  const tamanhos = new Set(
    doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`),
  );
  if (tamanhos.size > 1) {
    console.warn(`\n  \x1b[33m! páginas com tamanhos diferentes: ${[...tamanhos].join(", ")}\x1b[0m`);
  }

  const arquivoFinal = arquivoDaTabela(arte, destino);
  await fs.writeFile(arquivoFinal, await doc.save());
  await fs.rm(temp, { recursive: true, force: true });

  const final = (await fs.stat(arquivoFinal)).size;
  const antes = (await fs.stat(arquivoOrigem)).size;
  console.log(`\n  ${origem} ${mb(antes)} → ${destino} ${mb(final)}`);
  console.log(`  \x1b[32m✓\x1b[0m assets/templates/${arte}.${destino}.pdf`);

  // O preço é PIXEL: nenhum teste consegue ler o valor que saiu na página. O que
  // dá para fazer é mostrar o que ela DEVERIA dizer, no momento em que entra no
  // repo, e deixar a conferência com quem está olhando.
  console.log(`\n  \x1b[1mConfira na página de Pacotes (tabela ${destino}):\x1b[0m`);
  for (const { nome, valor } of PACOTES[destino][arte]) {
    console.log(`    ${nome.padEnd(22)} R$ ${valor}`);
  }

  if (final > LIMITE_ALERTA) {
    console.warn(
      `\n  \x1b[33m! acima de ${mb(LIMITE_ALERTA)}: o PDF vai por anexo de e-mail.\x1b[0m`,
    );
  }
  console.log(`\n  Calibre em /admin/debug-template?template=${arte}&tabela=${destino}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
