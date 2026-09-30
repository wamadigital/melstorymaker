import assert from "node:assert/strict";
import { test } from "node:test";
import type { Endereco } from "./tipos";
import {
  enderecoPorExtenso,
  flexao,
  listaPtBr,
  nacionalidadeDe,
  nacionalidadePadrao,
  normalizarComparacao,
  o_a,
  preposicaoLogradouro,
  primeiraMaiuscula,
  sanitizarPdf,
} from "./texto";

// Endereco ficticio. Nenhum dado aqui veio de contrato de cliente.
function endereco(parcial: Partial<Endereco>): Endereco {
  return { logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "", ...parcial };
}

test("concordancia pelo genero escolhido pela Mel", () => {
  assert.equal(flexao("feminino", "inscrito", "inscrita"), "inscrita");
  assert.equal(flexao("masculino", "inscrito", "inscrita"), "inscrito");
  assert.equal(o_a("feminino"), "a");
  assert.equal(o_a("masculino"), "o");
  assert.equal(nacionalidadePadrao("feminino"), "brasileira");
  assert.equal(nacionalidadePadrao("masculino"), "brasileiro");
});

test("genero nao escolhido nunca vira masculino em silencio", () => {
  assert.equal(flexao("", "inscrito", "inscrita"), "inscrito/inscrita");
  assert.equal(o_a(""), "o/a");
  assert.equal(nacionalidadePadrao(""), "brasileiro/brasileira");
});

test("nacionalidade digitada (estrangeiro) prevalece sobre a padrao", () => {
  assert.equal(nacionalidadeDe({ nacionalidade: "", genero: "feminino" }), "brasileira");
  assert.equal(nacionalidadeDe({ nacionalidade: "  portuguesa ", genero: "feminino" }), "portuguesa");
});

test("endereco completo em uma linha, com CEP formatado", () => {
  assert.equal(
    enderecoPorExtenso(
      endereco({
        logradouro: "Rua das Acácias",
        numero: "120",
        complemento: "Bl. B, Apto. 12",
        bairro: "Jardim Primavera",
        cidade: "Campinas",
        uf: "sp",
        cep: "13000000",
      }),
    ),
    "Rua das Acácias, 120, Bl. B, Apto. 12, Jardim Primavera, Campinas/SP, CEP 13000-000",
  );
});

test("endereco sem numero vira s/n, e parte vazia nao gera virgula dupla", () => {
  assert.equal(
    enderecoPorExtenso(endereco({ logradouro: "Estrada do Sítio Novo", bairro: "Zona Rural", cidade: "Monte Mor", uf: "SP" })),
    "Estrada do Sítio Novo, s/n, Zona Rural, Monte Mor/SP",
  );
  for (const sn of ["sn", "S/N", "s/nº", "s.n."]) {
    assert.equal(enderecoPorExtenso(endereco({ logradouro: "Rua A", numero: sn, cidade: "Campinas", uf: "SP" })), "Rua A, s/n, Campinas/SP", sn);
  }
  const texto = enderecoPorExtenso(endereco({ logradouro: " Rua  A, ", numero: " 10 ", complemento: " ", bairro: ",Centro,", cidade: "Campinas", uf: "SP" }));
  assert.equal(texto, "Rua A, 10, Centro, Campinas/SP");
  assert.doesNotMatch(texto, /,\s*,|\s{2}/);
});

test("endereco: 'nº 28' vira '28' e a UF nao se repete quando veio junto da cidade", () => {
  assert.equal(enderecoPorExtenso(endereco({ logradouro: "Rua B", numero: "nº 28", cidade: "Campinas - SP", uf: "SP" })), "Rua B, 28, Campinas/SP");
  assert.equal(enderecoPorExtenso(endereco({ logradouro: "Rua B", numero: "28", cidade: "Campinas/SP" })), "Rua B, 28, Campinas/SP");
});

test("endereco vazio e string vazia (quem acusa a falta e a montagem)", () => {
  assert.equal(enderecoPorExtenso(endereco({})), "");
});

test("preposicao pelo tipo de logradouro", () => {
  for (const na of ["Rua A", "R. Caiapós", "rua a", "Avenida Brasil", "Av. Brasil", "Av.Brasil", "Alameda X", "Al. X", "Estrada Y", "Rodovia SP-101", "Rod. SP-101", "Travessa Z", "Praça da Sé", "Praca da Se", "Via Anhanguera", "Chácara Boa Vista", "Fazenda Santa Rita"]) {
    assert.equal(preposicaoLogradouro(na), "na", na);
  }
  for (const no of ["Largo do Rosário", "Parque das Flores", "Beco Sem Saída", "Condomínio Solar", "Sítio Recanto", "Conjunto Habitacional", "Residencial Alpha", "Loteamento Beta", "Núcleo Colonial"]) {
    assert.equal(preposicaoLogradouro(no), "no", no);
  }
  for (const em of ["", "Quadra 5", "Espaço Villa Toscana", "Km 12"]) {
    assert.equal(preposicaoLogradouro(em), "em", em);
  }
});

test("lista pt-BR com virgulas e 'e' no ultimo", () => {
  assert.equal(listaPtBr([]), "");
  assert.equal(listaPtBr(["a"]), "a");
  assert.equal(listaPtBr(["a", "b"]), "a e b");
  assert.equal(listaPtBr(["a", "b", "c"]), "a, b e c");
  assert.equal(listaPtBr(["a", " ", "b", ""]), "a e b");
});

test("primeira maiuscula so mexe na primeira letra", () => {
  assert.equal(primeiraMaiuscula("despesas de locomoção da CONTRATADA"), "Despesas de locomoção da CONTRATADA");
  assert.equal(primeiraMaiuscula("érica"), "Érica");
  assert.equal(primeiraMaiuscula("1 (um) storymaker"), "1 (um) storymaker");
  assert.equal(primeiraMaiuscula(""), "");
});

test("comparacao ignora acento, caixa e pontuacao", () => {
  assert.equal(normalizarComparacao("Espaço Villa-Toscana"), normalizarComparacao("espaco villa toscana"));
  assert.equal(normalizarComparacao("  Ana  &  João "), "ana joao");
});

// ------------------------------------------------------------ sanitizarPdf --
//
// Caracteres invisiveis vao por codepoint: um zero-width literal no fonte do
// teste e indistinguivel de "nada" para quem le o diff.

const u = (...codigos: number[]) => String.fromCodePoint(...codigos);
const NBSP = u(0xa0);
const SOFT_HYPHEN = u(0xad);
const ZERO_WIDTH_SPACE = u(0x200b);
const ZWJ = u(0x200d);
const WORD_JOINER = u(0x2060);
const BOM = u(0xfeff);
const SELETOR_EMOJI = u(0xfe0f);
const ACENTO_AGUDO = u(0x301);
const CEDILHA = u(0x327);
const TIL = u(0x303);

test("pdf: acentos, cedilha e & passam intactos", () => {
  assert.equal(sanitizarPdf("Ana & João"), "Ana & João");
  assert.equal(sanitizarPdf("Conceição"), "Conceição");
  assert.equal(sanitizarPdf("Mário Ávila"), "Mário Ávila");
  const tipografia = `§ 2º, 1ª parcela, R$ 1.500,00 ${u(0x2014)} ${u(0x201c)}sinal${u(0x201d)} ${u(0x2013)} ${u(0x2018)}ok${u(0x2019)}${u(0x2026)} ${u(0x2022)} ${u(0x20ac)}`;
  assert.equal(sanitizarPdf(tipografia), tipografia);
});

test("pdf: acento decomposto (NFD) vira o caractere composto do Latin-1", () => {
  const decomposto = `Ma${ACENTO_AGUDO}rio A${ACENTO_AGUDO}vila Conceic${CEDILHA}a${TIL}o`;
  assert.equal(sanitizarPdf(decomposto), "Mário Ávila Conceição");
});

test("pdf: emoji some, inclusive com modificador de pele, ZWJ e seletor de variacao", () => {
  const festa = u(0x1f389);
  const brilho = u(0x2728);
  const joinha = u(0x1f44d, 0x1f3fd);
  const familia = u(0x1f468) + ZWJ + u(0x1f469) + ZWJ + u(0x1f467);
  const coracao = u(0x2764) + SELETOR_EMOJI;
  assert.equal(sanitizarPdf(`Festa da Ana ${festa}${brilho}`), "Festa da Ana ");
  assert.equal(sanitizarPdf(`Oi ${joinha} tudo`), "Oi tudo");
  assert.equal(sanitizarPdf(`família ${familia} feliz`), "família feliz");
  assert.equal(sanitizarPdf(`amor ${coracao} sempre`), "amor sempre");
});

test("pdf: soft hyphen e zero-width somem sem separar a palavra", () => {
  assert.equal(sanitizarPdf(`con${SOFT_HYPHEN}trato`), "contrato");
  assert.equal(sanitizarPdf(`con${ZERO_WIDTH_SPACE}trato`), "contrato");
  assert.equal(sanitizarPdf(`con${ZWJ}trato`), "contrato");
  assert.equal(sanitizarPdf(`con${WORD_JOINER}trato${BOM}`), "contrato");
});

test("pdf: NBSP, tab e quebra de linha viram um espaco so", () => {
  assert.equal(sanitizarPdf(`R$${NBSP}1.500,00`), "R$ 1.500,00");
  assert.equal(sanitizarPdf("a\tb\nc\r\nd"), "a b c d");
  assert.equal(sanitizarPdf(`a ${u(0x202f)}  b${u(0x2028)}c`), "a b c");
});

test("pdf: controles somem", () => {
  assert.equal(sanitizarPdf(`a${u(0)}b${u(7)}c${u(0x7f)}d${u(0x85)}e`), "abcde");
});

test("pdf: pontuacao sem glifo vira a equivalente que a fonte tem", () => {
  assert.equal(sanitizarPdf(`SP${u(0x2011)}101`), "SP-101");
  assert.equal(sanitizarPdf(`${u(0x201e)}oi${u(0x201c)}`), `${u(0x201c)}oi${u(0x201c)}`);
  assert.equal(sanitizarPdf(`D${u(0x2bc)}Ávila`), `D${u(0x2019)}Ávila`);
  assert.equal(sanitizarPdf(`${u(0x2212)}5`), "-5");
});

test("pdf: letra estrangeira fora do Latin-1 perde so o acento, nao a letra", () => {
  assert.equal(sanitizarPdf(`${u(0x141)}ukasz Dvo${u(0x159)}ák ${u(0x15e)}ahin`), "Lukasz Dvorák Sahin");
  assert.equal(sanitizarPdf(`${u(0xfb01)}m`), "fim");
});

test("pdf: nao apara as pontas, para poder ser aplicado a um trecho de negrito", () => {
  assert.equal(sanitizarPdf(" negrito "), " negrito ");
  assert.equal(sanitizarPdf(""), "");
});

test("pdf: o resultado so tem codepoints permitidos", () => {
  const sujo = `Olá${SOFT_HYPHEN} ${u(0x1f389)} ${u(0x201c)}Ana${u(0x201d)} 12${NBSP}h${ZWJ}${ACENTO_AGUDO} ${u(0xfb00)} ${u(0x2122)} ${u(0x4e2d, 0x6587)}`;
  const limpo = sanitizarPdf(sujo);
  for (const ch of limpo) {
    const codigo = ch.codePointAt(0) ?? 0;
    const ok =
      (codigo >= 0x20 && codigo <= 0x7e) ||
      (codigo >= 0xa1 && codigo <= 0xff && codigo !== 0xad) ||
      [0x201c, 0x201d, 0x2018, 0x2019, 0x2013, 0x2014, 0x2026, 0x2022, 0x20ac].includes(codigo);
    assert.ok(ok, `U+${codigo.toString(16)} em ${JSON.stringify(limpo)}`);
  }
  assert.match(limpo, /ff TM/, "ligadura e marca registrada decompostas");
});
