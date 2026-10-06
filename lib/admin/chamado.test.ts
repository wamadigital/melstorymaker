import assert from "node:assert/strict";
import { test } from "node:test";
import { rotuloCaixaChamado } from "./chamado";

test("desmarcada, a caixa diz o que marcar", () => {
  assert.equal(rotuloCaixaChamado(false, null), "Marcar como já chamado no WhatsApp");
  // Carimbo velho no banco nao conta: quem manda e a caixa.
  assert.equal(rotuloCaixaChamado(false, "2026-10-05T17:30:00Z"), "Marcar como já chamado no WhatsApp");
});

test("marcada, diz quando foi -- no fuso da Mel, não no do servidor", () => {
  // 17h30 em UTC sao 14h30 em Sao Paulo: o quadro e renderizado na Vercel, em UTC.
  assert.equal(
    rotuloCaixaChamado(true, "2026-10-05T17:30:00Z"),
    "Já chamado no WhatsApp em 05/10/2026 às 14h30. Desmarque para chamar de novo.",
  );
});

test("entre o clique e o refresh, marcada e ainda sem data", () => {
  assert.equal(
    rotuloCaixaChamado(true, null),
    "Já chamado no WhatsApp. Desmarque para chamar de novo.",
  );
});
