import assert from "node:assert/strict";
import { test } from "node:test";
import { linkPropostaWhatsApp, mensagemProposta, normalizarNumero } from "./whatsapp";

test("numero brasileiro ganha o DDI", () => {
  assert.equal(normalizarNumero("(19) 99999-8888"), "5519999998888");
  assert.equal(normalizarNumero("1933334444"), "551933334444");
});

test("numero que ja tem DDI nao ganha outro 55", () => {
  assert.equal(normalizarNumero("5519999998888"), "5519999998888");
  assert.equal(normalizarNumero("551933334444"), "551933334444");
});

test("numero vazio vira null", () => {
  assert.equal(normalizarNumero(""), null);
  assert.equal(normalizarNumero(null), null);
  assert.equal(normalizarNumero("abc"), null);
});

test("com numero, o link abre direto na conversa do lead (RF-13)", () => {
  const link = linkPropostaWhatsApp("(19) 99999-8888", "Ana", "https://x.test/p.pdf");
  assert.ok(link.startsWith("https://wa.me/5519999998888?text="));
});

test("sem numero, o link abre o seletor de conversas da Mel (RF-13)", () => {
  const link = linkPropostaWhatsApp(null, "Ana", "https://x.test/p.pdf");
  assert.ok(link.startsWith("https://wa.me/?text="));
});

test("a mensagem e a copy do PRD, com nome e link no lugar", () => {
  const msg = mensagemProposta("Ana", "https://x.test/p.pdf");
  assert.equal(
    msg,
    "Oi, Ana! ✨ Preparei sua proposta com todo carinho. Dá uma olhada aqui: https://x.test/p.pdf\n\nQualquer dúvida, me chama! 🤍",
  );
});

test("a URL do PDF sobrevive ao encode", () => {
  const url = "https://projeto.supabase.co/storage/v1/object/public/propostas/abc-123.pdf";
  const link = linkPropostaWhatsApp("19999998888", "Ana", url);
  const texto = decodeURIComponent(new URL(link).searchParams.get("text") ?? "");
  assert.ok(texto.includes(url));
});
