import assert from "node:assert/strict";
import { test } from "node:test";
import { validarCopias } from "./copias";
import { MAX_COPIAS_POR_LOTE } from "./eventos";

const HOST = "melstorymaker.com.br";
const ok = (extra: Record<string, unknown> = {}) => ({
  nome: "CliqueCTA",
  id: "CliqueCTA.6f1c2b9e-1111-4c4c-9a9a-123456789abc",
  dados: { pagina: "casamento", posicao: "hero" },
  url: "https://melstorymaker.com.br/casamento?fbclid=abc&utm_source=instagram",
  ...extra,
});

test("cópia válida passa inteira, com a URL do próprio site", () => {
  const [c] = validarCopias({ eventos: [ok()] }, HOST)!;
  assert.equal(c.nome, "CliqueCTA");
  assert.deepEqual(c.dados, { pagina: "casamento", posicao: "hero" });
  assert.equal(c.url, "https://melstorymaker.com.br/casamento?fbclid=abc&utm_source=instagram");
});

test("Lead e SubmitApplication nunca entram pela rota pública", () => {
  for (const nome of ["Lead", "SubmitApplication", "Purchase", "VirouCliente", "__proto__", "toString"]) {
    assert.deepEqual(validarCopias({ eventos: [ok({ nome, dados: {} })] }, HOST), [], nome);
  }
});

test("parâmetro fora da lista do evento, ou valor torto, derruba o evento", () => {
  assert.deepEqual(validarCopias({ eventos: [ok({ dados: { pagina: "casamento", email: "x" } })] }, HOST), []);
  assert.deepEqual(validarCopias({ eventos: [ok({ dados: { posicao: "<script>" } })] }, HOST), []);
  assert.deepEqual(validarCopias({ eventos: [ok({ dados: { posicao: "a".repeat(61) } })] }, HOST), []);
  assert.deepEqual(validarCopias({ eventos: [ok({ dados: { posicao: 1 } })] }, HOST), []);
  assert.deepEqual(validarCopias({ eventos: [ok({ dados: "x" })] }, HOST), []);
});

test("id fora do formato derruba o evento; id repetido no lote entra uma vez", () => {
  assert.deepEqual(validarCopias({ eventos: [ok({ id: "curto" })] }, HOST), []);
  assert.deepEqual(validarCopias({ eventos: [ok({ id: "x".repeat(101) })] }, HOST), []);
  assert.deepEqual(validarCopias({ eventos: [ok({ id: "Clique CTA com espaço" })] }, HOST), []);
  assert.equal(validarCopias({ eventos: [ok(), ok()] }, HOST)!.length, 1);
});

test("URL de outro site, ou não http, fica de fora (o evento continua)", () => {
  for (const url of ["https://outro.com/casamento", "javascript:alert(1)", "https://melstorymaker.com.br.outro.com/", 42]) {
    const [c] = validarCopias({ eventos: [ok({ url })] }, HOST)!;
    assert.equal(c.url, undefined, String(url));
  }
});

test("corpo fora do formato, vazio ou acima do teto devolve null", () => {
  assert.equal(validarCopias(null, HOST), null);
  assert.equal(validarCopias([], HOST), null);
  assert.equal(validarCopias({ eventos: [] }, HOST), null);
  assert.equal(validarCopias({ eventos: "x" }, HOST), null);
  const muitos = Array.from({ length: MAX_COPIAS_POR_LOTE + 1 }, (_, i) => ok({ id: `CliqueCTA.${String(i).padStart(8, "0")}` }));
  assert.equal(validarCopias({ eventos: muitos }, HOST), null);
});

test("PageView vai sem parâmetro nenhum", () => {
  const [c] = validarCopias({ eventos: [{ nome: "PageView", id: "PageView.mfx1a2.b3c4d5e6", dados: {} }] }, HOST)!;
  assert.deepEqual(c.dados, {});
  assert.deepEqual(validarCopias({ eventos: [{ nome: "PageView", id: "PageView.mfx1a2.b3c4d5e6", dados: { a: "b" } }] }, HOST), []);
});

test("todo evento que o navegador dispara com cópia está na lista da rota", async () => {
  // Evento novo na LP ou no formulário sem entrada em COPIAVEIS: o Pixel recebe,
  // a rota descarta a cópia em silêncio, e quem tem bloqueador some da leitura.
  const { COPIAVEIS, EVENTO, EVENTO_FORMULARIO, EVENTO_LP } = await import("./eventos");
  for (const nome of [EVENTO.pagina, EVENTO.conteudo, EVENTO.contato, ...Object.values(EVENTO_LP), ...Object.values(EVENTO_FORMULARIO)]) {
    assert.ok(Object.hasOwn(COPIAVEIS, nome), `${nome} sem cópia pelo servidor`);
  }
  // E os que têm cópia própria nas rotas do lead nunca entram por aqui.
  assert.equal(Object.hasOwn(COPIAVEIS, EVENTO.lead), false);
  assert.equal(Object.hasOwn(COPIAVEIS, EVENTO.submit), false);
});

test("urlDoSite: só http(s) do próprio host e de tamanho razoável", async () => {
  const { urlDoSite } = await import("./copias");
  assert.equal(urlDoSite("https://melstorymaker.com.br/casamento?x=1", HOST), "https://melstorymaker.com.br/casamento?x=1");
  assert.equal(urlDoSite("https://concorrente.example/promo?email=a%40b.com", HOST), undefined);
  assert.equal(urlDoSite(`https://melstorymaker.com.br/?q=${"a".repeat(2000)}`, HOST), undefined);
  assert.equal(urlDoSite(undefined, HOST), undefined);
});
