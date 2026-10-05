import assert from "node:assert/strict";
import { test } from "node:test";
import { marcosAlcancados, PROFUNDIDADES, profundidadeVista, secaoVista, slugPergunta } from "./engajamento";

test("profundidade: o que já passou pela tela, de 0 a 100", () => {
  assert.equal(profundidadeVista(0, 800, 8000), 10);
  assert.equal(profundidadeVista(7200, 800, 8000), 100);
  assert.equal(profundidadeVista(9000, 800, 8000), 100, "rolagem elástica do iOS não passa de 100");
  assert.equal(profundidadeVista(0, 800, 0), 0);
});

test("marcos: só os que o valor alcançou, inclusive o exato", () => {
  assert.deepEqual(marcosAlcancados(10, PROFUNDIDADES), []);
  assert.deepEqual(marcosAlcancados(50, PROFUNDIDADES), [25, 50]);
  assert.deepEqual(marcosAlcancados(100, PROFUNDIDADES), [25, 50, 75, 90]);
});

test("seção vista: metade dela, ou meia tela quando ela é mais alta que a tela", () => {
  assert.equal(secaoVista(200, 400, 800), true);
  assert.equal(secaoVista(199, 400, 800), false);
  // Seção de 3000px numa tela de 800: meia tela (400) basta.
  assert.equal(secaoVista(400, 3000, 800), true);
  assert.equal(secaoVista(399, 3000, 800), false);
  assert.equal(secaoVista(0, 0, 800), false);
});

test("slug da pergunta: sem acento, sem pontuação, curto", () => {
  assert.equal(slugPergunta("Quanto custa?"), "quanto_custa");
  assert.equal(slugPergunta("Você atende a minha cidade?"), "voce_atende_a_minha_cidade");
  assert.equal(slugPergunta("A cobertura combina com o trabalho do fotógrafo e do videomaker?").length <= 50, true);
  assert.match(slugPergunta("Podemos contratar só os registros, sem postar no Instagram?"), /^[a-z0-9_]+$/);
});
