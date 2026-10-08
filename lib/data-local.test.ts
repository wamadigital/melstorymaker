import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { hojeEmSaoPaulo } from "./data-local";

test("dia civil de Sao Paulo muda na meia-noite local e aceita timestamp", () => {
  assert.equal(hojeEmSaoPaulo(new Date("2026-01-01T02:59:59Z")), "2025-12-31");
  assert.equal(hojeEmSaoPaulo(Date.parse("2026-01-01T03:00:00Z")), "2026-01-01");
  assert.equal(hojeEmSaoPaulo(new Date("2028-03-01T02:30:00Z")), "2028-02-29");
});

test("input e validacao aceitam hoje em SP sob servidor UTC ou aparelho SP", () => {
  const codigo = `
    const { dataMinima } = require('./lib/form/engine.ts');
    const { validarResposta } = require('./lib/form/validacao.ts');
    const instante = new Date('2026-10-09T01:30:00Z');
    const passo = { id:'data', tipo:'data', pergunta:'', obrigatorio:true, min:'hoje' };
    process.stdout.write(JSON.stringify({
      min: dataMinima(passo, instante),
      hoje: validarResposta(passo, '2026-10-08', instante),
      ontem: validarResposta(passo, '2026-10-07', instante),
    }));
  `;
  for (const TZ of ["UTC", "America/Sao_Paulo"]) {
    const resultado = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "-e", codigo], {
      cwd: process.cwd(), env: { ...process.env, TZ }, encoding: "utf8",
    }));
    assert.deepEqual(resultado, { min: "2026-10-08", hoje: null, ontem: "A data precisa ser de hoje em diante." }, TZ);
  }
});
