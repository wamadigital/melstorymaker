import assert from "node:assert/strict";
import { test } from "node:test";
import { dataComPontos, dataDaEntrada, dataISOValida, mascararData } from "./data";
import { validarResposta } from "./validacao";
import { passosVisiveis } from "./engine";
import { CATEGORIAS } from "./types";
import { colunasPromovidas } from "@/lib/leads";

test("data com pontos mantém ISO ao digitar, colar com barras ou usar calendário", () => {
  for (const entrada of ["14032027", "14/03/2027", "14.03.2027", "2027-03-14"]) {
    assert.equal(dataDaEntrada(entrada), "2027-03-14");
    assert.equal(dataComPontos(dataDaEntrada(entrada)), "14.03.2027");
  }
  assert.equal(mascararData("1"), "1");
  assert.equal(mascararData("140"), "14.0");
  assert.equal(mascararData("140320"), "14.03.20");
  assert.equal(dataDaEntrada(""), "");
});

test("calendário real: não aceita dia inexistente nem bissexto incorreto", () => {
  for (const iso of ["2027-02-29", "2028-02-30", "2027-04-31", "1900-02-29", "0000-01-01", "2027-13-01"]) {
    assert.equal(dataISOValida(iso), false, iso);
    assert.notEqual(dataDaEntrada(dataComPontos(iso)), iso);
  }
  assert.equal(dataISOValida("2028-02-29"), true);
  assert.equal(dataISOValida("2000-02-29"), true);
  assert.equal(dataDaEntrada("29.02.2028"), "2028-02-29");
});

test("todas as modalidades validam a data e promovem ISO, sem alterar preço/ano", () => {
  for (const categoria of CATEGORIAS) {
    const passo = passosVisiveis(categoria, {}).find((p) => p.tipo === "data")!;
    const data = dataDaEntrada("01.01.2028");
    assert.equal(validarResposta(passo, data, new Date("2027-12-31T15:00:00Z")), null);
    assert.equal(colunasPromovidas(categoria, { data }).data_evento, "2028-01-01");
    assert.ok(validarResposta(passo, "31.02.2028"));
    assert.ok(validarResposta(passo, "2028-02-31"));
    assert.ok(validarResposta(passo, "2026-01-01", new Date("2027-12-31T15:00:00Z")));
  }
});
