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

/**
 * Reduz a fonte ate o texto caber em maxLargura.
 *
 * A largura e linear no tamanho da fonte, entao a razao da o valor exato em um
 * passo so. NUNCA quebra linha: nome partido em duas destroi a arte, enquanto
 * 2pt a menos ninguem percebe. Piso de 6pt -- abaixo disso o problema e outro
 * (nome absurdo) e quem resolve e a Mel, editando no painel.
 */
export function ajustarTamanho(
  font: PDFFont,
  texto: string,
  tamanho: number,
  maxLargura?: number,
): number {
  if (!maxLargura || !texto) return tamanho;

  const largura = font.widthOfTextAtSize(texto, tamanho);
  if (largura <= maxLargura) return tamanho;

  const proporcional = (tamanho * maxLargura) / largura;
  // Arredonda para baixo em passos de 0,1pt para nao encostar no limite.
  return Math.max(6, Math.floor(proporcional * 10) / 10);
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
