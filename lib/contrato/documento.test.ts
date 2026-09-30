import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatarCep,
  formatarCnpj,
  formatarCpf,
  limparCnpj,
  limparCpf,
  mascararCep,
  mascararCnpj,
  mascararCpf,
  normalizarEmail,
  somenteDigitos,
  validarCep,
  validarCnpj,
  validarCpf,
  validarEmail,
} from "./documento";
import { ASSINANTE_CONTRATADA, CONTRATADA, PARTE_CONTRATADA } from "./contratada";

/**
 * Todos os documentos daqui sao FICTICIOS, gerados com digito verificador
 * valido para o teste. Nenhum veio de contrato de cliente. A unica excecao e o
 * CNPJ da propria Mel (CONTRATADA), que esta impresso em todas as artes.
 */
const CPFS_FICTICIOS = ["41826350780", "90273184687", "65018429305", "27194836564"];
const CNPJS_FICTICIOS = ["47182936000144", "20639518000187"];
const CNPJ_DA_MEL = "53925833000120";

test("cpf valido passa com e sem pontuacao", () => {
  for (const cpf of CPFS_FICTICIOS) {
    assert.ok(validarCpf(cpf), cpf);
    assert.ok(validarCpf(formatarCpf(cpf)), formatarCpf(cpf));
  }
  assert.ok(validarCpf(" 418.263.507-80 "));
});

test("cpf com digito errado, tamanho errado ou vazio e recusado", () => {
  assert.equal(validarCpf("41826350781"), false);
  assert.equal(validarCpf("41826350790"), false);
  assert.equal(validarCpf("4182635078"), false);
  assert.equal(validarCpf("418263507800"), false);
  assert.equal(validarCpf(""), false);
});

test("cpf com os 11 digitos iguais passa na conta mas nao e cpf de ninguem", () => {
  for (let d = 0; d <= 9; d++) assert.equal(validarCpf(String(d).repeat(11)), false, String(d));
});

test("cpf com letra no meio nao e limpo ate passar", () => {
  assert.equal(validarCpf("CPF 418.263.507-80"), false);
  assert.equal(validarCpf("418a26350780"), false);
});

test("cnpj numerico valido, inclusive o da CONTRATADA", () => {
  for (const cnpj of [...CNPJS_FICTICIOS, CNPJ_DA_MEL]) {
    assert.ok(validarCnpj(cnpj), cnpj);
    assert.ok(validarCnpj(formatarCnpj(cnpj)), formatarCnpj(cnpj));
  }
  assert.equal(formatarCnpj(CNPJ_DA_MEL), "53.925.833/0001-20");
});

/**
 * Desde julho de 2026 a Receita emite CNPJ alfanumerico. O exemplo oficial da
 * Receita e 12.ABC.345/01DE-35; se esta conta falhar, uma empresa aberta este
 * ano fica sem conseguir contratar a Mel.
 */
test("cnpj alfanumerico (Receita, julho de 2026) e aceito pelo mesmo calculo", () => {
  assert.ok(validarCnpj("12.ABC.345/01DE-35"));
  assert.ok(validarCnpj("12abc34501de35"), "letra minuscula colada");
  assert.ok(validarCnpj("A1B2C3D4000193"));
  assert.equal(validarCnpj("12.ABC.345/01DE-36"), false);
  assert.equal(limparCnpj("12.abc.345/01de-35"), "12ABC34501DE35");
  assert.equal(formatarCnpj("12abc34501de35"), "12.ABC.345/01DE-35");
});

test("cnpj com digito errado, letra no digito verificador ou repetido e recusado", () => {
  assert.equal(validarCnpj("53925833000121"), false);
  assert.equal(validarCnpj("5392583300012"), false);
  assert.equal(validarCnpj("12ABC34501DE3A"), false);
  assert.equal(validarCnpj("00000000000000"), false);
  assert.equal(validarCnpj("11111111111111"), false);
  assert.equal(validarCnpj("53.925.833/0001-20!"), false);
  assert.equal(validarCnpj(""), false);
});

test("formatacao de cpf e cep, e o que nao tem tamanho volta como veio", () => {
  assert.equal(formatarCpf("41826350780"), "418.263.507-80");
  assert.equal(formatarCpf("418.263.507-80"), "418.263.507-80");
  assert.equal(formatarCpf(" 123 "), "123");
  assert.equal(formatarCep("13000000"), "13000-000");
  assert.equal(formatarCep("13000-000"), "13000-000");
  assert.equal(formatarCep("1300"), "1300");
  assert.equal(formatarCnpj("123"), "123");
});

test("limpeza guarda o documento so com o que importa", () => {
  assert.equal(somenteDigitos("(19) 99999-0000"), "19999990000");
  assert.equal(limparCpf("418.263.507-80"), "41826350780");
  assert.equal(limparCnpj("53.925.833/0001-20"), "53925833000120");
});

test("mascaras progressivas do painel", () => {
  assert.equal(mascararCpf("418"), "418");
  assert.equal(mascararCpf("4182"), "418.2");
  assert.equal(mascararCpf("4182635"), "418.263.5");
  assert.equal(mascararCpf("41826350780999"), "418.263.507-80");
  assert.equal(mascararCnpj("539258"), "53.925.8");
  assert.equal(mascararCnpj("539258330001"), "53.925.833/0001");
  assert.equal(mascararCnpj("53925833000120"), "53.925.833/0001-20");
  assert.equal(mascararCnpj("12abc34501de35"), "12.ABC.345/01DE-35");
  assert.equal(mascararCep("13000"), "13000");
  assert.equal(mascararCep("130000009"), "13000-000");
});

test("cep valido tem os 8 digitos", () => {
  assert.ok(validarCep("13000-000"));
  assert.ok(validarCep("13000000"));
  assert.equal(validarCep("1300-000"), false);
  assert.equal(validarCep("CEP 13000-000"), false);
});

test("e-mail: aceita os formatos reais e recusa o que o link de assinatura nao alcancaria", () => {
  for (const ok of [
    "cliente@exemplo.com",
    "cliente.teste@exemplo.com.br",
    "cliente+evento@mail.exemplo.com",
    "a@x.co",
    " cliente@exemplo.com ",
    "joão@exemplo.com.br",
  ]) {
    assert.ok(validarEmail(ok), ok);
  }
  for (const ruim of [
    "",
    "cliente",
    "cliente@",
    "@exemplo.com",
    "cliente@exemplo",
    "cliente@exemplo.c",
    "cliente@exemplo..com",
    "cliente..teste@exemplo.com",
    ".cliente@exemplo.com",
    "cliente.@exemplo.com",
    "cli ente@exemplo.com",
    "cliente@exem plo.com",
    "cliente@@exemplo.com",
    "cliente@-exemplo.com",
  ]) {
    assert.equal(validarEmail(ruim), false, ruim);
  }
  assert.equal(normalizarEmail("  Cliente@Exemplo.COM "), "cliente@exemplo.com");
});

test("dados fixos da CONTRATADA sao coerentes entre si", () => {
  assert.ok(validarCnpj(CONTRATADA.cnpj));
  assert.equal(formatarCnpj(CONTRATADA.cnpj), CONTRATADA.cnpjFormatado);
  assert.equal(CONTRATADA.chavePix, CONTRATADA.cnpjFormatado);
  assert.ok(validarEmail(CONTRATADA.email));
  assert.ok(CONTRATADA.qualificacao.startsWith(`${CONTRATADA.nome}, brasileira, storymaker, inscrita no CNPJ sob o nº ${CONTRATADA.cnpjFormatado}`));
  assert.ok(CONTRATADA.qualificacao.endsWith(`com endereço eletrônico ${CONTRATADA.email}.`));
  assert.equal(PARTE_CONTRATADA.texto, CONTRATADA.qualificacao);
  assert.equal(ASSINANTE_CONTRATADA.documento, "CNPJ: 53.925.833/0001-20");
  assert.ok(Object.isFrozen(PARTE_CONTRATADA) && Object.isFrozen(ASSINANTE_CONTRATADA));
});
