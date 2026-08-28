import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { passoPorId, resolverTemplateId } from "@/lib/form/engine";
import type { Categoria, Respostas, TemplateId } from "@/lib/form/types";
import { FORMATADORES } from "./formatadores";
import { carregarFontes, textoSeguro } from "./fontes";
import { ajustarTamanho, alinharX, converterY, hexParaRgb } from "./geometria";
import {
  TABELA_BASE,
  resolverTabelaPreco,
  rotuloTabela,
  type TabelaPreco,
} from "./precos";
import {
  arquivoBase,
  chavesDoCampo,
  fontesUsadas,
  templates,
  type CampoTemplate,
  type TemplateConfig,
} from "./templates.config";

export const DIR_TEMPLATES = path.join(process.cwd(), "assets", "templates");

export type ResultadoPdf = {
  bytes: Uint8Array;
  /** Arte efetivamente usada. O painel mostra para a Mel conferir. */
  templateId: TemplateId;
  rotuloTemplate: string;
  /**
   * Tabela de preco da arte aberta, escolhida pelo ANO DO EVENTO. Vai para o
   * painel: a Mel precisa poder conferir que a proposta de um evento de 2027
   * saiu com os precos de 2027, e nao com os do ano passado.
   */
  tabelaPreco: TabelaPreco;
  /** true quando a arte real ainda nao esta no repo (rodou sobre placeholder). */
  usouPlaceholder: boolean;
  /** true quando alguma fonte da marca faltou e caiu no fallback. */
  usouFallbackDeFonte: boolean;
};

/**
 * Erro de dado faltando, distinto de erro tecnico.
 *
 * A rota converte isto em 422 com a lista de campos, para a Mel preencher no
 * painel e tentar de novo -- em vez de um 500 generico que nao diz o que fazer.
 */
export class CamposFaltandoError extends Error {
  constructor(readonly campos: string[]) {
    super(`Faltam respostas para gerar a proposta: ${campos.join(", ")}`);
    this.name = "CamposFaltandoError";
  }
}

/**
 * A arte daquela combinacao de (arte, tabela de preco) nao esta no repo.
 *
 * Distinto de `CamposFaltandoError`: nao ha nada que a Mel possa digitar para
 * resolver -- falta um ASSET, e quem publica asset e quem mexe no repo. A rota
 * devolve texto humano e guarda o caminho do arquivo so no log do servidor.
 *
 * Existir e melhor do que a alternativa silenciosa: sem isto, um evento de 2027
 * cairia na arte de 2026 e a Mel enviaria a proposta com o preco defasado sem
 * nunca perceber.
 */
export class ArteFaltandoError extends Error {
  constructor(
    readonly templateId: TemplateId,
    readonly tabela: TabelaPreco,
  ) {
    super(
      `Arte "${templateId}" da ${rotuloTabela(tabela)} nao encontrada. ` +
        `Publique o PDF em ${arquivoBase(templateId, tabela)}.`,
    );
    this.name = "ArteFaltandoError";
  }
}

/** Rotulo legivel do campo, tirado da propria pergunta do arvore.json. */
function rotuloCampo(categoria: Categoria, chave: string): string {
  return passoPorId(categoria, chave)?.pergunta ?? chave;
}

/** Resolve "respostas.nome" no contexto do lead. */
function resolver(caminho: string, contexto: Record<string, unknown>): string {
  const valor = caminho.split(".").reduce<unknown>((acc, chave) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[chave];
    return undefined;
  }, contexto);

  return valor == null ? "" : String(valor);
}

/**
 * Texto final do campo, seja ele simples ou composto.
 *
 * Composto existe porque a arte junta duas respostas numa linha so
 * ("{noivos} | {data}"), com a data ja por extenso no meio. Formatar depois de
 * concatenar seria impossivel: nao da para saber onde a data comeca.
 */
export function textoDoCampo(campo: CampoTemplate, respostas: Respostas): string {
  if (campo.composicao) {
    return campo.composicao.replace(/\{(\w+)\}/g, (_, chave: string) => {
      const bruto = respostas[chave] ?? "";
      const formatador = campo.formatos?.[chave];
      return formatador ? FORMATADORES[formatador](bruto) : bruto;
    });
  }

  const bruto = resolver(campo.fonte ?? "", { respostas });
  return campo.formato ? FORMATADORES[campo.formato](bruto) : bruto;
}

function desenharCampo(
  page: PDFPage,
  campo: CampoTemplate,
  config: TemplateConfig,
  font: PDFFont,
  formatado: string,
) {
  // Caixa alta ANTES do textoSeguro: e a forma final que vai medida e desenhada.
  const bruto = campo.caixaAlta ? formatado.toLocaleUpperCase("pt-BR") : formatado;
  const texto = textoSeguro(font, bruto.trim());
  if (!texto) return;

  const { height } = page.getSize();
  const escala = config.escala;

  const tamanhoBase = campo.tamanho * escala;
  const maxLargura = campo.maxLargura ? campo.maxLargura * escala : undefined;
  const tamanho = ajustarTamanho(font, texto, tamanhoBase, maxLargura, campo.recuoPreventivo);

  page.drawText(texto, {
    x: alinharX(campo.x * escala, font.widthOfTextAtSize(texto, tamanho), campo.alinhamento),
    y: converterY(campo.y, height, tamanho, config.origemCoordenadas, escala),
    size: tamanho,
    font,
    color: hexParaRgb(campo.cor),
  });
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Caminho do PDF base de uma arte NUMA tabela de preco.
 *
 * O placeholder segue valendo como rede de bootstrap, mas SO para a tabela
 * base: ele nao tem preco nenhum desenhado, entao nao consegue representar uma
 * tabela nova. Cair nele para 2027 entregaria uma proposta sem preco -- e a
 * regra do projeto e que PDF nenhum e melhor do que PDF com buraco.
 */
export async function caminhoTemplate(
  template: TemplateId,
  tabela: TabelaPreco,
): Promise<{ caminho: string; placeholder: boolean }> {
  const real = path.join(process.cwd(), arquivoBase(template, tabela));
  if (await existe(real)) return { caminho: real, placeholder: false };

  const provisorio = path.join(DIR_TEMPLATES, `${template}.placeholder.pdf`);
  if (tabela === TABELA_BASE && (await existe(provisorio))) {
    return { caminho: provisorio, placeholder: true };
  }

  throw new ArteFaltandoError(template, tabela);
}

/** Aplica os campos dinamicos sobre a arte da categoria. */
export async function gerarProposta(
  categoria: Categoria,
  respostas: Respostas,
): Promise<ResultadoPdf> {
  // A arte sai das RESPOSTAS, nao so da categoria: aniversario resolve entre
  // infantil e adulto conforme a idade.
  const templateId = resolverTemplateId(categoria, respostas);

  // Sem idade nao da para saber qual arte usar. Chutar produziria uma proposta
  // infantil para um aniversario de 40 anos, e a Mel so veria depois de enviar.
  if (!templateId) {
    throw new CamposFaltandoError([rotuloCampo(categoria, "idade")]);
  }

  const config = templates[templateId];

  // Campo obrigatorio vazio nao pode virar espaco em branco na arte: e assim
  // que sai uma proposta sem o nome dos noivos. Junta TODOS os faltantes antes
  // de reclamar, para a Mel resolver de uma vez em vez de um por vez.
  // Num campo composto, faltar UMA das chaves ja invalida a linha inteira:
  // "Ana & João | " com a data vazia e pior do que nao gerar.
  const faltando = config.campos
    .filter((c) => !c.opcional)
    .flatMap((c) => chavesDoCampo(c).filter((k) => !(respostas[k] ?? "").trim()))
    .map((k) => rotuloCampo(categoria, k));

  if (faltando.length > 0) {
    throw new CamposFaltandoError([...new Set(faltando)]);
  }

  // A TABELA DE PRECO sai do ANO DO EVENTO, nao da data em que o lead
  // preencheu: quem marca uma festa de 2027 contrata pelo preco de 2027, mesmo
  // tendo preenchido o formulario em 2026. Como o preco esta desenhado na arte,
  // isto decide QUAL PDF base abrir -- ver precos.ts.
  //
  // Data vazia ja foi barrada acima (as cinco capas compoem "{data}"); chegar
  // aqui sem tabela significa data fora do formato ISO, e chutar 2026 seria
  // exatamente o erro caro que esta funcao existe para evitar.
  const tabela = resolverTabelaPreco(respostas.data ?? "");
  if (!tabela) {
    throw new CamposFaltandoError([rotuloCampo(categoria, "data")]);
  }

  const { caminho, placeholder } = await caminhoTemplate(templateId, tabela);

  const pdfDoc = await PDFDocument.load(await fs.readFile(caminho));
  const fontes = await carregarFontes(pdfDoc, fontesUsadas(templateId));
  const paginas = pdfDoc.getPages();

  for (const campo of config.campos) {
    const page = paginas[campo.pagina];
    if (!page) {
      console.warn(
        `[pdf] campo "${campo.chave}" aponta para a pagina ${campo.pagina}, ` +
          `mas ${templateId} tem ${paginas.length}. Campo ignorado.`,
      );
      continue;
    }

    const texto = textoDoCampo(campo, respostas);
    // Obrigatorio vazio ja foi barrado acima; chegar aqui vazio so acontece
    // com campo marcado como opcional.
    if (!texto.trim()) continue;

    desenharCampo(page, campo, config, fontes.obter(campo.font), texto);
  }

  return {
    bytes: await pdfDoc.save(),
    templateId,
    rotuloTemplate: config.rotulo,
    tabelaPreco: tabela,
    usouPlaceholder: placeholder,
    usouFallbackDeFonte: fontes.usouFallback,
  };
}
