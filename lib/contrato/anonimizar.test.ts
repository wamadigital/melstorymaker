import assert from "node:assert/strict";
import { test } from "node:test";
import { dadosContratoSchema, type DadosContrato } from "./tipos";
import { adicionalDoCatalogo, novoAdicional, pacoteDoCatalogo } from "./catalogo";
import { CONTRATADA } from "./contratada";
import { pagamentoDoPreset } from "./pagamento";
import { montarContrato, type ContextoMontagem } from "./montar";
import { textoCorrido } from "./validar";
import { anonimizar, anonimizarTexto, dadosPessoaisNoTexto, desanonimizar, MARCADORES, resumoParaIa } from "./anonimizar";
import { mensagemRevisao } from "./prompts";

// Tudo FICTICIO: CPFs e CNPJ gerados com digito verificador valido, de ninguem.

const CTX_CASAMENTO: ContextoMontagem = {
  categoria: "casamento",
  templateId: "casamento",
  idadeHomenageado: null,
  hojeISO: "2026-09-29",
};

function casamento(extra: (d: DadosContrato) => void = () => {}): DadosContrato {
  const d = dadosContratoSchema.parse({
    contratante: {
      tipo: "pf",
      pf: {
        nome: "Ana Paula Rocha",
        genero: "feminino",
        cpf: "12345678909",
        email: "ana.rocha@exemplo.com.br",
        telefone: "(19) 99876-5432",
        endereco: {
          logradouro: "Rua das Acácias",
          numero: "120",
          complemento: "Apto. 12",
          bairro: "Jardim Primavera",
          cidade: "Campinas",
          uf: "SP",
          cep: "13000-000",
        },
      },
    },
    anuente: {
      ativo: true,
      nome: "João Pedro Lima",
      genero: "masculino",
      cpf: "98765432100",
      email: "joao.lima@exemplo.com.br",
      papel: "noivo",
    },
    evento: {
      data: "2027-01-23",
      horarioInicio: "20:00",
      homenageado: "Ana e João",
      locais: [{ rotulo: "Local da cerimônia e recepção", endereco: "Espaço Jardim Aurora, Estrada Municipal 400, Valinhos/SP" }],
    },
    servico: {
      tabela: "2027",
      pacote: "Pacote Principal",
      valorPacote: 149000,
      escopo: pacoteDoCatalogo("casamento", "Pacote Principal")!.escopo,
      adicionais: [novoAdicional(adicionalDoCatalogo("casamento", "casamento.making_of_noiva")!, "Pacote Principal", "2027")],
    },
    pagamento: pagamentoDoPreset("30/70"),
  });
  extra(d);
  return d;
}

/** Nada do que identifica as pessoas pode sobrar, em nenhuma forma. */
function semDadoPessoal(texto: string, proibidos: string[]): void {
  for (const p of proibidos) assert.ok(!texto.includes(p), `sobrou "${p}"`);
}

// ---------------------------------------------------------------- anonimizar --

test("contrato anonimizado nao tem nome, CPF, e-mail nem endereco de contratante, anuente e homenageado", () => {
  const d = casamento();
  const { documento } = montarContrato(d, CTX_CASAMENTO);
  const texto = anonimizar(documento, d);

  semDadoPessoal(texto, [
    "Ana Paula Rocha",
    "Ana",
    "Paula",
    "Rocha",
    "João Pedro Lima",
    "João",
    "Lima",
    "123.456.789-09",
    "12345678909",
    "987.654.321-00",
    "ana.rocha@exemplo.com.br",
    "joao.lima@exemplo.com.br",
    "Rua das Acácias",
    "Acácias",
    "Jardim Primavera",
    "13000-000",
  ]);
  assert.deepEqual(dadosPessoaisNoTexto(texto, d), []);

  for (const m of [
    MARCADORES.contratante,
    MARCADORES.cpf,
    MARCADORES.email,
    MARCADORES.endereco,
    MARCADORES.anuente,
    MARCADORES.homenageado,
  ]) {
    assert.ok(texto.includes(m), `marcador ${m}`);
  }
  assert.ok(texto.includes("CONTRATANTE: [CONTRATANTE], brasileira, inscrita no CPF sob o nº [CPF], residente e domiciliada na [ENDERECO_CONTRATANTE], com endereço eletrônico [EMAIL],"));
  assert.ok(texto.includes("cobertura do casamento de [HOMENAGEADO], pelo período"));
});

test("o que nao e dado pessoal continua: a qualificacao da Mel, o local da festa, os valores e a numeracao", () => {
  const d = casamento();
  const { documento } = montarContrato(d, CTX_CASAMENTO);
  const texto = anonimizar(documento, d);
  assert.ok(texto.includes(`CONTRATADA: ${CONTRATADA.qualificacao}`));
  assert.ok(texto.includes("Espaço Jardim Aurora, Estrada Municipal 400, Valinhos/SP"));
  assert.ok(texto.includes("R$ 1.870,00 (mil oitocentos e setenta reais)"));
  assert.ok(texto.includes("CLÁUSULA 7 - DO PAGAMENTO"));
  assert.ok(texto.includes("**A reserva da data somente será garantida"), "o negrito vai, para a IA ver o destaque");
  assert.ok(!texto.includes("{{"));
});

test("sobrenome que e palavra comum ('Dias') some do nome mas nao dos 'dias úteis'", () => {
  const d = casamento((x) => {
    x.contratante.pf.nome = "Marta Dias Simão";
  });
  const { documento } = montarContrato(d, CTX_CASAMENTO);
  const texto = anonimizar(documento, d);
  assert.ok(texto.includes("5 (cinco) dias úteis"));
  assert.ok(!texto.includes("Marta"));
  assert.ok(texto.includes("Mellayne Simão Sabino"), "o sobrenome da cliente nao apaga o nome da Mel");
  assert.equal(anonimizarTexto("A Marta Dias pediu 10 dias.", d), "A [CONTRATANTE] [CONTRATANTE] pediu 10 dias.");
});

test("pessoa juridica: razao social, CNPJ, sede e representante saem do texto", () => {
  const d = dadosContratoSchema.parse({
    contratante: {
      tipo: "pj",
      pj: {
        razaoSocial: "Alfa Eventos Ltda.",
        cnpj: "11222333000181",
        endereco: { logradouro: "Alameda Santos", numero: "200", bairro: "Cambuí", cidade: "Campinas", uf: "SP" },
        representante: {
          nome: "Roberto Alves",
          genero: "masculino",
          cpf: "31415926590",
          cargo: "diretor",
          email: "roberto@alfa-eventos.com.br",
        },
      },
    },
    evento: {
      data: "2027-04-10",
      horarioInicio: "09:00",
      homenageado: "Alfa Eventos",
      tipoEvento: "Convenção",
      locais: [{ rotulo: "Local do evento", endereco: "Centro de Convenções Expo, Rodovia Dom Pedro, km 1, Campinas/SP" }],
    },
    servico: {
      tabela: "2027",
      pacote: "Pacote Pocket",
      valorPacote: 95000,
      escopo: pacoteDoCatalogo("corporativo", "Pacote Pocket")!.escopo,
    },
    pagamento: pagamentoDoPreset("30/70"),
  });
  const ctx: ContextoMontagem = { categoria: "corporativo", templateId: "corporativo", idadeHomenageado: null, hojeISO: "2026-09-29" };
  const { documento } = montarContrato(d, ctx);
  const texto = anonimizar(documento, d);
  semDadoPessoal(texto, [
    "Alfa Eventos",
    "11.222.333/0001-81",
    "Roberto",
    "Alves",
    "314.159.265-90",
    "roberto@alfa-eventos.com.br",
    "Alameda Santos",
  ]);
  assert.deepEqual(dadosPessoaisNoTexto(texto, d), []);
  assert.ok(texto.includes("neste ato representada por [REPRESENTANTE], diretor"));
  assert.ok(texto.includes("CNPJ: [CNPJ] — p. [REPRESENTANTE], CPF: [CPF]"));
  assert.ok(texto.includes("Foro da Comarca de Monte Mor/SP"));
});

test("observacoes com conversa colada tambem sao anonimizadas (telefone e CPF em qualquer formato)", () => {
  const d = casamento();
  const obs =
    "Ana Paula mandou: meu CPF é 123 456 789 09, tel 19 99876 5432 ou 99876-5432, e-mail ANA.ROCHA@exemplo.com.br, " +
    "moro na Rua das Acácias 120, CEP 13000000. O João vai fazer making of no hotel. A Rocha pediu desconto.";
  const texto = anonimizarTexto(obs, d);
  semDadoPessoal(texto, ["Ana", "Paula", "123 456 789 09", "99876", "5432", "ANA.ROCHA", "Acácias", "13000000", "João", "Rocha"]);
  assert.ok(texto.includes("[CPF]"));
  assert.ok(texto.includes("[TELEFONE]"));
  assert.ok(texto.includes("[EMAIL]"));
  assert.ok(texto.includes("making of no hotel"), "o resto da observacao continua legivel");
});

// ------------------------------------------------------------- desanonimizar --

test("desanonimizar: homenageado volta pelo nome, a CONTRATANTE vira o papel com a contracao certa", () => {
  const d = casamento();
  assert.equal(desanonimizar("A entrada de [HOMENAGEADO] será filmada.", d), "A entrada de Ana e João será filmada.");
  assert.equal(desanonimizar("[CONTRATANTE] informará o local.", d), "A CONTRATANTE informará o local.");
  assert.equal(desanonimizar("Depois disso, [CONTRATANTE] avisará.", d), "Depois disso, a CONTRATANTE avisará.");
  assert.equal(desanonimizar("A pedido de [CONTRATANTE], haverá pausa.", d), "A pedido da CONTRATANTE, haverá pausa.");
  assert.equal(desanonimizar("O acesso será dado por [CONTRATANTE].", d), "O acesso será dado pela CONTRATANTE.");
  assert.equal(desanonimizar("Cabe à [CONTRATANTE] e a [CONTRATANTE] também.", d), "Cabe à CONTRATANTE e a CONTRATANTE também.");
  assert.equal(desanonimizar("Fica acordado. [CONTRATANTE] declara.", d), "Fica acordado. A CONTRATANTE declara.");
});

test("desanonimizar deixa os outros marcadores, para a validacao acusar", () => {
  const d = casamento();
  assert.equal(desanonimizar("O CPF [CPF] e o [ANUENTE].", d), "O CPF [CPF] e o [ANUENTE].");
});

// --------------------------------------------------------------------- resumo --

test("resumo para a IA traz os dados do contrato e nenhum dado pessoal", () => {
  const d = casamento((x) => {
    // descricao digitada com o nome da noiva: o resumo nao pode vazar
    x.servico.adicionais[0].descricao = "Making of da noiva Ana Paula";
  });
  const resumo = resumoParaIa(d, CTX_CASAMENTO);
  assert.deepEqual(dadosPessoaisNoTexto(resumo, d), []);
  semDadoPessoal(resumo, ["Ana", "Paula", "Rocha", "João", "Lima", "@", "123.456.789", "Acácias"]);

  for (const linha of [
    "Categoria do evento: casamento (arte da proposta: casamento)",
    "Pessoa homenageada: [HOMENAGEADO]",
    "Evento de menor de idade: não",
    "Quem contrata: pessoa física",
    "Anuente (autoriza só a própria imagem): sim, papel no evento: noivo",
    "Data do evento: 23 de janeiro de 2027",
    "Início da cobertura: 20h",
    "Local da cerimônia e recepção: Espaço Jardim Aurora, Estrada Municipal 400, Valinhos/SP",
    "Local do making of: A DEFINIR",
    "Pacote: Pacote Principal, valor do pacote R$ 1.490,00",
    "Valor total do contrato: R$ 1.870,00",
    "- A: 30% = R$ 561,00, sinal, na assinatura",
    "- B: 70% = R$ 1.309,00, até 10 dias antes do evento",
    "Sinal (soma das parcelas de sinal): R$ 561,00",
    "Foro: comarca do domicílio da CONTRATANTE",
  ]) {
    assert.ok(resumo.split("\n").includes(linha), `linha do resumo: ${linha}`);
  }
  assert.ok(resumo.includes("making of de 2h"));
  assert.ok(resumo.includes("- Making of da noiva [CONTRATANTE] [CONTRATANTE]: 1 × R$ 380,00 = R$ 380,00, duração de 2h"));
});

test("resumo de evento de menor com pagamento quitado", () => {
  const d = dadosContratoSchema.parse({
    contratante: { tipo: "pf", pf: { nome: "Lúcia Ferraz", cpf: "11144477735", email: "lucia@exemplo.com.br" }, vinculo: "mãe" },
    evento: { data: "2027-08-08", horarioInicio: "21:00", homenageado: "Valentina", locais: [{ rotulo: "Local do evento", endereco: "Buffet Sonho" }] },
    servico: { tabela: "2027", pacote: "Pacote Básico", valorPacote: 129000, escopo: pacoteDoCatalogo("debutante", "Pacote Básico")!.escopo },
    pagamento: { modo: "quitado", quitadoEm: "2026-09-20", percentualSinalQuitado: 30 },
  });
  const ctx: ContextoMontagem = { categoria: "debutante", templateId: "debutante", idadeHomenageado: 15, hojeISO: "2026-09-29" };
  const resumo = resumoParaIa(d, ctx);
  assert.ok(resumo.includes("Evento de menor de idade: sim (idade: 15)"));
  assert.ok(resumo.includes("Vínculo de quem contrata com [HOMENAGEADO]: mãe"));
  assert.ok(resumo.includes("Pagamento: já quitado em 20 de setembro de 2026; sinal: 30% = R$ 387,00"));
  semDadoPessoal(resumo, ["Lúcia", "Ferraz", "Valentina", "lucia@"]);
});

test("resumo com auxiliar por hora e com ensaio: o revisor le a equipe parcial e onde e quando e o ensaio", () => {
  // Infantil, Pacote Premium (5 h), com o storymaker por hora do catalogo por
  // 2 horas: a equipe NAO e de dois o evento inteiro.
  const infantil = dadosContratoSchema.parse({
    contratante: { tipo: "pf", pf: { nome: "Lúcia Ferraz", cpf: "11144477735", email: "lucia@exemplo.com.br" }, vinculo: "mãe" },
    evento: { data: "2027-08-08", horarioInicio: "15:00", homenageado: "Theo", locais: [{ rotulo: "Local do evento", endereco: "Buffet Castelo Encantado, Campinas/SP" }] },
    servico: {
      tabela: "2027",
      pacote: "Pacote Premium",
      valorPacote: 145000,
      escopo: pacoteDoCatalogo("aniversario_infantil", "Pacote Premium")!.escopo,
      adicionais: [
        { ...novoAdicional(adicionalDoCatalogo("aniversario_infantil", "aniversario_infantil.storymaker")!, "Pacote Premium", "2027"), quantidade: 2 },
      ],
    },
    pagamento: pagamentoDoPreset("30/70"),
  });
  const ctxInfantil: ContextoMontagem = {
    categoria: "aniversario",
    templateId: "aniversario_infantil",
    idadeHomenageado: 6,
    hojeISO: "2026-09-29",
  };
  const resumoInfantil = resumoParaIa(infantil, ctxInfantil);
  assert.ok(resumoInfantil.includes("equipe: a CONTRATADA, com 1 storymaker auxiliar por 2h"), resumoInfantil);
  assert.ok(!resumoInfantil.includes("durante toda a cobertura"));

  // Debutante no Pacote Luxo, com o ensaio marcado num parque (publico, vai
  // inteiro) e, no segundo caso, na casa da contratante (nao vai).
  const debutante = (ensaioLocal: string) =>
    dadosContratoSchema.parse({
      contratante: { tipo: "pf", pf: { nome: "Lúcia Ferraz", cpf: "11144477735", email: "lucia@exemplo.com.br" }, vinculo: "mãe" },
      evento: {
        data: "2027-03-20",
        horarioInicio: "21:00",
        homenageado: "Valentina",
        locais: [{ rotulo: "Local do evento", endereco: "Buffet Sonho, Campinas/SP" }],
        ensaioData: "2027-02-27",
        ensaioLocal,
        ensaioHorario: "16:30",
      },
      servico: { tabela: "2027", pacote: "Pacote Luxo", valorPacote: 229000, escopo: pacoteDoCatalogo("debutante", "Pacote Luxo")!.escopo },
      pagamento: pagamentoDoPreset("30/70"),
    });
  const ctxDebutante: ContextoMontagem = { categoria: "debutante", templateId: "debutante", idadeHomenageado: 15, hojeISO: "2026-09-29" };
  const noParque = resumoParaIa(debutante("Parque das Águas, Avenida José Bonifácio, Campinas/SP"), ctxDebutante);
  assert.ok(noParque.includes("Data do ensaio: 27 de fevereiro de 2027"));
  assert.ok(noParque.includes("Local do ensaio: Parque das Águas, Avenida José Bonifácio, Campinas/SP"));
  assert.ok(noParque.includes("Início do ensaio: 16h30"));

  const emCasa = resumoParaIa(debutante("casa da Lúcia Ferraz, Rua das Palmeiras, 45, Campinas/SP"), ctxDebutante);
  semDadoPessoal(emCasa, ["Lúcia", "Ferraz", "Valentina", "lucia@"]);
});

// -------------------------------------------------------- rede de seguranca --

test("dadosPessoaisNoTexto aponta o que escapou, sem dizer qual dado", () => {
  const d = casamento();
  const { documento } = montarContrato(d, CTX_CASAMENTO);
  const cru = textoCorrido(documento);
  assert.deepEqual(dadosPessoaisNoTexto(cru, d).sort(), ["CPF", "e-mail", "endereço", "nome"]);
  assert.deepEqual(dadosPessoaisNoTexto("CPF 123.456.789-09", d), ["CPF"]);
  assert.deepEqual(dadosPessoaisNoTexto("nenhum dado aqui, 10 dias úteis", d), []);
});

// ------------------------------------------------ casos adversariais (A1/A2/A4/A6) --

/** O que sai da troca e o que a rede ainda acharia nele (tem de ser nada). */
function trocado(texto: string, d: DadosContrato): string {
  const t = anonimizarTexto(texto, d);
  assert.deepEqual(dadosPessoaisNoTexto(t, d), [], `a rede achou dado em: ${t}`);
  return t;
}

test("CPF colado em letra ou com separador duplo e trocado, e a rede o acharia (A1)", () => {
  const d = casamento();
  for (const cru of ["CPF12345678909", "CPF nº12345678909", "CPF 123.456.789 - 09", "CPF 123. 456. 789-09", "cpf: 1234567890 9"]) {
    assert.deepEqual(dadosPessoaisNoTexto(cru, d), ["CPF"], `a rede acusa: ${cru}`);
    const t = trocado(cru, d);
    assert.ok(t.includes("[CPF]"), `${cru} -> ${t}`);
    assert.ok(!/\d{2}/.test(t), `nao sobra digito: ${t}`);
  }
});

test("telefone com +55, colado ou so o numero local e trocado (A1)", () => {
  const d = casamento();
  assert.equal(trocado("whats +55 19 99876-5432", d), "whats [TELEFONE]");
  assert.equal(trocado("tel:19998765432", d), "tel:[TELEFONE]");
  assert.equal(trocado("liga no 99876 5432", d), "liga no [TELEFONE]");
  assert.deepEqual(dadosPessoaisNoTexto("tel 19 99876 5432", d), ["telefone"]);
});

test("dados de terceiros nas observacoes tambem saem: e-mail, CPF, CNPJ e telefone de qualquer pessoa (A4)", () => {
  const d = casamento();
  const cru = "o pai (carlos@gmail.com, CPF 529.982.247-25) paga, tel (11) 91234-5678; a empresa dele e 11.222.333/0001-81, a do tio 12.ABC.345/01DE-35";
  assert.deepEqual(dadosPessoaisNoTexto(cru, d).sort(), ["CNPJ", "CPF", "e-mail", "telefone"]);
  assert.equal(
    trocado(cru, d),
    "o pai ([EMAIL], CPF [CPF]) paga, tel [TELEFONE]; a empresa dele e [CNPJ], a do tio [CNPJ]",
  );
});

test("sequencia que so parece documento nao vira marcador: CNPJ alfanumerico so com digito verificador", () => {
  const d = casamento();
  assert.equal(trocado("de uma vez para 12 pessoas, 2 (duas) horas, R$ 1.870,00 em 23/01/2027", d),
    "de uma vez para 12 pessoas, 2 (duas) horas, R$ 1.870,00 em 23/01/2027");
});

test("endereco abreviado, sem acento, com o numero ou so o bairro e trocado (A2)", () => {
  const d = casamento();
  for (const [cru, esperado] of [
    ["entregar na R. das Acácias, 120, ap 12 - Jd. Primavera", "entregar na [ENDERECO_CONTRATANTE], ap 12 - [ENDERECO_CONTRATANTE]"],
    ["Rua das Acacias 120", "[ENDERECO_CONTRATANTE]"],
    ["mora na das acácias nº 120", "mora na [ENDERECO_CONTRATANTE]"],
    ["fica no Jardim Primavera", "fica no [ENDERECO_CONTRATANTE]"],
    ["cep 13000000", "cep [ENDERECO_CONTRATANTE]"],
  ]) {
    assert.ok(dadosPessoaisNoTexto(cru, d).length > 0, `a rede acusa: ${cru}`);
    assert.equal(trocado(cru, d), esperado);
  }
});

test("nome em minuscula, em MAIUSCULA ou sem acento e trocado; palavra comum em minuscula fica (A2)", () => {
  const d = casamento();
  assert.deepEqual(dadosPessoaisNoTexto("a ana pediu", d), ["nome"]);
  assert.equal(trocado("a ana pediu para chegar cedo; o joão também", d), "a [CONTRATANTE] pediu para chegar cedo; o [ANUENTE] também");
  assert.equal(trocado("Cliente: ANA PAULA, noivo JOAO", d), "Cliente: [CONTRATANTE] [CONTRATANTE], noivo [ANUENTE]");
  assert.equal(trocado("O Joao quer um reels extra", d), "O [ANUENTE] quer um reels extra");
  assert.equal(trocado("a rocha e a ROCHA", d), "a [CONTRATANTE] e a [CONTRATANTE]");

  // Sobrenome que e palavra comum: some com maiuscula e colado ao nome, fica no texto comum.
  const clara = casamento((x) => {
    x.contratante.pf.nome = "Clara Dias Rosa";
  });
  assert.equal(
    trocado("A clara dias rosa pediu, de forma clara, 5 (cinco) dias úteis e flores cor-de-rosa.", clara),
    "A [CONTRATANTE] pediu, de forma clara, 5 (cinco) dias úteis e flores cor-de-rosa.",
  );
  // Nome so de palavras comuns, em minuscula e pela metade: o par em ordem denuncia.
  assert.equal(trocado("a clara rosa confirmou", clara), "a [CONTRATANTE] [CONTRATANTE] confirmou");
  // Palavra comum colada no nome ja trocado tambem e nome.
  assert.equal(trocado("A Clara rosa confirmou", clara), "A [CONTRATANTE] [CONTRATANTE] confirmou");
});

test("making of e evento na casa da contratante: o endereco dela nao vai para a IA, e a rede confere (A2)", () => {
  const d = casamento((x) => {
    x.evento.locais = [{ rotulo: "Local do evento", endereco: "Residência da família, R. das Acácias, 120, Jd. Primavera, Campinas/SP" }];
    x.evento.makingOfLocal = "casa da noiva, Rua das Acacias 120";
  });
  const { documento } = montarContrato(d, CTX_CASAMENTO);
  const paraIa = `${anonimizar(documento, d)}\n${resumoParaIa(d, CTX_CASAMENTO)}`;
  semDadoPessoal(paraIa, ["Acácias", "Acacias", "Primavera", "120, Jd"]);
  assert.ok(paraIa.includes("Local do evento: Residência da família, [ENDERECO_CONTRATANTE], [ENDERECO_CONTRATANTE], Campinas/SP"));
  assert.ok(paraIa.includes("Local do making of: casa da noiva, [ENDERECO_CONTRATANTE]"));
  assert.deepEqual(dadosPessoaisNoTexto(paraIa, d), []);
  // o texto cru, sem a troca, a rede barra
  assert.ok(dadosPessoaisNoTexto("Local do making of: casa da noiva, Rua das Acacias 120", d).includes("endereço"));
});

test("local publico com o nome da contratante vai inteiro; o nome dela, fora do local, nao (A6)", () => {
  const d = casamento((x) => {
    x.contratante.pf.nome = "Maria Rosa Santos";
    x.evento.homenageado = "Maria Rosa e Pedro";
    x.evento.locais = [{ rotulo: "Local da cerimônia e recepção", endereco: "Chácara Santa Maria Rosa, Rua Maria Rosa, 50, Valinhos/SP" }];
  });
  const { documento } = montarContrato(d, CTX_CASAMENTO);
  const contrato = anonimizar(documento, d);
  const resumo = resumoParaIa(d, CTX_CASAMENTO);
  const local = "Local da cerimônia e recepção: Chácara Santa Maria Rosa, Rua Maria Rosa, 50, Valinhos/SP";
  assert.ok(contrato.includes(local), "no contrato");
  assert.ok(resumo.includes(local), "no resumo");
  assert.ok(!/\[CONTRATANTE\] \[CONTRATANTE\]|\[HOMENAGEADO\] Rosa/.test(contrato));
  assert.deepEqual(dadosPessoaisNoTexto(`${contrato}\n${resumo}`, d), []);

  // Nas observacoes, o nome do local tambem vai inteiro; o da noiva, nao.
  assert.equal(
    trocado("A Maria Rosa quer chegar cedo na Chácara Santa Maria Rosa.", d),
    "A [CONTRATANTE] [CONTRATANTE] quer chegar cedo na Chácara Santa Maria Rosa.",
  );
});

test("'casa da Ana' nao e local publico: o nome de quem mora la sai", () => {
  const d = casamento((x) => {
    x.evento.locais = [{ rotulo: "Local do evento", endereco: "casa da Ana, Estrada do Sítio 7, Valinhos/SP" }];
  });
  assert.ok(resumoParaIa(d, CTX_CASAMENTO).includes("Local do evento: casa da [CONTRATANTE], Estrada do Sítio 7, Valinhos/SP"));
});

test("desanonimizar deixa o marcador REPETIDO como esta, para a validacao acusar (A6)", () => {
  const d = casamento((x) => {
    x.contratante.pf.nome = "Maria Rosa Santos";
  });
  assert.equal(
    desanonimizar("A equipe chegará à Chácara Santa [CONTRATANTE] [CONTRATANTE] às 16h, e [CONTRATANTE] avisará.", d),
    "A equipe chegará à Chácara Santa [CONTRATANTE] [CONTRATANTE] às 16h, e a CONTRATANTE avisará.",
  );
});

// ------------------------------------------------------------ origem (IA-02) --

test("o contrato para a IA diz a origem de cada clausula: padrao, IA, editada, acrescentada", () => {
  const d = casamento();
  const { documento } = montarContrato(d, CTX_CASAMENTO, ["A CONTRATADA seguirá o roteiro combinado com a CONTRATANTE."]);
  const doc = structuredClone(documento);
  const pagamento = doc.clausulas.find((c) => c.id === "pagamento")!;
  pagamento.origem = "editada";
  doc.clausulas.splice(3, 0, { id: "livre-1", titulo: "DO FIGURINO", paragrafos: ["A CONTRATADA usará roupa preta."], origem: "editada", problemas: [] });

  const texto = anonimizar(doc, d);
  const cabecalhos = texto.split("\n").filter((l) => l.startsWith("CLÁUSULA "));
  assert.ok(cabecalhos.includes("CLÁUSULA 1 - DO OBJETO DO CONTRATO (origem: padrão aprovado)"));
  assert.ok(cabecalhos.includes("CLÁUSULA 4 - DO FIGURINO (origem: acrescentada no painel)"));
  assert.ok(cabecalhos.some((c) => /^CLÁUSULA \d+ - DO PAGAMENTO \(origem: editada no painel\)$/.test(c)));
  assert.ok(cabecalhos.some((c) => /^CLÁUSULA \d+ - DAS CONDIÇÕES ESPECIAIS \(origem: redigida pela IA\)$/.test(c)));
  assert.ok(cabecalhos.every((c) => c.includes("(origem: ")), "toda clausula tem origem");

  // A marca vai na mensagem da revisao, e some quando pedida sem ela.
  const mensagem = mensagemRevisao({ contratoAnonimizado: texto, resumo: resumoParaIa(d, CTX_CASAMENTO), observacoes: "" });
  assert.ok(mensagem.includes("CLÁUSULA 1 - DO OBJETO DO CONTRATO (origem: padrão aprovado)"));
  assert.ok(!anonimizar(doc, d, { marcarOrigem: false }).includes("(origem: "));
});

test("a origem entra depois da troca: uma cliente chamada Mel nao apaga a marca", () => {
  const d = casamento((x) => {
    x.contratante.pf.nome = "Mel Padrão Aprovado";
  });
  const texto = anonimizar(montarContrato(d, CTX_CASAMENTO).documento, d);
  assert.ok(texto.includes("CLÁUSULA 1 - DO OBJETO DO CONTRATO (origem: padrão aprovado)"));
});
