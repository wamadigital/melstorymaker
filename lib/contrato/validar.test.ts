import assert from "node:assert/strict";
import { test } from "node:test";
import { dadosContratoSchema, type DadosContrato, type DocumentoContrato } from "./tipos";
import { pacoteDoCatalogo } from "./catalogo";
import { pagamentoDoPreset } from "./pagamento";
import { montarContrato, type ContextoMontagem } from "./montar";
import {
  ehClausulaDoModelo,
  MAXIMO_CARACTERES_PARAGRAFO_IA,
  ReferenciaInvalidaError,
  normalizarComMapa,
  textoCorrido,
  textoResolvido,
  validarDocumento,
  validarTextoIa,
} from "./validar";

// Dados FICTICIOS; CPF gerado com digito verificador valido, de ninguem.

const CTX: ContextoMontagem = { categoria: "casamento", templateId: "casamento", idadeHomenageado: null, hojeISO: "2026-09-29" };

function dados(observacoes = ""): DadosContrato {
  return dadosContratoSchema.parse({
    contratante: {
      tipo: "pf",
      pf: {
        nome: "Helena Duarte Campos",
        genero: "feminino",
        cpf: "22233366638",
        email: "helena.campos@exemplo.com.br",
        endereco: { logradouro: "Rua Nove", numero: "90", bairro: "Taquaral", cidade: "Campinas", uf: "SP" },
      },
    },
    evento: {
      data: "2027-06-12",
      horarioInicio: "17:00",
      homenageado: "Helena e Caio",
      locais: [{ rotulo: "Local da cerimônia e recepção", endereco: "Fazenda Santa Rita, Estrada da Rita, km 3, Itatiba/SP" }],
    },
    servico: {
      tabela: "2027",
      pacote: "Pacote Principal",
      valorPacote: 149000,
      escopo: pacoteDoCatalogo("casamento", "Pacote Principal")!.escopo,
    },
    pagamento: pagamentoDoPreset("30/70"),
    observacoes,
  });
}

function documento(): DocumentoContrato {
  return montarContrato(dados(), CTX).documento;
}

function copia(doc: DocumentoContrato): DocumentoContrato {
  return structuredClone(doc);
}

// --------------------------------------------------------- texto resolvido --

test("texto resolvido: {{n}} e {{ref:x}} viram numeros, o negrito fica", () => {
  const doc = documento();
  const r = textoResolvido(doc);
  assert.deepEqual(
    r.clausulas.map((c) => c.numero),
    doc.clausulas.map((_, i) => i + 1),
  );
  const direitos = r.clausulas.find((c) => c.id === "direitos")!;
  assert.ok(direitos.paragrafos[0].startsWith(`${direitos.numero}.1. `));
  assert.equal(direitos.cabecalho, `CLÁUSULA ${direitos.numero} - DOS DIREITOS AUTORAIS E AUTORIZAÇÃO DE IMAGEM`);
  assert.ok(direitos.paragrafos[1].includes("**"), "negrito continua marcado");
  const armazenamento = r.clausulas.find((c) => c.id === "armazenamento")!;
  assert.ok(armazenamento.paragrafos[1].endsWith(`nos termos da Cláusula ${direitos.numero}.`));
  assert.ok(!JSON.stringify(r).includes("{{"));
});

test("texto resolvido lanca quando uma remissao aponta para clausula removida", () => {
  const doc = copia(documento());
  doc.clausulas = doc.clausulas.filter((c) => c.id !== "direitos");
  assert.throws(() => textoResolvido(doc), ReferenciaInvalidaError);
});

test("texto corrido sem uma clausula nao renumera as outras", () => {
  const doc = documento();
  const sem = textoCorrido(doc, { semClausulas: ["pagamento"], comNegrito: false });
  assert.ok(!sem.includes("DO PAGAMENTO"));
  assert.ok(sem.includes("CLÁUSULA 7 - DA PLATAFORMA DE ENTREGA"), "a numeracao continua a do documento");
  assert.ok(!sem.includes("**"));
  const assinaturas = sem.split("\n\n").at(-1)!;
  assert.ok(assinaturas.startsWith("CONTRATANTE: Helena Duarte Campos, CPF: 222.333.666-38"));
  assert.ok(!assinaturas.includes("@"), "o e-mail do bloco de assinaturas e so para a plataforma, nao e impresso");
});

// --------------------------------------------------------- validar documento --

test("documento montado pelo sistema e valido", () => {
  assert.deepEqual(validarDocumento(documento()), []);
});

test("clausula obrigatoria removida e remissao quebrada sao acusadas em frases humanas", () => {
  const doc = copia(documento());
  doc.clausulas = doc.clausulas.filter((c) => c.id !== "pagamento");
  const problemas = validarDocumento(doc);
  assert.ok(problemas.includes("Falta a cláusula obrigatória “DO PAGAMENTO”."));
  assert.ok(
    problemas.some((p) => p.includes("remete à cláusula “DO PAGAMENTO”, que não está no contrato ({{ref:pagamento}})")),
  );
});

test("id repetido, negrito sem par e marcacao sobrando sao acusados", () => {
  const doc = copia(documento());
  doc.clausulas.push({ ...doc.clausulas[0] });
  const alteracoes = doc.clausulas.find((c) => c.id === "alteracoes")!;
  alteracoes.paragrafos = ["**Texto sem fechar o negrito.", "Olá {{nome}} e [CPF], veja {{ref:foro"];
  const problemas = validarDocumento(doc);
  assert.ok(problemas.includes("A cláusula “DO OBJETO DO CONTRATO” aparece mais de uma vez."));
  assert.ok(problemas.some((p) => p.includes("há um ** sem par")));
  assert.ok(problemas.some((p) => p.endsWith("marcação que sobrou no texto: {{nome}}")));
  assert.ok(problemas.some((p) => p.endsWith("marcação que sobrou no texto: [CPF]")));
  assert.ok(problemas.some((p) => p.includes("{{ref:foro")));
});

test("titulo vazio, clausula sem texto e {{n}} fora de clausula sao acusados", () => {
  const doc = copia(documento());
  doc.titulo = "  ";
  doc.clausulas[1].paragrafos = ["  "];
  doc.preambulo += " {{n}}";
  const problemas = validarDocumento(doc);
  assert.ok(problemas.includes("O contrato está sem título."));
  assert.ok(problemas.includes("Cláusula 2 (“DO LOCAL, DATA E HORÁRIO DO EVENTO”): está sem texto."));
  assert.ok(problemas.includes("Preâmbulo: {{n}} só vale dentro de uma cláusula."));
});

test("clausula livre da Mel e aceita; sem a CONTRATADA nas assinaturas, nao", () => {
  const doc = copia(documento());
  doc.clausulas.splice(3, 0, {
    id: "livre-1",
    titulo: "DO FIGURINO",
    paragrafos: ["A CONTRATADA usará roupa preta, nos termos da Cláusula {{ref:objeto}}."],
    origem: "editada",
    problemas: [],
  });
  assert.deepEqual(validarDocumento(doc), []);
  assert.equal(ehClausulaDoModelo("livre-1"), false);
  assert.equal(ehClausulaDoModelo("foro"), true);

  doc.assinaturas = doc.assinaturas.filter((a) => a.papel !== "contratada");
  assert.ok(validarDocumento(doc).includes("Falta a assinatura da CONTRATADA."));
});

// -------------------------------------------------------------- texto da IA --

test("texto da IA limpo, com numeros que ja estao no contrato, passa", () => {
  const d = dados();
  const problemas = validarTextoIa(
    [
      "A cobertura, de até 5 (cinco) horas, começará às 17h do dia 12 de junho de 2027.",
      "**A CONTRATANTE informará o local com antecedência.**",
    ],
    d,
    documento(),
  );
  assert.deepEqual(problemas, []);
});

test("numero que a IA inventou e acusado; o mesmo numero nas observacoes libera", () => {
  const doc = documento();
  const texto = ["O vídeo extra, de R$ 380,00, será entregue em até 45 (quarenta e cinco) dias úteis."];
  const sem = validarTextoIa(texto, dados(), doc);
  assert.equal(sem.length, 1);
  assert.equal(
    sem[0],
    "O texto cita “R$ 380,00”, “45 (quarenta e cinco) dias”, que não aparecem no restante do contrato, nos dados preenchidos nem nas observações. " +
      "Confira de onde vieram: todo número e toda data precisam ter origem, e com a mesma unidade (“10%” não se prova com “10 dias”).",
  );

  // "R$ 380" nas observacoes e "380,00" no texto sao o mesmo numero; 45 dias tambem esta la
  const com = validarTextoIa(texto, dados("Vídeo extra fechado em R$ 380, entrega em 45 dias úteis."), doc);
  assert.deepEqual(com, []);
});

test("a Mel anota o valor sem o R$: o numero solto nas observacoes prova o valor em reais", () => {
  const texto = ["O vídeo extra, de R$ 380,00 (trezentos e oitenta reais), será entregue junto com o material bruto."];
  assert.deepEqual(validarTextoIa(texto, dados("Vídeo extra fechado em 380."), documento()), []);
});

test("valores em formatos diferentes contam como o mesmo numero", () => {
  const doc = documento();
  // 1.490,00 e o valor do pacote; "1490 reais", "R$ 1.490" e o extenso sao ele
  assert.deepEqual(validarTextoIa(["Valor de 1490 reais, ou R$ 1.490, ou mil quatrocentos e noventa reais."], dados(), doc), []);
});

test("a propria clausula de condicoes especiais nao serve de prova para os numeros dela", () => {
  const d = dados("Pedido especial.");
  const texto = ["A CONTRATADA fará 7 (sete) vídeos a mais, pelo valor de R$ 999,00."];
  const doc = montarContrato(d, CTX, texto).documento;
  const problemas = validarTextoIa(texto, d, doc);
  assert.ok(problemas.some((p) => p.includes("“R$ 999,00”")));
});

test("numero vale com a unidade: '10%' nao se prova com os '10 (dez) dias' do contrato", () => {
  const doc = documento();
  assert.ok(textoCorrido(doc).includes("10 (dez) dias"), "o contrato tem 10 dias");
  const problemas = validarTextoIa(["A CONTRATANTE pagará 10% (dez por cento) do valor total a título de taxa."], dados(), doc);
  assert.equal(problemas.length, 1);
  assert.ok(problemas[0].startsWith("O texto cita “10% (dez por cento)”, que não aparece"));
  // 30% existe (sinal): o mesmo percentual passa
  assert.deepEqual(validarTextoIa(["O sinal de 30% (trinta por cento) segue a cláusula do pagamento."], dados(), doc), []);
});

test("cabecalho 'CLÁUSULA N' e numeracao de item nao sao origem de numero", () => {
  const doc = documento();
  assert.ok(doc.clausulas.length >= 14, "o contrato tem pelo menos 14 clausulas");
  const problemas = validarTextoIa(["A equipe terá 14 (catorze) integrantes."], dados(), doc);
  assert.ok(problemas.some((p) => p.includes("“14 (catorze)”")), problemas.join(" | "));
});

test("numero por extenso tem de ter origem como o numero em digitos", () => {
  const doc = documento();
  for (const [texto, citado] of [
    ["A hora excedente será cobrada à razão de trezentos reais por hora.", "trezentos reais"],
    ["O valor adicional de mil e quinhentos reais será pago na véspera.", "mil e quinhentos reais"],
    ["O pagamento via PIX será feito em até quinze dias.", "quinze dias"],
    ["A CONTRATANTE pagará dez por cento do valor total.", "dez por cento"],
  ]) {
    const problemas = validarTextoIa([texto], dados(), doc);
    assert.ok(problemas.some((p) => p.startsWith(`O texto cita “${citado}”`)), `${citado}: ${problemas.join(" | ")}`);
  }
  // "uma"/"um" sozinhos sao artigo
  assert.deepEqual(validarTextoIa(["A CONTRATADA fará uma pausa e um registro da entrada."], dados(), doc), []);
});

test("data e conferida como data: '10/12' nao se prova com um 10 e um 12 soltos", () => {
  const doc = documento();
  const problemas = validarTextoIa(["A CONTRATANTE enviará a lista de convidados até 10/12."], dados(), doc);
  assert.ok(problemas.some((p) => p.startsWith("O texto cita “10/12”")), problemas.join(" | "));
  // a data do evento, com ou sem o ano, tem origem
  assert.deepEqual(validarTextoIa(["A lista será enviada até 12/06, e o evento é em 12 de junho de 2027."], dados(), doc), []);
  // a Mel anotou sem o ano; a IA completou com o ano do contrato, como o prompt pede
  const obs = dados("A noiva manda a lista dia 10/03.");
  assert.deepEqual(validarTextoIa(["A CONTRATANTE enviará a lista em 10 de março de 2027."], obs, doc), []);
  assert.ok(validarTextoIa(["A CONTRATANTE enviará a lista em 10 de março de 2031."], obs, doc).some((p) => p.includes("“10 de março de 2031”")));
});

test("digito e extenso que nao batem sao acusados", () => {
  const problemas = validarTextoIa(["A cobertura terá 5 (duas) horas."], dados(), documento());
  assert.ok(problemas.includes("Em “5 (duas)”, o número e o extenso entre parênteses não batem. Corrija um dos dois."));
});

test("trechos vedados sao acusados, com o motivo, com ou sem acento e em qualquer caixa", () => {
  const casos: [string, string][] = [
    ["A CONTRATADA NÃO SE RESPONSABILIZA por atrasos.", "não se responsabiliza"],
    ["A CONTRATADA não será responsável por falhas de conexão durante o evento.", "não será responsável"],
    ["A CONTRATADA fica eximida de qualquer responsabilidade por perda de arquivos.", "exime / exonera"],
    ["A CONTRATADA fica isenta de qualquer responsabilidade.", "isenta de responsabilidade"],
    ["Em caso de chuva, sem direito a reembolso.", "sem direito a reembolso"],
    ["Os valores pagos não serão devolvidos.", "não será devolvido"],
    ["Não haverá devolução de valores.", "não haverá devolução"],
    ["Cancelando, a CONTRATANTE perderá os valores pagos.", "perderá"],
    ["O atraso gera MULTA sobre a parcela.", "multa"],
    ["Sobre a parcela em atraso incidem juros.", "juros"],
    ["O contrato será rescindido de pleno direito.", "de pleno direito"],
    ["O contrato se encerra independentemente de notificação.", "independentemente de notificação"],
    ["A data não muda em nenhuma hipótese.", "em nenhuma hipótese"],
    ["Fica eleito o foro da Comarca de São Paulo/SP.", "foro"],
    ["Os valores poderão ser reajustados pela CONTRATADA conforme sua conveniência.", "reajuste"],
    ["A CONTRATANTE renuncia ao direito de reclamar por vícios do serviço.", "renúncia"],
    ["Conflitos serão resolvidos por arbitragem.", "arbitragem"],
    ["Cabe à CONTRATANTE o onus da prova.", "ônus da prova"],
    ["O horário pode mudar a critério exclusivo da CONTRATADA.", "a critério exclusivo da CONTRATADA"],
    ["O preço pode ser alterado unilateralmente.", "unilateralmente"],
  ];
  for (const [texto, rotulo] of casos) {
    const problemas = validarTextoIa([texto], dados(), documento());
    const achado = problemas.find((p) => p.startsWith(`Trecho que não pode ficar no contrato: “${rotulo}”. `));
    assert.ok(achado, `vedado: ${rotulo} (${problemas.join(" | ")})`);
    assert.ok(achado.endsWith(" Edite a cláusula e tire o trecho."));
    assert.ok(achado.length > 120, `o motivo vai junto: ${achado}`);
  }
});

test("o que protege a CONTRATANTE nao e confundido com trecho vedado", () => {
  for (const texto of [
    "A pedido da CONTRATANTE, a CONTRATADA não publicará nos stories da festa imagens em que o pai do noivo apareça.",
    "A hora adicional ficará isenta de cobrança.",
    "O storymaker auxiliar chegará ao local antes do início da cerimônia para captar imagens do espaço.",
  ]) {
    assert.deepEqual(validarTextoIa([texto], dados(), documento()), [], texto);
  }
});

test("os quatro paragrafos abusivos do achado TXT-04 bloqueiam a clausula (e o PDF)", () => {
  const d = dados("cliente pediu para fechar assim");
  const paragrafos = [
    "**Em caso de cancelamento com menos de 30 (trinta) dias do evento, a CONTRATANTE perderá 70% (setenta por cento) dos valores pagos.**",
    "**O atraso de qualquer parcela implicará multa de 10% (dez por cento) e o contrato será rescindido de pleno direito, independentemente de notificação.**",
    "Os valores pagos não serão devolvidos em nenhuma hipótese.",
    "A hora excedente será cobrada à razão de trezentos reais por hora.",
  ];
  const doc = montarContrato(d, CTX, paragrafos).documento;
  const problemas = doc.clausulas.find((c) => c.id === "condicoes_especiais")!.problemas;
  for (const esperado of [
    "“perderá”",
    "“multa”",
    "“de pleno direito”",
    "“independentemente de notificação”",
    "“não será devolvido”",
    "“em nenhuma hipótese”",
    "“10% (dez por cento)”",
    "“trezentos reais”",
    "“30 (trinta) dias”",
  ]) {
    assert.ok(problemas.some((p) => p.includes(esperado)), `faltou ${esperado}: ${problemas.join(" | ")}`);
  }
});

test("marcadores e chaves que sobraram, e negrito sem par, sao acusados", () => {
  const problemas = validarTextoIa(
    ["[CONTRATANTE] autoriza, e o [nome da mãe] também, {{ref:objeto}}.", "**Sem fechar."],
    dados(),
    documento(),
  );
  assert.ok(problemas.some((p) => p.startsWith("Sobrou marcação no texto:") && p.includes("[CONTRATANTE]") && p.includes("[nome da mãe]") && p.includes("{{ref:objeto}}")));
  assert.ok(problemas.includes("O parágrafo 2 tem um ** sem par."));
});

test("marcador repetido e 'a CONTRATANTE a CONTRATANTE' sao acusados: era nome de lugar", () => {
  const repetido = validarTextoIa(["A equipe chegará à Chácara Santa [CONTRATANTE] [CONTRATANTE]."], dados(), documento());
  assert.ok(repetido.some((p) => p.startsWith("O texto repete “[CONTRATANTE] [CONTRATANTE]”.")), repetido.join(" | "));
  assert.ok(!repetido.some((p) => p.startsWith("Sobrou marcação")), "um problema so, com a explicacao certa");

  const papel = validarTextoIa(["A equipe chegará à Chácara Santa a CONTRATANTE a CONTRATANTE."], dados(), documento());
  assert.ok(papel.some((p) => p.startsWith("O texto repete “a CONTRATANTE a CONTRATANTE”.")), papel.join(" | "));

  // papeis diferentes lado a lado sao texto normal
  assert.deepEqual(validarTextoIa(["Cabe à CONTRATANTE e à CONTRATADA combinar o roteiro."], dados(), documento()), []);
});

test("mais de 8 paragrafos ou paragrafo longo demais sao acusados", () => {
  const muitos = Array.from({ length: 9 }, () => "A CONTRATADA seguirá o roteiro do dia.");
  assert.ok(validarTextoIa(muitos, dados(), documento()).some((p) => p.startsWith("A cláusula tem 9 parágrafos; o máximo é 8.")));

  const longo = "palavra ".repeat(200).trim();
  assert.ok(longo.length > MAXIMO_CARACTERES_PARAGRAFO_IA);
  assert.ok(
    validarTextoIa([longo], dados(), documento()).some((p) =>
      p.startsWith(`O parágrafo 1 tem ${longo.length} caracteres; o máximo é 1.500.`),
    ),
  );
});

// ---------------------------------------------------------- normalizacao --

test("normalizarComMapa: sem acento e minusculo, com o caminho de volta para o original", () => {
  const original = "Ação JOÃO e Jose\u0301";
  const n = normalizarComMapa(original);
  assert.equal(n.texto, "acao joao e jose");
  const ini = n.texto.indexOf("joao");
  assert.equal(original.slice(n.inicio[ini], n.fim[ini + 3]), "JOÃO");
  // acento solto (texto ja em NFD) fica com a letra: a troca nao deixa o acento orfao
  const jose = n.texto.indexOf("jose");
  assert.equal(original.slice(n.inicio[jose], n.fim[jose + 3]), "Jose\u0301");
});
