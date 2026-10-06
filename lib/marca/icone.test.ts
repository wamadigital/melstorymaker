import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import AppleIcon, { size as tamanhoApple } from "@/app/apple-icon";
import Icon, { size as tamanhoFavicon } from "@/app/icon";
import { ICONE_MEL } from "./icone";

/**
 * Largura, altura e o PRIMEIRO pixel (canto superior esquerdo) de um PNG, sem
 * biblioteca: o tamanho esta no IHDR, e o primeiro pixel da primeira linha sai
 * cru de qualquer filtro do PNG (nao ha vizinho a esquerda nem linha acima).
 */
function lerPng(png: Buffer) {
  const largura = png.readUInt32BE(16);
  const altura = png.readUInt32BE(20);
  const canais = png[25] === 6 ? 4 : 3; // 6 = RGBA, 2 = RGB
  const idat: Buffer[] = [];
  for (let i = 8; i < png.length; ) {
    const tamanho = png.readUInt32BE(i);
    if (png.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(png.subarray(i + 8, i + 8 + tamanho));
    i += 12 + tamanho;
  }
  // O byte 0 da linha e o tipo de filtro; o pixel vem logo depois.
  const pixel = [...inflateSync(Buffer.concat(idat)).subarray(1, 1 + canais)];
  return { largura, altura, pixel };
}

const hex = (cor: string) => [1, 3, 5].map((i) => Number.parseInt(cor.slice(i, i + 2), 16));

test("favicon e ícone do iPhone saem do mesmo desenho, cada um no seu tamanho", async () => {
  assert.deepEqual(tamanhoApple, { width: 180, height: 180 }, "180 px é o tamanho que o iPhone usa");

  for (const [nome, gerar, tamanho] of [
    ["apple-icon", AppleIcon, tamanhoApple],
    ["favicon", Icon, tamanhoFavicon],
  ] as const) {
    const { largura, altura, pixel } = lerPng(Buffer.from(await gerar().arrayBuffer()));
    assert.equal(largura, tamanho.width, `${nome}: largura`);
    assert.equal(altura, tamanho.height, `${nome}: altura`);
    // Quadrado cheio: o canto e o escuro da marca, opaco. Canto arredondado ou
    // transparente viraria preto na tela de inicio -- quem arredonda e o iOS.
    assert.deepEqual(pixel.slice(0, 3), hex(ICONE_MEL.fundo), `${nome}: o canto não é o escuro da marca`);
    if (pixel.length === 4) assert.equal(pixel[3], 255, `${nome}: o canto é transparente`);
  }
});
