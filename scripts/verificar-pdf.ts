/**
 * Smoke test do pipeline de PDF, sem depender de Supabase nem de rede.
 *
 *   npm run pdf:verificar
 *
 * Gera uma proposta por ARTE E POR TABELA DE PRECO com dados de exemplo, reabre
 * cada arquivo para provar que e um PDF valido e confere os limites do PRD (10s
 * de geracao, 5MB de arquivo). Os PDFs ficam em .pdf-verificacao/ para inspecao
 * visual.
 *
 * Sao 5 cenarios por tabela, nao 4: aniversario rende duas artes conforme a
 * idade, e a infantil precisa ser aberta de verdade aqui. Os testes unitarios
 * cobrem `resolverTemplateId` e `resolverTabelaPreco`, mas so este script prova
 * que cada ARQUIVO existe, abre e recebe o texto no lugar certo.
 *
 * Cada tabela tem seu proprio jogo de artes (o preco esta desenhado nelas), e
 * por isso o cruzamento e obrigatorio: uma tabela nova sem arte publicada deixa
 * este script vermelho ate as cinco entrarem, de proposito.
 *
 * A flag --conditions=react-server (ver package.json) faz o pacote "server-only"
 * resolver para um modulo vazio, permitindo importar o gerar.ts fora do Next.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS, TEMPLATES, type Categoria, type Respostas } from "@/lib/form/types";
import { ArteFaltandoError, gerarProposta } from "@/lib/pdf/gerar";
import { TABELAS_PRECO, resolverTabelaPreco, type TabelaPreco } from "@/lib/pdf/precos";
import { arquivoBase } from "@/lib/pdf/templates.config";

const AMOSTRAS: Record<Categoria, Respostas> = {
  debutante: {
    // Nome longo de proposito: exercita o auto-shrink do maxLargura.
    nome: "Lúcia Fernandes de Albuquerque",
    debutante: "Maria Eduarda Albuquerque do Nascimento",
    data: "2026-03-14",
    horario: "19:30",
    local: "Espaço Villa Bisutti",
    making_of: "Sim",
    local_making_of: "Hotel Fasano",
    entrega: "Em tempo real",
    contato_email: "lead@example.com",
    contato_whatsapp: "(19) 99999-8888",
  },
  aniversario: {
    nome: "Lúcia",
    aniversariante: "João",
    // 30 anos: resolve para a arte ADULTA. A infantil vem em CENARIOS, abaixo.
    idade: "30",
    data: "2026-12-01",
    // Hora cheia: deve sair "20h", nao "20h00".
    horario: "20:00",
    local: "Casa da vovó",
    entrega: "Em até 1 semana",
    contato_email: "lead@example.com",
    contato_whatsapp: "(19) 99999-8888",
  },
  casamento: {
    // Caixa alta de proposito: o lead digita assim no celular e a capa tem
    // de sair "Olá, Lúcia Helena!", nunca "Olá, LÚCIA HELENA!".
    nome: "LÚCIA HELENA DE SOUZA",
    noivos: "Ana & João",
    data: "2026-08-31",
    horario: "16:00",
    local_cerimonia: "Igreja Nossa Senhora do Brasil",
    local_festa: "Espaço Villa Bisutti",
    // making_of = "Nao": local_making_of nao deve nem existir nas respostas.
    making_of: "Não",
    entrega: "Em tempo real",
    contato_email: "lead@example.com",
    contato_whatsapp: "(11) 98888-7777",
  },
  corporativo: {
    nome: "Lúcia",
    empresa: "Acme Tecnologia Ltda",
    tipo_evento: "Confraternização de fim de ano",
    data: "2026-05-20",
    horario: "09:00",
    local: "Centro de Convenções Rebouças",
    contato_email: "contato@acme.com",
    contato_whatsapp: "(11) 3333-4444",
  },
};

/**
 * Um cenario por ARTE. As 4 categorias cobrem 4 delas; a quinta e o
 * aniversario infantil, que so aparece quando a idade e <= 14.
 */
const BASES: { rotulo: string; categoria: Categoria; respostas: Respostas }[] = [
  ...CATEGORIAS.map((categoria) => ({
    rotulo: categoria,
    categoria,
    respostas: AMOSTRAS[categoria],
  })),
  {
    rotulo: "aniversario (8 anos)",
    categoria: "aniversario",
    respostas: { ...AMOSTRAS.aniversario, aniversariante: "Bento", idade: "8" },
  },
];

/**
 * Uma data de evento por tabela. Nao basta escrever o ano: o proprio resolvedor
 * confere abaixo que cada data cai mesmo na tabela pretendida, senao o script
 * poderia gerar duas vezes a mesma arte achando que cobriu as duas.
 */
const DATA_POR_TABELA: Record<TabelaPreco, string> = {
  "2026": "2026-08-31",
  // 1º de janeiro de proposito: e o dia em que a tabela vira, e onde um bug de
  // fuso horario apareceria.
  "2027": "2027-01-01",
};

/** Cruzamento arte x tabela: e ele que prova que os DOIS jogos de PDF existem. */
const CENARIOS = TABELAS_PRECO.flatMap((tabela) =>
  BASES.map((base) => ({
    ...base,
    tabela,
    rotulo: `${base.rotulo} · ${tabela}`,
    respostas: { ...base.respostas, data: DATA_POR_TABELA[tabela] } satisfies Respostas as Respostas,
  })),
);

const LIMITE_MS = 10_000;
const LIMITE_BYTES = 5 * 1024 * 1024;

async function main() {
  const saida = path.join(process.cwd(), ".pdf-verificacao");
  await fs.mkdir(saida, { recursive: true });

  let falhas = 0;

  const artesGeradas = new Set<string>();
  const artesAusentes = new Set<string>();

  // As datas de exemplo precisam cair mesmo na tabela que dizem cobrir; sem
  // isto, mudar uma vigencia faria o script gerar a mesma arte duas vezes e
  // continuar verde, sem cobrir a outra tabela.
  for (const tabela of TABELAS_PRECO) {
    const resolvida = resolverTabelaPreco(DATA_POR_TABELA[tabela]);
    if (resolvida !== tabela) {
      console.error(
        `✗ data de exemplo da tabela ${tabela} (${DATA_POR_TABELA[tabela]}) ` +
          `resolve para ${resolvida ?? "nenhuma"}. Ajuste DATA_POR_TABELA.`,
      );
      falhas++;
    }
  }

  for (const { rotulo, categoria, respostas, tabela } of CENARIOS) {
    const faltando = passosVisiveis(categoria, respostas)
      .filter((p) => p.obrigatorio && !respostas[p.id])
      .map((p) => p.id);
    if (faltando.length) {
      console.error(`✗ ${rotulo}: amostra incompleta, faltam ${faltando.join(", ")}`);
      falhas++;
    }

    const t0 = performance.now();
    let r;
    try {
      r = await gerarProposta(categoria, respostas);
    } catch (e) {
      // Arte ausente e o estado esperado enquanto uma tabela nova nao foi
      // publicada. Vale como falha, mas nao derruba o script: interessa ver a
      // lista inteira do que falta de uma vez.
      if (e instanceof ArteFaltandoError) {
        artesAusentes.add(arquivoBase(e.templateId, e.tabela));
        console.error(`✗ ${rotulo.padEnd(28)} arte não publicada`);
        falhas++;
        continue;
      }
      throw e;
    }
    const ms = Math.round(performance.now() - t0);
    artesGeradas.add(`${r.templateId}.${r.tabelaPreco}`);

    if (r.tabelaPreco !== tabela) {
      console.error(`✗ ${rotulo}: esperava tabela ${tabela}, veio ${r.tabelaPreco}`);
      falhas++;
    }

    // Nomear pela ARTE E TABELA: dois cenarios de aniversario, ou a mesma arte
    // em duas tabelas, nao podem se sobrescrever.
    await fs.writeFile(path.join(saida, `${r.templateId}.${r.tabelaPreco}.pdf`), r.bytes);

    // Reabrir prova que a saida e um PDF valido, nao bytes soltos.
    const relido = await PDFDocument.load(r.bytes);
    const kb = (r.bytes.length / 1024).toFixed(0);

    console.log(
      `✓ ${rotulo.padEnd(28)} → ${`${r.templateId}.${r.tabelaPreco}`.padEnd(25)} ` +
        `${String(relido.getPageCount()).padStart(2)} pág  ` +
        `${kb.padStart(4)}kB  ${String(ms).padStart(4)}ms` +
        `${r.usouPlaceholder ? "  [placeholder]" : ""}` +
        `${r.usouFallbackDeFonte ? "  [fonte fallback]" : ""}`,
    );

    if (ms > LIMITE_MS) {
      console.error(`✗ ${rotulo}: geração acima do limite de 10s do PRD`);
      falhas++;
    }
    if (r.bytes.length > LIMITE_BYTES) {
      console.error(`✗ ${rotulo}: PDF acima do limite de 5MB do PRD`);
      falhas++;
    }
  }

  // Trava contra regressao: arte ou TABELA nova sem cenario passaria
  // despercebida aqui. O cruzamento e o contrato -- toda arte tem de existir em
  // toda tabela, senao ha um ano em que alguma categoria nao tem proposta.
  const semCenario = TEMPLATES.flatMap((t) => TABELAS_PRECO.map((tp) => `${t}.${tp}`)).filter(
    (combo) => !artesGeradas.has(combo),
  );
  if (semCenario.length) {
    console.error(`\n✗ combinações arte × tabela sem cenário: ${semCenario.join(", ")}`);
    falhas++;
  }

  if (artesAusentes.size) {
    console.error(`\n✗ artes não publicadas (${artesAusentes.size}):`);
    for (const arquivo of [...artesAusentes].sort()) console.error(`    ${arquivo}`);
    console.error(
      `\n  Exporte as páginas do Figma e rode, para cada uma:\n` +
        `    npm run arte:preparar -- <arte> <tabela> <pasta>\n`,
    );
  }

  // --grid gera tambem os PDFs de calibracao, os mesmos que a rota
  // /admin/debug-template devolve -- util para conferir sem precisar de sessao.
  if (process.argv.includes("--grid")) {
    const { gerarPdfCalibracao } = await import("@/lib/pdf/grid");
    // Itera sobre as ARTES x TABELAS: aniversario tem duas artes, e cada arte
    // tem um PDF base por tabela -- calibrar uma nao prova nada sobre a outra.
    for (const template of TEMPLATES) {
      for (const tabela of TABELAS_PRECO) {
        if (!artesGeradas.has(`${template}.${tabela}`)) continue;
        await fs.writeFile(
          path.join(saida, `grid-${template}-${tabela}.pdf`),
          await gerarPdfCalibracao(template, tabela),
        );
        console.log(`✓ grid-${template}-${tabela}.pdf`);
      }
    }
  }

  console.log(`\nPDFs em ${path.relative(process.cwd(), saida)}/`);
  if (falhas) {
    console.error(`\n${falhas} verificação(ões) falharam.`);
    process.exit(1);
  }
}

// Sem top-level await: o projeto nao e "type": "module", entao o tsx transpila
// este arquivo para CJS, onde TLA nao existe.
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
