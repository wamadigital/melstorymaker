import { rgb, type PDFFont } from "pdf-lib";
import type { TemplateConfig } from "./templates.config";

// Funcoes puras do posicionamento. Ficam fora do gerar.ts (que e "server-only")
// justamente para poderem ser testadas isoladamente -- e e aqui que mora o
// gotcha mais caro do projeto.

/** "#3A2E2A" -> rgb() do pdf-lib. Hex invalido vira preto, nunca excecao. */
export function hexParaRgb(hex: string) {
  const limpo = hex.replace("#", "").trim();
  const completo =
    limpo.length === 3
      ? limpo
          .split("")
          .map((c) => c + c)
          .join("")
      : limpo;

  if (completo.length !== 6 || !/^[0-9a-f]{6}$/i.test(completo)) return rgb(0, 0, 0);

  const n = Number.parseInt(completo, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Converte a coordenada do config para o sistema do pdf-lib.
 *
 * O pdf-lib tem origem no canto INFERIOR esquerdo; o Figma, no SUPERIOR. Alem
 * do flip vertical, o y do Figma e o topo da caixa de texto e o pdf-lib desenha
 * a partir da baseline -- dai subtrair o tamanho da fonte. A formula e a travada
 * no CLAUDE.md e serve como ponto de partida; o ajuste fino sai do grid da rota
 * de calibracao, e o resultado pode ser gravado com origemCoordenadas: "pdf".
 */
export function converterY(
  yConfig: number,
  alturaPagina: number,
  tamanhoFonte: number,
  origem: TemplateConfig["origemCoordenadas"],
  escala: number,
): number {
  if (origem === "pdf") return yConfig * escala;
  return alturaPagina - yConfig * escala - tamanhoFonte;
}

/** Fracao de maxLargura a partir da qual o texto ja "corre risco de estourar". */
const LIMIAR_RISCO = 0.9;

/**
 * Reduz a fonte ate o texto caber em maxLargura.
 *
 * A largura e linear no tamanho da fonte, entao a razao da o valor exato em um
 * passo so. NUNCA quebra linha: nome partido em duas destroi a arte, enquanto
 * 2pt a menos ninguem percebe. Piso de 6pt -- abaixo disso o problema e outro
 * (nome absurdo) e quem resolve e a Mel, editando no painel.
 *
 * `recuoPreventivo` (em pt) desconta ANTES de encostar no limite: passando de
 * 90% da largura util, o texto ja sai um degrau menor. Sem isso o unico
 * gatilho e o estouro real, e o resultado e um cabecalho colado na borda --
 * tecnicamente dentro, visualmente apertado. O ajuste proporcional continua
 * atras, como rede: se mesmo com o recuo nao couber, ele fecha a conta.
 */
export function ajustarTamanho(
  font: PDFFont,
  texto: string,
  tamanho: number,
  maxLargura?: number,
  recuoPreventivo?: number,
): number {
  if (!maxLargura || !texto) return tamanho;

  const largura = font.widthOfTextAtSize(texto, tamanho);

  // Cabe com folga suficiente: nada a fazer. Sem recuo declarado, "folga" e
  // simplesmente caber; com recuo, e caber abaixo do limiar de risco.
  const teto = recuoPreventivo ? maxLargura * LIMIAR_RISCO : maxLargura;
  if (largura <= teto) return tamanho;

  // Encaixe exato, quando de fato passou da largura util.
  const encaixado = largura > maxLargura ? (tamanho * maxLargura) / largura : tamanho;

  // O recuo entra DEPOIS do encaixe, nao antes. Antes ele nao teria efeito
  // nenhum: a largura e linear no tamanho, entao encolher e depois reescalar
  // para caber devolve exatamente o mesmo numero -- a conta se cancela. Vindo
  // depois, ele e o que garante a margem visual, em vez de um texto tecnicamente
  // dentro do limite mas colado na borda.
  const comRecuo = recuoPreventivo ? encaixado - recuoPreventivo : encaixado;

  // Arredonda para baixo em passos de 0,1pt para nao encostar no limite.
  return Math.max(6, Math.floor(comRecuo * 10) / 10);
}

/** x final conforme o alinhamento. Em "centro", o x do config e o centro do bloco. */
export function alinharX(
  xConfig: number,
  larguraTexto: number,
  alinhamento: "esquerda" | "centro" | "direita" | undefined,
): number {
  if (alinhamento === "centro") return xConfig - larguraTexto / 2;
  if (alinhamento === "direita") return xConfig - larguraTexto;
  return xConfig;
}
