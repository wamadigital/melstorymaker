/**
 * Smoke test do pipeline de PDF, sem depender de Supabase nem de rede.
 *
 *   npm run pdf:verificar
 *
 * Gera uma proposta por ARTE com dados de exemplo, reabre cada arquivo para
 * provar que e um PDF valido e confere os limites do PRD (10s de geracao, 5MB
 * de arquivo). Os PDFs ficam em .pdf-verificacao/ para inspecao visual.
 *
 * Sao 5 cenarios, nao 4: aniversario rende duas artes conforme a idade, e a
 * infantil precisa ser aberta de verdade aqui. Os testes unitarios cobrem
 * `resolverTemplateId`, mas so este script prova que o arquivo
 * aniversario_infantil.pdf existe, abre e recebe o texto no lugar certo.
 *
 * A flag --conditions=react-server (ver package.json) faz o pacote "server-only"
 * resolver para um modulo vazio, permitindo importar o gerar.ts fora do Next.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { passosVisiveis } from "@/lib/form/engine";
import { CATEGORIAS, TEMPLATES, type Categoria, type Respostas } from "@/lib/form/types";
import { gerarProposta } from "@/lib/pdf/gerar";

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
const CENARIOS: { rotulo: string; categoria: Categoria; respostas: Respostas }[] = [
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

const LIMITE_MS = 10_000;
const LIMITE_BYTES = 5 * 1024 * 1024;

async function main() {
  const saida = path.join(process.cwd(), ".pdf-verificacao");
  await fs.mkdir(saida, { recursive: true });

  let falhas = 0;

  const artesGeradas = new Set<string>();

  for (const { rotulo, categoria, respostas } of CENARIOS) {
    const faltando = passosVisiveis(categoria, respostas)
      .filter((p) => p.obrigatorio && !respostas[p.id])
      .map((p) => p.id);
    if (faltando.length) {
      console.error(`✗ ${rotulo}: amostra incompleta, faltam ${faltando.join(", ")}`);
      falhas++;
    }

    const t0 = performance.now();
    const r = await gerarProposta(categoria, respostas);
    const ms = Math.round(performance.now() - t0);
    artesGeradas.add(r.templateId);

    // Nomear pela ARTE: dois cenarios de aniversario nao podem se sobrescrever.
    await fs.writeFile(path.join(saida, `${r.templateId}.pdf`), r.bytes);

    // Reabrir prova que a saida e um PDF valido, nao bytes soltos.
    const relido = await PDFDocument.load(r.bytes);
    const kb = (r.bytes.length / 1024).toFixed(0);

    console.log(
      `✓ ${rotulo.padEnd(21)} → ${r.templateId.padEnd(20)} ` +
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

  // Trava contra regressao: se alguem criar uma arte nova e esquecer o cenario,
  // ela passaria despercebida aqui.
  const semCenario = TEMPLATES.filter((t) => !artesGeradas.has(t));
  if (semCenario.length) {
    console.error(`\n✗ artes sem cenário neste script: ${semCenario.join(", ")}`);
    falhas++;
  }

  // --grid gera tambem os PDFs de calibracao, os mesmos que a rota
  // /admin/debug-template devolve -- util para conferir sem precisar de sessao.
  if (process.argv.includes("--grid")) {
    const { gerarPdfCalibracao } = await import("@/lib/pdf/grid");
    // Itera sobre as ARTES, nao sobre as categorias: aniversario tem duas.
    for (const template of TEMPLATES) {
      await fs.writeFile(path.join(saida, `grid-${template}.pdf`), await gerarPdfCalibracao(template));
      console.log(`✓ grid-${template}.pdf`);
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
