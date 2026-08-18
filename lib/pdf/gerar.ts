import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { passoPorId, resolverTemplateId } from "@/lib/form/engine";
import type { Categoria, Respostas, TemplateId } from "@/lib/form/types";
import { FORMATADORES } from "./formatadores";
import { carregarFontes, textoSeguro } from "./fontes";
import { ajustarTamanho, alinharX, converterY, hexParaRgb } from "./geometria";
import { fontesUsadas, templates, type CampoTemplate, type TemplateConfig } from "./templates.config";

export const DIR_TEMPLATES = path.join(process.cwd(), "assets", "templates");

export type ResultadoPdf = {
  bytes: Uint8Array;
  /** Arte efetivamente usada. O painel mostra para a Mel conferir. */
  templateId: TemplateId;
  rotuloTemplate: string;
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

function desenharCampo(
  page: PDFPage,
  campo: CampoTemplate,
  config: TemplateConfig,
  font: PDFFont,
  bruto: string,
) {
  const formatado = campo.formato ? FORMATADORES[campo.formato](bruto) : bruto;
  const texto = textoSeguro(font, formatado.trim());
  if (!texto) return;

  const { height } = page.getSize();
  const escala = config.escala;

  const tamanhoBase = campo.tamanho * escala;
  const maxLargura = campo.maxLargura ? campo.maxLargura * escala : undefined;
  const tamanho = ajustarTamanho(font, texto, tamanhoBase, maxLargura);

  page.drawText(texto, {
    x: alinharX(campo.x * escala, font.widthOfTextAtSize(texto, tamanho), campo.alinhamento),
    y: converterY(campo.y, height, tamanho, config.origemCoordenadas, escala),
    size: tamanho,
    font,
    color: hexParaRgb(campo.cor),
  });
}

/**
 * Caminho do PDF base. Prefere a arte real e cai no placeholder gerado por
 * script enquanto o export do Figma nao chega, para o pipeline nunca travar.
 */
export async function caminhoTemplate(
  template: TemplateId,
): Promise<{ caminho: string; placeholder: boolean }> {
  const real = path.join(process.cwd(), templates[template].basePdf);
  try {
    await fs.access(real);
    return { caminho: real, placeholder: false };
  } catch {
    const provisorio = path.join(DIR_TEMPLATES, `${template}.placeholder.pdf`);
    try {
      await fs.access(provisorio);
      return { caminho: provisorio, placeholder: true };
    } catch {
      throw new Error(
        `Arte "${template}" nao encontrada. Coloque o PDF em ` +
          `${templates[template].basePdf} ou rode \`npm run templates:placeholder\`.`,
      );
    }
  }
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
  const faltando = config.campos
    .filter((c) => !c.opcional && !resolver(c.fonte, { respostas }).trim())
    .map((c) => rotuloCampo(categoria, c.chave));

  if (faltando.length > 0) {
    throw new CamposFaltandoError([...new Set(faltando)]);
  }
  const { caminho, placeholder } = await caminhoTemplate(templateId);

  const pdfDoc = await PDFDocument.load(await fs.readFile(caminho));
  const fontes = await carregarFontes(pdfDoc, fontesUsadas(templateId));
  const paginas = pdfDoc.getPages();
  const contexto = { respostas };

  for (const campo of config.campos) {
    const page = paginas[campo.pagina];
    if (!page) {
      console.warn(
        `[pdf] campo "${campo.chave}" aponta para a pagina ${campo.pagina}, ` +
          `mas ${templateId} tem ${paginas.length}. Campo ignorado.`,
      );
      continue;
    }

    const bruto = resolver(campo.fonte, contexto);
    // Obrigatorio vazio ja foi barrado acima; chegar aqui vazio so acontece
    // com campo marcado como opcional.
    if (!bruto) continue;

    desenharCampo(page, campo, config, fontes.obter(campo.font), bruto);
  }

  return {
    bytes: await pdfDoc.save(),
    templateId,
    rotuloTemplate: config.rotulo,
    usouPlaceholder: placeholder,
    usouFallbackDeFonte: fontes.usouFallback,
  };
}
