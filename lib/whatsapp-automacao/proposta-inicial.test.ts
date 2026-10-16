import assert from "node:assert/strict";
import { test } from "node:test";
import { sequenciaPropostaInicial, validarSequenciaPropostaInicial, propostaInicialAtiva } from "./proposta-inicial";

test("proposta inicial preserva copy, nome composto, link e pausas exatas do owner", () => {
  const seq = sequenciaPropostaInicial("Maria Eduarda", "https://melstorymaker.com.br/p/a3f9");
  assert.deepEqual(seq.map(p => p.delayBeforeSeconds), [0, 3, 2, 4]);
  assert.equal(seq[0].message, "Oi, Maria Eduarda tudo bem? Aqui é a Mel Storymaker ✨");
  assert.equal(seq[2].message, "Segue a sua proposta:\n🤍 https://melstorymaker.com.br/p/a3f9");
  assert.equal(seq[3].message, "Qualquer dúvida, é só me chamar. Ok?\nFico à disposição para te ajudar no que precisar!");
  assert.deepEqual(validarSequenciaPropostaInicial(seq, seq.map(p => p.message).join("\n\n")), seq);
});

test("recusa placeholders, nomes com instruções, links de outra rota e snapshots adulterados", () => {
  for (const nome of ["", "{nome}", "Ana\nOutra mensagem", " Ana", "https://site.invalid", "A".repeat(121)]) {
    assert.throws(() => sequenciaPropostaInicial(nome, "https://melstorymaker.com.br/p/a3f9"));
  }
  for (const link of ["http://site.invalid/p/a3f9", "https://site.invalid/p/a3f9?x=1", "https://site.invalid/continuar/a3f9", "https://user@site.invalid/p/a3f9"]) {
    assert.throws(() => sequenciaPropostaInicial("Ana", link));
  }
  const original = sequenciaPropostaInicial("Ana", "https://site.invalid/p/a3f9");
  for (const indice of [0, 1, 2, 3]) {
    const alterada = structuredClone(original); alterada[indice].delayBeforeSeconds++;
    assert.throws(() => validarSequenciaPropostaInicial(alterada, alterada.map(p => p.message).join("\n\n")));
  }
});

test("proposta inicial exige flags geral e própria; não depende de lembretes", () => {
  assert.equal(propostaInicialAtiva({ WHATSAPP_PROPOSTA_INICIAL_ATIVA: "true" }), false);
  assert.equal(propostaInicialAtiva({ WHATSAPP_AUTOMACAO_ATIVA: "true" }), false);
  assert.equal(propostaInicialAtiva({ WHATSAPP_AUTOMACAO_ATIVA: "true", WHATSAPP_PROPOSTA_INICIAL_ATIVA: "true" }), true);
});
