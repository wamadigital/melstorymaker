import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMPLATES, type Categoria, type TemplateId } from "@/lib/form/types";
import { dadosContratoSchema, documentoContratoSchema, type DadosContrato, type DocumentoContrato } from "./tipos";
import { adicionalDoCatalogo, ADICIONAL_LOCOMOCAO, catalogoDaArte, novoAdicional, pacoteDoCatalogo, precoPacote } from "./catalogo";
import { calcularParcelas, pagamentoDoPreset } from "./pagamento";
import { numeroPorExtenso, percentualComExtenso, reaisPorExtenso } from "./extenso";
import { PARAGRAFO_MAKING_OFS_ALTERNADOS, PARAGRAFO_UNICO_CONDICOES_ESPECIAIS } from "./clausulas";
import { sanitizarPdf } from "./texto";
import { textoCorrido, textoResolvido, validarDocumento } from "./validar";
import {
  CamposFaltandoContratoError,
  anuenteEhHomenageado,
  avisosDeterministicos,
  escopoEfetivo,
  faltantes,
  mesmaPessoa,
  montarContrato,
  totalContrato,
  totalDeTabela,
  type ContextoMontagem,
} from "./montar";

// ------------------------------------------------------------- fixtures --
//
// Tudo FICTICIO. Os CPFs e o CNPJ foram gerados para passar no digito
// verificador e nao sao de ninguem; nomes, e-mails e enderecos sao inventados.

const HOJE = "2026-09-29";
const CPF_CONTRATANTE = "12345678909";
const CPF_ANUENTE = "98765432100";
const CPF_REPRESENTANTE = "31415926590";
const CNPJ_EMPRESA = "11222333000181";

const HOMENAGEADO: Record<TemplateId, string> = {
  casamento: "Ana e João",
  debutante: "Maria Eduarda",
  aniversario_infantil: "Pedro Henrique",
  aniversario_adulto: "Carla",
  corporativo: "Alfa Eventos",
};

function categoriaDe(t: TemplateId): Categoria {
  return t === "aniversario_infantil" || t === "aniversario_adulto" ? "aniversario" : t;
}

function contextoDe(t: TemplateId, extra: Partial<ContextoMontagem> = {}): ContextoMontagem {
  const idade = t === "aniversario_infantil" ? 10 : t === "aniversario_adulto" ? 30 : t === "debutante" ? 15 : null;
  return { categoria: categoriaDe(t), templateId: t, idadeHomenageado: idade, hojeISO: HOJE, ...extra };
}

type Parcial = { [k: string]: unknown };

function mesclar(base: unknown, extra: unknown): unknown {
  if (Array.isArray(extra) || typeof extra !== "object" || extra === null) return extra;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return extra;
  const saida: Parcial = { ...(base as Parcial) };
  for (const [k, v] of Object.entries(extra as Parcial)) saida[k] = k in saida ? mesclar(saida[k], v) : v;
  return saida;
}

const PESSOA_FISICA = {
  nome: "Ana Paula Rocha",
  genero: "feminino",
  cpf: CPF_CONTRATANTE,
  email: "ana.rocha@exemplo.com.br",
  telefone: "19998765432",
  endereco: {
    logradouro: "Rua das Acácias",
    numero: "120",
    complemento: "Apto. 12",
    bairro: "Jardim Primavera",
    cidade: "Campinas",
    uf: "SP",
    cep: "13000000",
  },
};

const PESSOA_JURIDICA = {
  razaoSocial: "Alfa Eventos Ltda.",
  cnpj: CNPJ_EMPRESA,
  endereco: {
    logradouro: "Alameda Santos",
    numero: "200",
    complemento: "Sala 5",
    bairro: "Cambuí",
    cidade: "Campinas",
    uf: "SP",
    cep: "13024000",
  },
  representante: {
    nome: "Roberto Alves",
    genero: "masculino",
    cpf: CPF_REPRESENTANTE,
    cargo: "sócio-administrador",
    email: "roberto@alfa-eventos.com.br",
    telefone: "1932101234",
  },
};

const ANUENTE_NOIVO = {
  ativo: true,
  nome: "João Pedro Lima",
  genero: "masculino",
  cpf: CPF_ANUENTE,
  email: "joao.lima@exemplo.com.br",
  papel: "noivo",
};

/** Contrato completo e valido para a arte e o pacote; `extra` sobrescreve por mescla. */
function dadosDe(t: TemplateId, pacote: string, extra: Parcial = {}): DadosContrato {
  const doCatalogo = pacoteDoCatalogo(t, pacote);
  assert.ok(doCatalogo, `pacote ${pacote} existe em ${t}`);
  const menor = t === "debutante" || t === "aniversario_infantil";
  const base = {
    contratante: {
      tipo: t === "corporativo" ? "pj" : "pf",
      pf: PESSOA_FISICA,
      pj: PESSOA_JURIDICA,
      vinculo: menor ? "mãe" : "",
    },
    evento: {
      data: "2027-03-20",
      horarioInicio: "19:30",
      homenageado: HOMENAGEADO[t],
      tipoEvento: t === "corporativo" ? "Lançamento de coleção" : "",
      locais: [{ rotulo: "Local do evento", endereco: "Buffet Estrela, Rua Um, 10, Vila Nova, Campinas/SP" }],
      makingOfLocal: "",
      makingOfHorario: "",
      alimentacao: true,
    },
    servico: {
      tabela: "2027",
      pacote,
      valorPacote: precoPacote(t, "2027", pacote) ?? 120000,
      escopo: doCatalogo.escopo,
      adicionais: [],
      desconto: 0,
    },
    pagamento: pagamentoDoPreset("30/70"),
  };
  return dadosContratoSchema.parse(mesclar(base, extra));
}

function adicional(t: TemplateId, id: string, pacote = "", extra: Parcial = {}) {
  const item = adicionalDoCatalogo(t, id);
  assert.ok(item, `adicional ${id} existe em ${t}`);
  return { ...novoAdicional(item, pacote, "2027"), ...extra };
}

// ------------------------------------------------------- conferencia geral --

/** "R$ 1.234,56" -> 123456 */
function centavosDe(valor: string): number {
  return Number(valor.replace(/\./g, "").replace(",", ""));
}

/**
 * O que TODO contrato montado precisa cumprir, qualquer que seja o cenario:
 * schema, validacao, numeracao sem buraco, remissoes resolvidas, nenhum
 * "undefined"/"NaN"/"null"/"{{", extenso de todo valor e de toda quantidade
 * batendo com o numero, parcelas somando o total.
 */
function conferirDocumento(documento: DocumentoContrato, dados: DadosContrato): string {
  documentoContratoSchema.parse(documento);
  assert.deepEqual(validarDocumento(documento), [], "documento valido");

  const resolvido = textoResolvido(documento);
  assert.deepEqual(
    resolvido.clausulas.map((c) => c.numero),
    documento.clausulas.map((_, i) => i + 1),
    "numeracao sequencial",
  );
  assert.equal(new Set(documento.clausulas.map((c) => c.id)).size, documento.clausulas.length, "ids unicos");

  const texto = textoCorrido(documento);
  for (const proibido of ["undefined", "NaN", "null", "{{", "}}", "  ", " ,", " .", ",,", "..", "[", "]"]) {
    assert.ok(!texto.includes(proibido), `texto sem "${proibido}"`);
  }

  // remissoes apontam para clausulas que existem
  for (const m of texto.matchAll(/Cláusula (\d+)/g)) {
    const n = Number(m[1]);
    assert.ok(n >= 1 && n <= documento.clausulas.length, `remissao para a Cláusula ${n} existe`);
  }

  // todo paragrafo termina pontuado
  for (const c of resolvido.clausulas) {
    for (const p of c.paragrafos) assert.match(p.replace(/\*+$/, ""), /[.;:]$/, `paragrafo pontuado em ${c.id}`);
  }

  // e so usa caracteres que a fonte do PDF desenha: o sanitizador nao tem o que mudar
  const trechos = [
    resolvido.titulo,
    resolvido.preambulo,
    resolvido.localData,
    ...resolvido.partes.map((p) => p.texto),
    ...resolvido.clausulas.flatMap((c) => [c.cabecalho, ...c.paragrafos]),
    ...resolvido.assinaturas.flatMap((a) => [a.rotulo, a.nome, a.documento]),
  ];
  for (const t of trechos) assert.equal(sanitizarPdf(t), t, "texto ja nasce desenhavel pela DM Sans");

  // todo valor em R$ vem com o extenso certo
  let valores = 0;
  for (const m of texto.matchAll(/R\$ ([\d.]+,\d{2}) \(([^)]+)\)/g)) {
    assert.equal(m[2], reaisPorExtenso(centavosDe(m[1])), `extenso de R$ ${m[1]}`);
    valores++;
  }
  assert.ok(valores >= 2, "o contrato tem valores com extenso");

  // toda quantidade "N (extenso)" confere, no masculino ou no feminino
  const semDinheiro = texto.replace(/R\$ [\d.]+,\d{2} \([^)]+\)/g, "");
  for (const m of semDinheiro.matchAll(/(?<![\d.,/])(\d+) \(([a-zçãéêíóôúõâ ]+)\)/g)) {
    const n = Number(m[1]);
    assert.ok(
      [numeroPorExtenso(n), numeroPorExtenso(n, "feminino")].includes(m[2]),
      `extenso de ${n}: "${m[2]}"`,
    );
  }

  // percentuais com o extenso certo
  for (const m of texto.matchAll(/(\d+(?:,\d+)?)% \(([^)]+)\)/g)) {
    const p = Number(m[1].replace(",", "."));
    assert.equal(`${m[1]}% (${m[2]})`, percentualComExtenso(p));
  }

  // o total escrito e o total calculado, e as parcelas somam o total
  const total = totalContrato(dados.servico);
  const pagamento = resolvido.clausulas.find((c) => c.id === "pagamento");
  assert.ok(pagamento);
  const totalEscrito = /valor total dos serviços prestados (?:será|é) de R\$ ([\d.]+,\d{2})/.exec(pagamento.paragrafos[0]);
  assert.ok(totalEscrito, "total escrito na clausula do pagamento");
  assert.equal(centavosDe(totalEscrito[1]), total);

  if (dados.pagamento.modo === "parcelas") {
    const itens = pagamento.paragrafos.filter((p) => /^[A-Z]\. /.test(p));
    assert.equal(itens.length, dados.pagamento.parcelas.length, "um item por parcela");
    const escritos = itens.map((p) => centavosDe(/equivalente a R\$ ([\d.]+,\d{2})/.exec(p)![1]));
    assert.deepEqual(
      escritos,
      calcularParcelas(total, dados.pagamento.parcelas).map((p) => p.valor),
      "parcelas iguais as do pagamento.ts",
    );
    assert.equal(
      escritos.reduce((s, v) => s + v, 0),
      total,
      "parcelas somam o total",
    );
    assert.ok(itens.at(-1)!.endsWith("."), "ultima parcela termina em ponto");
    itens.slice(0, -1).forEach((p) => assert.ok(p.endsWith(";"), "parcelas do meio terminam em ponto e virgula"));
  }

  return texto;
}

function ids(documento: DocumentoContrato): string[] {
  return documento.clausulas.map((c) => c.id);
}

function clausulaResolvida(documento: DocumentoContrato, id: string) {
  const c = textoResolvido(documento).clausulas.find((x) => x.id === id);
  assert.ok(c, `clausula ${id} presente`);
  return c;
}

// --------------------------------------------------------- arte x pacote --

test("todo pacote de toda arte (e o personalizado) monta um contrato completo e conferido", () => {
  let cenarios = 0;
  for (const t of TEMPLATES) {
    for (const { nome } of catalogoDaArte(t).pacotes) {
      const dados = dadosDe(t, nome);
      const { documento } = montarContrato(dados, contextoDe(t));
      const texto = conferirDocumento(documento, dados);

      const objeto = clausulaResolvida(documento, "objeto").paragrafos[0];
      if (nome === "Personalizado") {
        assert.ok(objeto.startsWith("O presente contrato tem por objeto a prestação de serviços de storymaker, consistindo"));
      } else {
        assert.ok(objeto.includes(`storymaker, no ${nome}, consistindo`), `${t}/${nome}: pacote no objeto`);
      }
      assert.ok(texto.includes(HOMENAGEADO[t]), "homenageado no objeto");
      assert.equal(ids(documento).includes("adicionais"), false, "sem adicionais, sem a clausula");
      cenarios++;
    }
  }
  // 14 pacotes das artes + 1 personalizado por arte
  assert.equal(cenarios, 14 + TEMPLATES.length);
});

test("a ordem das clausulas segue o modelo e a numeracao fica continua sem os adicionais", () => {
  const dados = dadosDe("casamento", "Pacote Principal");
  const { documento } = montarContrato(dados, contextoDe("casamento"));
  assert.deepEqual(ids(documento), [
    "objeto",
    "local",
    "servicos",
    "prazos",
    "instagram",
    "pagamento",
    "entrega",
    "armazenamento",
    "direitos",
    "alimentacao",
    "alteracoes",
    "desistencia",
    "equipe",
    "assinatura_eletronica",
    "foro",
  ]);
  const texto = conferirDocumento(documento, dados);
  // as remissoes acompanham a numeracao: pagamento e a 6ª, equipe a 13ª, direitos a 9ª
  assert.ok(texto.includes("o sinal previsto na Cláusula 6 não será reembolsado"));
  assert.ok(texto.includes("fora das hipóteses da Cláusula 13,"));
  assert.ok(texto.includes("nos termos da Cláusula 9."));
  assert.ok(!texto.includes("serviços adicionais descritos"), "objeto sem remissao aos adicionais");
});

// -------------------------------------------------------------- PF e PJ --

test("pessoa fisica: qualificacao completa, assinatura com CPF e foro no domicilio da CONTRATANTE", () => {
  const dados = dadosDe("aniversario_adulto", "Pacote Premium");
  const { documento } = montarContrato(dados, contextoDe("aniversario_adulto"));
  conferirDocumento(documento, dados);

  assert.deepEqual(
    documento.partes.map((p) => p.rotulo),
    ["CONTRATANTE", "CONTRATADA"],
  );
  assert.equal(
    documento.partes[0].texto,
    "Ana Paula Rocha, brasileira, inscrita no CPF sob o nº 123.456.789-09, residente e domiciliada na Rua das Acácias, 120, Apto. 12, Jardim Primavera, Campinas/SP, CEP 13000-000, com endereço eletrônico ana.rocha@exemplo.com.br, que declara ser maior de 18 (dezoito) anos e plenamente capaz para os atos da vida civil.",
  );
  assert.deepEqual(documento.assinaturas[0], {
    papel: "contratante",
    rotulo: "CONTRATANTE",
    nome: "Ana Paula Rocha",
    documento: "CPF: 123.456.789-09",
    email: "ana.rocha@exemplo.com.br",
  });
  assert.equal(
    clausulaResolvida(documento, "foro").paragrafos[0],
    "As partes elegem o foro da comarca do domicílio da CONTRATANTE para dirimir judicialmente as controvérsias inerentes ao presente contrato. E, por estarem assim justas e contratadas, as partes assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito.",
  );
  assert.ok(documento.preambulo.includes("denominadas simplesmente CONTRATANTE e CONTRATADA, têm entre si"), "sem anuente, duas partes");
});

test("pessoa juridica: razao social, representante, licenca institucional e foro de Monte Mor/SP", () => {
  const dados = dadosDe("corporativo", "Pacote Premium");
  const { documento } = montarContrato(dados, contextoDe("corporativo"));
  conferirDocumento(documento, dados);

  assert.equal(
    documento.partes[0].texto,
    "Alfa Eventos Ltda., pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 11.222.333/0001-81, com sede na Alameda Santos, 200, Sala 5, Cambuí, Campinas/SP, CEP 13024-000, neste ato representada por Roberto Alves, sócio-administrador, inscrito no CPF sob o nº 314.159.265-90, que declara possuir poderes para firmar o presente instrumento, com endereço eletrônico roberto@alfa-eventos.com.br.",
  );
  assert.deepEqual(documento.assinaturas[0], {
    papel: "contratante",
    rotulo: "CONTRATANTE",
    nome: "Alfa Eventos Ltda.",
    documento: "CNPJ: 11.222.333/0001-81 — p. Roberto Alves, CPF: 314.159.265-90",
    email: "roberto@alfa-eventos.com.br",
  });

  const direitos = clausulaResolvida(documento, "direitos").paragrafos;
  assert.ok(direitos[0].includes("para fins institucionais e publicitários"));
  assert.ok(direitos[1].includes("a utilizar o material produzido no evento no portfólio"));
  assert.ok(direitos[1].includes("colaborações com a CONTRATANTE e com outros fornecedores"));
  assert.equal(direitos.length, 2, "sem a clausula de menores");

  assert.ok(
    clausulaResolvida(documento, "foro").paragrafos[0].startsWith(
      "As partes elegem o Foro da Comarca de Monte Mor/SP, domicílio da CONTRATADA, para dirimir judicialmente as controvérsias inerentes ao presente contrato, renunciando a qualquer outro, por mais privilegiado que seja.",
    ),
  );
  assert.ok(
    clausulaResolvida(documento, "objeto").paragrafos[0].includes("cobertura do evento corporativo “Lançamento de coleção” da empresa Alfa Eventos"),
  );
  assert.ok(
    clausulaResolvida(documento, "foro").paragrafos[0].endsWith(
      "E, por estarem assim justas e contratadas, as partes assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito.",
    ),
  );
});

test("corporativo e tempo real (como a arte promete), sem a sugestao de storymaker auxiliar", () => {
  for (const pacote of ["Pacote Pocket", "Pacote Premium", "Pacote Luxo"]) {
    const dados = dadosDe("corporativo", pacote);
    const { documento, avisos } = montarContrato(dados, contextoDe("corporativo"));
    conferirDocumento(documento, dados);
    assert.ok(ids(documento).includes("condicoes_tecnicas"), `${pacote}: clausula da internet e do tempo real`);
    assert.ok(!ids(documento).includes("prazos"), `${pacote}: sem 'em até 4 dias úteis' para os stories`);
    assert.ok(clausulaResolvida(documento, "servicos").paragrafos[0].includes("com captação, edição e publicação ao longo da cobertura"));
    assert.ok(!avisos.some((a) => a.texto.startsWith("A cobertura em tempo real costuma ter storymaker auxiliar")), pacote);
  }
});

// ---------------------------------------------------------------- anuente --

test("anuente entra como terceira parte e terceiro signatario, e autoriza a propria imagem", () => {
  const dados = dadosDe("casamento", "Pacote Principal", { anuente: ANUENTE_NOIVO });
  const { documento, avisos } = montarContrato(dados, contextoDe("casamento"));
  const texto = conferirDocumento(documento, dados);

  assert.deepEqual(
    documento.partes.map((p) => p.rotulo),
    ["CONTRATANTE", "CONTRATADA", "ANUENTE"],
  );
  assert.deepEqual(
    documento.assinaturas.map((a) => a.papel),
    ["contratante", "contratada", "anuente"],
  );
  const numeroDireitos = ids(documento).indexOf("direitos") + 1;
  assert.equal(
    textoResolvido(documento).partes[2].texto,
    `João Pedro Lima, brasileiro, inscrito no CPF sob o nº 987.654.321-00, com endereço eletrônico joao.lima@exemplo.com.br, noivo no evento, que intervém neste instrumento exclusivamente para autorizar o uso de sua imagem e voz, nos termos da Cláusula ${numeroDireitos}.`,
  );
  // O preambulo nomeia as tres partes, e a remissao resolve como a das partes.
  assert.equal(
    textoResolvido(documento).preambulo,
    `Pelo presente instrumento particular, as partes acima identificadas e qualificadas, doravante denominadas simplesmente CONTRATANTE, CONTRATADA e ANUENTE, esta última interveniente apenas para os fins da Cláusula ${numeroDireitos}, têm entre si justo e contratado o que segue, nos termos e condições abaixo:`,
  );
  const direitos = clausulaResolvida(documento, "direitos").paragrafos;
  assert.ok(direitos[1].startsWith(`${numeroDireitos}.2. **A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar sua imagem e voz, captadas no evento, no portfólio`));
  assert.equal(
    direitos[2],
    `${numeroDireitos}.3. **João Pedro Lima, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.**`,
  );
  assert.ok(!texto.includes("autoriza igualmente"));
  assert.ok(!avisos.some((a) => a.texto.includes("inclua-o(a) como anuente")), "com anuente, sem a sugestao");
});

// ---------------------------------------------------------- evento de menor --

test("debutante: quem contrata age como representante legal e a clausula protege a menor", () => {
  const dados = dadosDe("debutante", "Pacote Premium");
  const { documento } = montarContrato(dados, contextoDe("debutante"));
  conferirDocumento(documento, dados);

  assert.ok(
    documento.partes[0].texto.endsWith(
      "que declara ser maior de 18 (dezoito) anos e plenamente capaz para os atos da vida civil, e que contrata em nome próprio, na qualidade de mãe de Maria Eduarda, em cujo evento os serviços serão prestados.",
    ),
  );
  const direitos = clausulaResolvida(documento, "direitos").paragrafos;
  assert.ok(direitos[1].includes("a utilizar sua imagem e voz e, na qualidade de mãe e representante legal, a imagem e a voz de Maria Eduarda, captadas no evento"));
  assert.match(direitos[2], /^\d+\.3\. As publicações da CONTRATADA não incluirão informações que permitam localizar menores de idade retratados/);
});

test("aniversario de 10 anos: representacao pela CONTRATANTE, como na debutante", () => {
  const dados = dadosDe("aniversario_infantil", "Pacote Básico", { contratante: { vinculo: "Pai" } });
  const { documento, avisos } = montarContrato(dados, contextoDe("aniversario_infantil"));
  conferirDocumento(documento, dados);
  assert.ok(documento.partes[0].texto.includes("na qualidade de pai de Pedro Henrique"), "vinculo em minuscula no meio da frase");
  assert.ok(clausulaResolvida(documento, "direitos").paragrafos[1].includes("na qualidade de pai e representante legal, a imagem e a voz de Pedro Henrique"));
  assert.equal(avisos.filter((a) => a.clausula === "direitos").length, 0);
});

test("aniversario de 16 anos sem anuente: so a imagem da CONTRATANTE e aviso de atencao", () => {
  const dados = dadosDe("aniversario_adulto", "Pacote Pocket", {
    contratante: { vinculo: "mãe" },
    evento: { homenageado: "Lucas" },
  });
  const ctx = contextoDe("aniversario_adulto", { idadeHomenageado: 16 });
  const { documento, avisos } = montarContrato(dados, ctx);
  conferirDocumento(documento, dados);

  const direitos = clausulaResolvida(documento, "direitos").paragrafos;
  assert.ok(direitos[1].includes("a utilizar sua imagem e voz, captadas no evento"));
  assert.ok(!direitos[1].includes("representante legal"), "16 anos nao e representado");
  assert.equal(direitos.length, 3, "continua evento de menor");
  assert.ok(documento.partes[0].texto.includes("na qualidade de mãe de Lucas"));

  const aviso = avisos.find((a) => a.texto.startsWith("Aniversariante com 16 ou 17 anos"));
  assert.ok(aviso);
  assert.equal(aviso.gravidade, "atencao");
  assert.equal(aviso.origem, "sistema");
  assert.equal(aviso.clausula, "direitos");
});

test("aniversario de 17 anos com o aniversariante como anuente: assistido pela CONTRATANTE", () => {
  const dados = dadosDe("aniversario_adulto", "Pacote Pocket", {
    contratante: { vinculo: "mãe" },
    evento: { homenageado: "Lucas" },
    anuente: { ativo: true, nome: "Lucas Rocha Lima", genero: "masculino", cpf: CPF_ANUENTE, email: "lucas@exemplo.com.br", papel: "aniversariante" },
  });
  const { documento, avisos } = montarContrato(dados, contextoDe("aniversario_adulto", { idadeHomenageado: 17 }));
  conferirDocumento(documento, dados);
  const direitos = clausulaResolvida(documento, "direitos").paragrafos;
  assert.match(
    direitos[2],
    /^\d+\.3\. \*\*Lucas Rocha Lima, na qualidade de anuente, assistido pela CONTRATANTE, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz\.\*\*$/,
  );
  assert.match(direitos[3], /^\d+\.4\. As publicações da CONTRATADA não incluirão/, "o item dos menores vem depois do anuente");
  assert.ok(!avisos.some((a) => a.texto.startsWith("Aniversariante com 16 ou 17 anos")));
});

// ---------------------------------------------------------------- tempo real --

test("tempo real troca a clausula dos prazos pela das condicoes tecnicas", () => {
  const dados = dadosDe("casamento", "Pacote Real Time");
  const { documento } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);

  assert.ok(ids(documento).includes("condicoes_tecnicas"));
  assert.ok(!ids(documento).includes("prazos"));
  const tecnicas = clausulaResolvida(documento, "condicoes_tecnicas").paragrafos;
  assert.equal(tecnicas.length, 5);
  assert.ok(tecnicas[2].startsWith("**Na hipótese de instabilidade") && tecnicas[2].endsWith("após o evento.**"));
  assert.equal(
    tecnicas[4],
    "A CONTRATADA compromete-se, ainda, a entregar o Reels/Vídeo com o resumo do evento, bem como o material bruto captado, no prazo de até 7 (sete) dias úteis após a data do evento.",
  );
  assert.ok(clausulaResolvida(documento, "servicos").paragrafos[0].includes("com captação, edição e publicação ao longo da cobertura"));
  assert.ok(
    clausulaResolvida(documento, "objeto").paragrafos.includes(
      "A cobertura será realizada por equipe composta pela CONTRATADA e 1 (um) storymaker auxiliar.",
    ),
  );
  assert.ok(
    clausulaResolvida(documento, "alimentacao").paragrafos[0].includes("a CONTRATADA e 1 (um) profissional de sua equipe têm direito"),
  );
});

test("a entrega em tempo real como adicional tambem liga as condicoes tecnicas", () => {
  const dados = dadosDe("aniversario_adulto", "Pacote Premium", {
    servico: { adicionais: [adicional("aniversario_adulto", "aniversario_adulto.tempo_real", "Pacote Premium")] },
  });
  const { documento, avisos } = montarContrato(dados, contextoDe("aniversario_adulto"));
  conferirDocumento(documento, dados);
  assert.ok(ids(documento).includes("condicoes_tecnicas"));
  assert.ok(
    clausulaResolvida(documento, "adicionais").paragrafos.includes(
      "A. Entrega da cobertura de stories em tempo real, durante o evento, no valor de R$ 500,00 (quinhentos reais).",
    ),
  );
  assert.ok(avisos.some((a) => a.texto.startsWith("A cobertura em tempo real costuma ter storymaker auxiliar")));
});

// ------------------------------------------------------------- making ofs --

test("dois making ofs com uma profissional so: paragrafo da alternancia nos adicionais", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    servico: {
      adicionais: [
        adicional("casamento", "casamento.making_of_noiva", "Pacote Principal"),
        adicional("casamento", "casamento.making_of_noivo", "Pacote Principal"),
      ],
    },
  });
  const { documento } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);

  assert.deepEqual(clausulaResolvida(documento, "adicionais").paragrafos, [
    "Fica acordada a inclusão dos seguintes serviços adicionais à cobertura principal:",
    "A. Making of da noiva, com duração de até 2 (duas) horas, no valor de R$ 380,00 (trezentos e oitenta reais).",
    "B. Making of do noivo, com duração de até 2 (duas) horas, no valor de R$ 380,00 (trezentos e oitenta reais).",
    PARAGRAFO_MAKING_OFS_ALTERNADOS,
    "Os serviços adicionais integram o presente contrato para todos os fins, aplicando-se a eles as mesmas condições técnicas, operacionais e prazos aqui estabelecidos.",
  ]);
  assert.ok(
    clausulaResolvida(documento, "local").paragrafos.includes(
      "Tempo de serviço: 9 (nove) horas (4h de making of + 5h de cobertura do evento).",
    ),
  );
  assert.ok(
    clausulaResolvida(documento, "objeto").paragrafos.includes(
      "Integram também o objeto deste contrato os serviços adicionais descritos na Cláusula 4.",
    ),
  );
});

test("dois making ofs com storymaker auxiliar: sem o paragrafo da alternancia", () => {
  const dados = dadosDe("casamento", "Pacote Real Time", {
    servico: {
      adicionais: [
        adicional("casamento", "casamento.making_of_noiva", "Pacote Real Time"),
        adicional("casamento", "casamento.making_of_noivo", "Pacote Real Time"),
      ],
    },
  });
  const { documento } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);
  assert.ok(!clausulaResolvida(documento, "adicionais").paragrafos.includes(PARAGRAFO_MAKING_OFS_ALTERNADOS));
});

// ---------------------------------------------------------------- pagamento --

test("15/15/70 de R$ 1.290,00: cada parcela 'como parte do sinal', e a reserva da data so no resumo", () => {
  const pagamento = pagamentoDoPreset("15/15/70");
  pagamento.parcelas[1].vencimento = { tipo: "data", data: "2026-11-10" };
  const dados = dadosDe("casamento", "Pacote Principal", { servico: { tabela: "2026", valorPacote: 129000 }, pagamento });
  const { documento } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);

  // As duas parcelas de 15% continuam sendo sinal (a C03: lido contra quem
  // redigiu, so a primeira como "entrada" baixava a retencao para 15%). O que
  // sai de cada parcela e o "para garantir a reserva da data", que fazia a
  // CONTRATANTE ler a data reservada ja na parcela A.
  assert.deepEqual(clausulaResolvida(documento, "pagamento").paragrafos, [
    "O valor total dos serviços prestados será de R$ 1.290,00 (mil duzentos e noventa reais). O pagamento será realizado da seguinte forma:",
    "A. 15% (quinze por cento) do valor total, equivalente a R$ 193,50 (cento e noventa e três reais e cinquenta centavos), como parte do sinal, a ser pago na assinatura deste contrato;",
    "B. 15% (quinze por cento) do valor total, equivalente a R$ 193,50 (cento e noventa e três reais e cinquenta centavos), como parte do sinal, com vencimento em 10 de novembro de 2026;",
    "C. 70% (setenta por cento) do valor total, equivalente a R$ 903,00 (novecentos e três reais), a ser pago até 10 (dez) dias antes da data do evento.",
    "O sinal destinado a garantir a reserva da data corresponde à soma das parcelas acima identificadas como parte do sinal, no total de R$ 387,00 (trezentos e oitenta e sete reais), e **a reserva da data somente será garantida após a confirmação do pagamento integral do sinal.**",
    "Todos os pagamentos deverão ser realizados via PIX, utilizando a chave PIX (CNPJ): 53.925.833/0001-20.",
  ]);
});

test("pagamento ja quitado: valor total pago, quitacao e a parte que e sinal", () => {
  const dados = dadosDe("debutante", "Pacote Básico", {
    servico: { adicionais: [adicional("debutante", "debutante.trend", "Pacote Básico")] },
    pagamento: { modo: "quitado", parcelas: [], quitadoEm: "2026-09-01", percentualSinalQuitado: 30 },
  });
  const { documento } = montarContrato(dados, contextoDe("debutante"));
  conferirDocumento(documento, dados);
  assert.deepEqual(clausulaResolvida(documento, "pagamento").paragrafos, [
    "O valor total dos serviços prestados é de R$ 1.440,00 (mil quatrocentos e quarenta reais), já incluído o serviço adicional, integralmente pago pela CONTRATANTE via PIX em 1º de setembro de 2026, dando a CONTRATADA plena quitação.",
    "Do valor pago, 30% (trinta por cento), equivalente a R$ 432,00 (quatrocentos e trinta e dois reais), corresponde ao sinal para garantir a reserva da data.",
  ]);
});

test("sinal ja pago numa parcela: a reserva fica garantida, sem a frase em negrito", () => {
  const dados = dadosDe("aniversario_adulto", "Pacote Luxo", {
    pagamento: {
      parcelas: [
        { percentual: 30, sinal: true, vencimento: { tipo: "pago", data: "2026-09-10" } },
        { percentual: 70, sinal: false, vencimento: { tipo: "dias_antes", dias: 10 } },
      ],
    },
  });
  const { documento } = montarContrato(dados, contextoDe("aniversario_adulto"));
  conferirDocumento(documento, dados);
  const p = clausulaResolvida(documento, "pagamento").paragrafos;
  assert.ok(p[1].endsWith("a título de sinal para garantir a reserva da data, já pago pela CONTRATANTE em 10 de setembro de 2026;"));
  assert.ok(p.includes("A reserva da data fica garantida com o sinal já pago."));
});

// -------------------------------------------------------- clausulas opcionais --

test("sem alimentacao para a equipe, a clausula sai e as seguintes renumeram", () => {
  const dados = dadosDe("casamento", "Pacote Principal", { evento: { alimentacao: false } });
  const { documento } = montarContrato(dados, contextoDe("casamento"));
  const texto = conferirDocumento(documento, dados);
  assert.ok(!ids(documento).includes("alimentacao"));
  assert.ok(texto.includes("CLÁUSULA 10 - DAS ALTERAÇÕES DO MATERIAL"));
  assert.ok(texto.includes("CLÁUSULA 14 - DO FORO"));
});

test("pacote sem stories, sem Reels e sem extras e recusado, mesmo com adicionais", () => {
  const dados = dadosDe("casamento", "Personalizado", {
    servico: {
      escopo: { stories: false, reels: [], extras: [] },
      adicionais: [adicional("casamento", "casamento.polaroid", "Personalizado")],
    },
  });
  assert.ok(faltantes(dados, contextoDe("casamento")).includes("O que o pacote entrega (stories, Reels ou extras)"));
});

test("sem stories: sem a clausula do Instagram e sem o item dos stories", () => {
  // Infantil (4/4/7, fora do tempo real): o corporativo, que servia aqui, e tempo real.
  const dados = dadosDe("aniversario_infantil", "Pacote Básico");
  dados.servico.escopo.stories = false;
  const { documento } = montarContrato(dados, contextoDe("aniversario_infantil"));
  conferirDocumento(documento, dados);
  assert.ok(!ids(documento).includes("instagram"));
  assert.ok(clausulaResolvida(documento, "servicos").paragrafos[0].startsWith("A. Gravar e editar 1 (um) Reels/Vídeo"));
  assert.equal(
    clausulaResolvida(documento, "prazos").paragrafos[0],
    "A CONTRATADA compromete-se a entregar todo o material bruto captado no prazo de até 4 (quatro) dias úteis após o evento e o Reels em até 7 (sete) dias úteis.",
  );
});

test("adicionais variados: hora extra, trend por unidade, locomocao e servico livre, com o total conferido", () => {
  const dados = dadosDe("aniversario_infantil", "Pacote Luxo", {
    servico: {
      adicionais: [
        adicional("aniversario_infantil", "aniversario_infantil.hora_adicional", "Pacote Luxo", { quantidade: 2 }),
        adicional("aniversario_infantil", "aniversario_infantil.trend", "Pacote Luxo", { quantidade: 2 }),
        adicional("aniversario_infantil", "aniversario_infantil.storymaker", "Pacote Luxo", { quantidade: 3 }),
        { ...novoAdicional(ADICIONAL_LOCOMOCAO, "Pacote Luxo", "2027"), valorUnitario: 15000 },
        {
          id: "livre-1",
          tipo: "outro",
          descricao: "Vídeo de até 20 (vinte) minutos com os melhores momentos do evento, com captação e edição",
          quantidade: 1,
          valorUnitario: 38000,
          minutos: 0,
        },
      ],
      desconto: 10000,
    },
  });
  const { documento } = montarContrato(dados, contextoDe("aniversario_infantil"));
  const texto = conferirDocumento(documento, dados);

  assert.deepEqual(clausulaResolvida(documento, "adicionais").paragrafos.slice(1, 6), [
    "A. 2 (duas) horas adicionais de cobertura, no valor de R$ 300,00 (trezentos reais) por hora, totalizando R$ 600,00 (seiscentos reais).",
    "B. Vídeo de trend: 2 (duas) unidades, no valor de R$ 180,00 (cento e oitenta reais) por unidade, totalizando R$ 360,00 (trezentos e sessenta reais).",
    "C. Storymaker auxiliar para a cobertura em tempo real: 3 (três) horas, no valor de R$ 100,00 (cem reais) por hora, totalizando R$ 300,00 (trezentos reais).",
    "D. Despesas de locomoção da CONTRATADA até o local do evento, no valor de R$ 150,00 (cento e cinquenta reais).",
    "E. Vídeo de até 20 (vinte) minutos com os melhores momentos do evento, com captação e edição, no valor de R$ 380,00 (trezentos e oitenta reais).",
  ]);
  // 1.990 + 600 + 360 + 300 + 150 + 380 - 100 = 3.680
  assert.equal(totalContrato(dados.servico), 368000);
  assert.ok(texto.includes("será de R$ 3.680,00 (três mil seiscentos e oitenta reais), já incluídos os serviços adicionais."));
  assert.ok(
    clausulaResolvida(documento, "local").paragrafos.includes("Tempo de serviço: 8 (oito) horas."),
    "hora adicional soma no tempo de servico",
  );
  assert.ok(
    clausulaResolvida(documento, "prazos").paragrafos[0].endsWith("e os Reels em até 7 (sete) dias úteis."),
    "Reels do pacote mais as trends: plural",
  );
});

// ------------------------------------------------------------ condicoes especiais --

test("condicoes especiais entram antes da assinatura eletronica, com o paragrafo unico e sem problemas", () => {
  const dados = dadosDe("casamento", "Pacote Real Time", {
    observacoes: "Na cerimônia a auxiliar chega antes para filmar o local.",
  });
  const paragrafos = [
    "O storymaker auxiliar chegará ao local antes do início da cerimônia para captar imagens do espaço.",
  ];
  const { documento } = montarContrato(dados, contextoDe("casamento"), paragrafos);
  conferirDocumento(documento, dados);

  const n = ids(documento);
  assert.equal(n.indexOf("condicoes_especiais"), n.indexOf("assinatura_eletronica") - 1);
  const especiais = documento.clausulas.find((c) => c.id === "condicoes_especiais")!;
  assert.equal(especiais.origem, "ia");
  assert.deepEqual(especiais.problemas, []);
  assert.deepEqual(especiais.paragrafos, [...paragrafos, PARAGRAFO_UNICO_CONDICOES_ESPECIAIS]);
});

test("numero inventado pela IA vira problema da clausula (que bloqueia o PDF)", () => {
  const dados = dadosDe("casamento", "Pacote Principal", { observacoes: "Cliente pediu vídeo extra." });
  const { documento } = montarContrato(dados, contextoDe("casamento"), [
    "A CONTRATADA entregará um vídeo extra em até 45 (quarenta e cinco) dias úteis, pelo valor de R$ 2.345,00.",
  ]);
  const especiais = documento.clausulas.find((c) => c.id === "condicoes_especiais")!;
  assert.equal(especiais.problemas.length, 1);
  // A citacao traz a unidade: e com ela que o numero e conferido.
  assert.match(especiais.problemas[0], /“45 \(quarenta e cinco\) dias”, “R\$ 2\.345,00”/);
});

test("condicoes especiais vazias ou nulas nao criam a clausula", () => {
  const dados = dadosDe("casamento", "Pacote Principal");
  for (const vazio of [null, undefined, [], ["  ", ""]]) {
    const { documento } = montarContrato(dados, contextoDe("casamento"), vazio);
    assert.ok(!ids(documento).includes("condicoes_especiais"));
  }
});

// ----------------------------------------------------------------- faltantes --

test("dados vazios: a montagem recusa com a lista humana do que falta", () => {
  const dados = dadosContratoSchema.parse({ servico: { tabela: "2027" }, pagamento: pagamentoDoPreset("30/70") });
  const ctx = contextoDe("debutante");
  const campos = faltantes(dados, ctx);
  for (const esperado of [
    "Nome completo de quem assina",
    "Tratamento de quem assina (Sr. ou Sra.)",
    "CPF de quem assina",
    "E-mail de quem assina",
    "Endereço de quem assina: logradouro (rua, avenida...)",
    "Vínculo de quem assina com a pessoa homenageada (mãe, pai, responsável legal)",
    "Data do evento",
    "Início da cobertura do evento",
    "Nome da debutante",
    "Local do evento",
    "Pacote",
    "Valor do pacote",
    "Horas de cobertura do pacote",
    "Valor total do contrato (está zerado)",
  ]) {
    assert.ok(campos.includes(esperado), `falta: ${esperado}`);
  }
  assert.throws(
    () => montarContrato(dados, ctx),
    (e: unknown) => e instanceof CamposFaltandoContratoError && e.campos.length === campos.length && !e.message.includes("CPF"),
  );
});

test("CPF com digito errado, e-mail malformado, data passada e UF invalida sao recusados", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    contratante: { pf: { cpf: "12345678900", email: "ana@exemplo..com", endereco: { uf: "São Paulo" } } },
    evento: { data: "2026-09-28", horarioInicio: "25:00" },
  });
  const campos = faltantes(dados, contextoDe("casamento"));
  assert.ok(campos.includes("CPF de quem assina (o número não é válido)"));
  assert.ok(campos.includes("E-mail de quem assina (o endereço não é válido)"));
  assert.ok(campos.includes("Endereço de quem assina: UF (a sigla, com 2 letras)"));
  assert.ok(campos.includes("Data do evento (a data já passou)"));
  assert.ok(campos.includes("Início da cobertura do evento (horário inválido)"));
});

test("evento hoje ainda pode ser contratado; ontem nao", () => {
  const hoje = dadosDe("corporativo", "Pacote Pocket", { evento: { data: HOJE }, pagamento: pagamentoDoPreset("integral") });
  assert.deepEqual(faltantes(hoje, contextoDe("corporativo")), []);
});

test("anuente incompleto, local sem endereco e adicional sem valor entram na lista", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    anuente: { ativo: true, nome: "", genero: "", cpf: "", email: "x", papel: "" },
    evento: {
      locais: [
        { rotulo: "Local da cerimônia", endereco: "Igreja Matriz, Praça Central, s/n, Campinas/SP" },
        { rotulo: "Local da recepção", endereco: "" },
        { rotulo: "", endereco: "" },
      ],
    },
    servico: { adicionais: [{ ...novoAdicional(ADICIONAL_LOCOMOCAO, "", "2027"), valorUnitario: 0 }] },
  });
  const campos = faltantes(dados, contextoDe("casamento"));
  assert.ok(campos.includes("Anuente: nome completo"));
  assert.ok(campos.includes("Anuente: tratamento (Sr. ou Sra.)"));
  assert.ok(campos.includes("CPF do anuente"));
  assert.ok(campos.includes("E-mail do anuente (o endereço não é válido)"));
  assert.ok(campos.includes("Anuente: papel no evento (noivo, noiva, aniversariante)"));
  assert.ok(campos.includes("Endereço: Local da recepção"));
  assert.ok(campos.includes("Valor do adicional “despesas de locomoção da CONTRATADA até o local do evento”"));
  assert.equal(campos.filter((c) => c.startsWith("Nome da linha")).length, 0, "linha totalmente vazia e ignorada");
});

test("pagamento invalido (15/15/70 sem a data da segunda parcela) impede a montagem", () => {
  const dados = dadosDe("casamento", "Pacote Principal", { pagamento: pagamentoDoPreset("15/15/70") });
  assert.ok(faltantes(dados, contextoDe("casamento")).includes("Parcela B: informe a data de vencimento."));
});

test("pessoa juridica exige razao social, CNPJ valido e representante completo", () => {
  const dados = dadosDe("corporativo", "Pacote Premium", {
    contratante: { pj: { razaoSocial: "", cnpj: "11222333000100", representante: { cargo: "", genero: "" } } },
  });
  const campos = faltantes(dados, contextoDe("corporativo"));
  assert.ok(campos.includes("Razão social da empresa"));
  assert.ok(campos.includes("CNPJ da empresa (o número não é válido)"));
  assert.ok(campos.includes("Cargo de quem assina pela empresa"));
  assert.ok(campos.includes("Tratamento de quem assina pela empresa (Sr. ou Sra.)"));
});

// ------------------------------------------------------ escopo e total --

test("escopo efetivo soma os adicionais sem alterar o escopo do pacote", () => {
  const dados = dadosDe("debutante", "Pacote Básico", {
    servico: {
      adicionais: [
        adicional("debutante", "debutante.hora_adicional", "Pacote Básico", { quantidade: 2 }),
        adicional("debutante", "debutante.storymaker", "Pacote Básico"),
        { id: "livre-1", tipo: "making_of", descricao: "Making of extra", quantidade: 1, valorUnitario: 1000, minutos: 45 },
        { id: "livre-2", tipo: "tempo_real", descricao: "Entrega em tempo real", quantidade: 1, valorUnitario: 1000, minutos: 0 },
      ],
    },
  });
  const antes = structuredClone(dados.servico.escopo);
  const e = escopoEfetivo(dados.servico);
  assert.equal(e.minutosCobertura, 300 + 120);
  assert.equal(e.minutosMakingOf, 45);
  assert.equal(e.storymakers, 2);
  assert.equal(e.tempoReal, true);
  assert.deepEqual(dados.servico.escopo, antes, "escopo do pacote intacto");
});

test("total = pacote + adicionais - desconto, nunca negativo", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    servico: { valorPacote: 100000, adicionais: [adicional("casamento", "casamento.reels", "", { quantidade: 3 })], desconto: 5000 },
  });
  assert.equal(totalContrato(dados.servico), 100000 + 3 * 30000 - 5000);
  assert.equal(totalContrato({ ...dados.servico, desconto: 10_000_000 }), 0);
});

test("total de tabela: pacote e adicionais pelo catalogo; personalizado nao tem tabela", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    servico: {
      valorPacote: 1,
      adicionais: [
        adicional("casamento", "casamento.making_of_noiva", "", { valorUnitario: 1 }),
        { ...novoAdicional(ADICIONAL_LOCOMOCAO, "", "2027"), valorUnitario: 20000 },
      ],
    },
  });
  // pacote 1.490 (2027) + making of 380 (catalogo, nao o 0,01 digitado) + locomocao 200 (sem preco na arte: o digitado)
  assert.equal(totalDeTabela(dados.servico, "casamento"), 149000 + 38000 + 20000);
  assert.equal(totalDeTabela({ ...dados.servico, pacote: "Personalizado" }, "casamento"), null);
});

// ------------------------------------------------------------------- avisos --

test("avisos: casamento sem anuente, tabela de outro ano, acima da tabela e tempo real pedido e nao contratado", () => {
  const dados = dadosDe("casamento", "Pacote Principal", { servico: { tabela: "2026", valorPacote: 150000 } });
  const avisos = avisosDeterministicos(dados, contextoDe("casamento", { entregaSolicitada: "Em tempo real" }));
  const textos = avisos.map((a) => `${a.gravidade}|${a.texto}`);
  assert.ok(
    textos.includes(
      "sugestao|Só quem assina autoriza o uso da própria imagem. Para cobrir o(a) outro(a) noivo(a), inclua-o(a) como anuente.",
    ),
  );
  assert.ok(textos.includes("atencao|O total ficou acima da tabela 2026 (R$ 1.290,00). Confira se é o valor da proposta aceita."));
  assert.ok(
    textos.includes(
      "sugestao|O evento é em 2027, mas o contrato usa a tabela 2026. Tudo bem se a proposta aceita foi dessa tabela.",
    ),
  );
  assert.ok(textos.some((t) => t.startsWith("atencao|No formulário, o cliente pediu entrega em tempo real")));
  assert.ok(avisos.every((a) => a.origem === "sistema"));
});

test("aviso de making of a definir e de aniversario sem idade", () => {
  const dados = dadosDe("aniversario_adulto", "Pacote Luxo");
  const semIdade = avisosDeterministicos(dados, contextoDe("aniversario_adulto", { idadeHomenageado: null }));
  assert.ok(semIdade.some((a) => a.gravidade === "atencao" && a.texto.startsWith("A idade do(a) aniversariante não foi informada")));
  assert.ok(semIdade.some((a) => a.clausula === "local" && a.texto.includes("“A DEFINIR”")));

  const comLocal = dadosDe("aniversario_adulto", "Pacote Luxo", { evento: { makingOfLocal: "Salão Bela", makingOfHorario: "15:00" } });
  assert.ok(!avisosDeterministicos(comLocal, contextoDe("aniversario_adulto")).some((a) => a.clausula === "local"));
});

test("storymaker adicional 'para a cobertura em tempo real' sem tempo real no escopo gera atencao", () => {
  const storymaker = novoAdicional(adicionalDoCatalogo("debutante", "debutante.storymaker")!, "Pacote Luxo", "2027");
  const semTempoReal = dadosDe("debutante", "Pacote Luxo", { servico: { adicionais: [storymaker] } });
  const avisos = avisosDeterministicos(semTempoReal, contextoDe("debutante"));
  const aviso = avisos.find((a) => a.texto.startsWith("O storymaker adicional está descrito"));
  assert.ok(aviso, "sem tempo real, o texto diria 'tempo real' ao lado da clausula de prazos");
  assert.equal(aviso.gravidade, "atencao");
  assert.equal(aviso.clausula, "adicionais");

  const comTempoReal = dadosDe("debutante", "Pacote Luxo", {
    servico: { adicionais: [storymaker], escopo: { tempoReal: true } },
  });
  assert.ok(
    !avisosDeterministicos(comTempoReal, contextoDe("debutante")).some((a) => a.texto.startsWith("O storymaker adicional")),
  );
});

test("aniversario adulto: sugere anuente so quando quem assina nao e o aniversariante", () => {
  const outra = dadosDe("aniversario_adulto", "Pacote Pocket");
  assert.ok(avisosDeterministicos(outra, contextoDe("aniversario_adulto")).some((a) => a.texto.startsWith("Quem assina não é o(a) aniversariante")));

  const propria = dadosDe("aniversario_adulto", "Pacote Pocket", { evento: { homenageado: "Ana Paula" } });
  assert.ok(!avisosDeterministicos(propria, contextoDe("aniversario_adulto")).some((a) => a.texto.startsWith("Quem assina não é")));
});

test("mesma pessoa: primeiro nome igual e o nome curto contido no longo", () => {
  assert.equal(mesmaPessoa("Carla", "Carla Mendes Souza"), true);
  assert.equal(mesmaPessoa("carla mendes", "Carla Mendes de Souza"), true);
  assert.equal(mesmaPessoa("Carla Souza", "Paula Souza"), false);
  assert.equal(mesmaPessoa("", "Carla"), false);
});

// ------------------------------------------------------------------- golden --

test("golden: casamento no Pacote Principal com making of da noiva e o noivo como anuente", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    anuente: ANUENTE_NOIVO,
    evento: {
      data: "2027-01-23",
      horarioInicio: "20:00",
      locais: [
        {
          rotulo: "Local da cerimônia e recepção",
          endereco: "Espaço Jardim Aurora, Estrada Municipal 400, Chácaras Alpina, Valinhos/SP",
        },
      ],
    },
    servico: { adicionais: [adicional("casamento", "casamento.making_of_noiva", "Pacote Principal")] },
  });
  const { documento, avisos } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);

  const esperado = [
    "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE STORYMAKER",

    "CONTRATANTE: Ana Paula Rocha, brasileira, inscrita no CPF sob o nº 123.456.789-09, residente e domiciliada na Rua das Acácias, 120, Apto. 12, Jardim Primavera, Campinas/SP, CEP 13000-000, com endereço eletrônico ana.rocha@exemplo.com.br, que declara ser maior de 18 (dezoito) anos e plenamente capaz para os atos da vida civil.",

    "CONTRATADA: Mellayne Simão Sabino, brasileira, storymaker, inscrita no CNPJ sob o nº 53.925.833/0001-20, residente e domiciliada na Rua Caiapós, 28, Condomínio Residencial Monterrey Reserva, Parque Residencial Terras de Yucatan, Monte Mor/SP, com endereço eletrônico mel@wama.digital.",

    "ANUENTE: João Pedro Lima, brasileiro, inscrito no CPF sob o nº 987.654.321-00, com endereço eletrônico joao.lima@exemplo.com.br, noivo no evento, que intervém neste instrumento exclusivamente para autorizar o uso de sua imagem e voz, nos termos da Cláusula 10.",

    // Com anuente, as tres partes nomeadas (TXT-11, item 4).
    "Pelo presente instrumento particular, as partes acima identificadas e qualificadas, doravante denominadas simplesmente CONTRATANTE, CONTRATADA e ANUENTE, esta última interveniente apenas para os fins da Cláusula 10, têm entre si justo e contratado o que segue, nos termos e condições abaixo:",

    [
      "CLÁUSULA 1 - DO OBJETO DO CONTRATO",
      "O presente contrato tem por objeto a prestação de serviços de storymaker, no Pacote Principal, consistindo na cobertura do casamento de Ana e João, pelo período de até 5 (cinco) horas, abrangendo cerimônia e recepção, através de registros em formato de stories ilimitados (Instagram), bem como a gravação e edição de 1 (um) Reels de até 1 (um) minuto e 30 (trinta) segundos, com o resumo do evento.",
      "Integra também o objeto deste contrato o serviço adicional descrito na Cláusula 4.",
    ].join("\n"),

    [
      "CLÁUSULA 2 - DO LOCAL, DATA E HORÁRIO DO EVENTO",
      "Data do evento: 23 de janeiro de 2027;",
      "Início da cobertura do evento: 20h;",
      "Local da cerimônia e recepção: Espaço Jardim Aurora, Estrada Municipal 400, Chácaras Alpina, Valinhos/SP;",
      "Local e início do making of: A DEFINIR, devendo ser informados pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
      "Tempo de serviço: 7 (sete) horas (2h de making of + 5h de cobertura do evento).",
    ].join("\n"),

    [
      "CLÁUSULA 3 - DOS SERVIÇOS",
      "A. Realizar stories ilimitados do making of e do evento, utilizando equipamento próprio, com publicação, em até 5 (cinco) dias úteis após o evento, diretamente na conta do Instagram fornecida pela CONTRATANTE.",
      "B. Gravar e editar 1 (um) Reels/Vídeo com o resumo do evento, com duração de até 1 (um) minuto e 30 (trinta) segundos.",
    ].join("\n"),

    [
      "CLÁUSULA 4 - DOS SERVIÇOS ADICIONAIS",
      "Fica acordada a inclusão do seguinte serviço adicional à cobertura principal:",
      "A. Making of da noiva, com duração de até 2 (duas) horas, no valor de R$ 380,00 (trezentos e oitenta reais).",
      "O serviço adicional integra o presente contrato para todos os fins, aplicando-se a ele as mesmas condições técnicas, operacionais e prazos aqui estabelecidos.",
    ].join("\n"),

    [
      "CLÁUSULA 5 - DOS PRAZOS",
      "A CONTRATADA compromete-se a entregar a cobertura completa dos stories no prazo de até 5 (cinco) dias úteis após o evento, bem como o Reels e todo o material bruto captado no prazo de até 7 (sete) dias úteis.",
    ].join("\n"),

    [
      "CLÁUSULA 6 - DO ACESSO À CONTA DO INSTAGRAM",
      "A CONTRATANTE fornecerá à CONTRATADA, até o dia do evento, acesso à conta do Instagram em que os stories serão publicados, preferencialmente pelas ferramentas de acesso compartilhado da própria plataforma. A CONTRATADA e sua equipe utilizarão esse acesso exclusivamente para publicar o conteúdo do evento, sem ler ou responder mensagens diretas nem alterar configurações da conta, e deixarão de utilizá-lo ao término dos serviços, recomendando-se à CONTRATANTE a alteração da senha.",
      "**Na ausência desse acesso, a cobertura será entregue juntamente com o restante do material, por meio de link para download em nuvem.**",
    ].join("\n"),

    [
      "CLÁUSULA 7 - DO PAGAMENTO",
      "O valor total dos serviços prestados será de R$ 1.870,00 (mil oitocentos e setenta reais), já incluído o serviço adicional. O pagamento será realizado da seguinte forma:",
      "A. 30% (trinta por cento) do valor total, equivalente a R$ 561,00 (quinhentos e sessenta e um reais), a título de sinal para garantir a reserva da data, a ser pago na assinatura deste contrato;",
      "B. 70% (setenta por cento) do valor total, equivalente a R$ 1.309,00 (mil trezentos e nove reais), a ser pago até 10 (dez) dias antes da data do evento.",
      "**A reserva da data somente será garantida mediante a confirmação do pagamento do sinal.**",
      "Todos os pagamentos deverão ser realizados via PIX, utilizando a chave PIX (CNPJ): 53.925.833/0001-20.",
    ].join("\n"),

    [
      "CLÁUSULA 8 - DA PLATAFORMA DE ENTREGA",
      "Os registros serão entregues por meio de um link de compartilhamento de arquivos em nuvem, **não sendo a CONTRATADA obrigada a disponibilizá-los por outros meios.**",
    ].join("\n"),

    [
      "CLÁUSULA 9 - DO TEMPO DE ARMAZENAMENTO",
      "**A CONTRATANTE terá acesso ao link com os registros por um período de 6 (seis) meses após o evento, cabendo a ela realizar o download dos arquivos dentro desse prazo. Após este prazo, os arquivos serão excluídos da nuvem.**",
      "Parágrafo único. Ficam preservados os conteúdos utilizados no portfólio e na divulgação do trabalho da CONTRATADA, nos termos da Cláusula 10.",
    ].join("\n"),

    [
      "CLÁUSULA 10 - DOS DIREITOS AUTORAIS E AUTORIZAÇÃO DE IMAGEM",
      "10.1. Os direitos autorais sobre o material produzido pertencem à CONTRATADA, nos termos da Lei nº 9.610/98. A CONTRATADA concede à CONTRATANTE licença gratuita, não exclusiva e por prazo indeterminado para guardar, publicar e compartilhar o material entregue, para fins pessoais e não comerciais, inclusive em suas redes sociais, indicando-se, sempre que possível, a autoria da CONTRATADA.",
      "10.2. **A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar sua imagem e voz, captadas no evento, no portfólio e na divulgação do trabalho da CONTRATADA em seu site e em seus perfis profissionais nas redes sociais, inclusive em anúncios pagos, podendo as publicações incluir marcações, menções ou colaborações com outros fornecedores envolvidos no evento.**",
      "10.3. **João Pedro Lima, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.**",
    ].join("\n"),

    [
      "CLÁUSULA 11 - DA ALIMENTAÇÃO",
      "A CONTRATANTE informará à equipe do local do evento que a CONTRATADA tem direito a se servir do buffet, bem como a ter acesso à alimentação e às bebidas não alcoólicas disponibilizadas durante o evento.",
    ].join("\n"),

    [
      "CLÁUSULA 12 - DAS ALTERAÇÕES DO MATERIAL",
      "**A CONTRATANTE reconhece que o serviço de storymaker não inclui adaptações, revisões ou modificações do material, por preferência estética, após a finalização e entrega.** Não se incluem nesta regra as falhas técnicas ou de informação atribuíveis à CONTRATADA, como grafia incorreta de nomes, arquivo corrompido ou material incompleto em relação ao contratado, que serão corrigidas sem custo em até 5 (cinco) dias úteis contados da comunicação da CONTRATANTE.",
    ].join("\n"),

    [
      "CLÁUSULA 13 - DA DESISTÊNCIA OU ADIAMENTO DO EVENTO",
      "13.1. **Em caso de desistência ou cancelamento do evento pela CONTRATANTE, o sinal previsto na Cláusula 7 não será reembolsado.**",
      "13.2. **Se o evento for adiado e a nova data coincidir com outro compromisso da CONTRATADA, o serviço não será prestado e o sinal não será reembolsado.**",
      "13.3. Nas hipóteses dos itens 13.1 e 13.2, os valores pagos além do sinal serão restituídos à CONTRATANTE em até 10 (dez) dias.",
      "13.4. Adiado o evento a pedido da CONTRATANTE para data em que a CONTRATADA esteja disponível, os valores já pagos serão aproveitados para a nova data.",
      "13.5. Caso a CONTRATADA deixe de prestar os serviços por motivo a ela imputável, fora das hipóteses da Cláusula 14, restituirá à CONTRATANTE, em até 10 (dez) dias, a integralidade dos valores pagos, acrescida de quantia equivalente ao sinal, sem prejuízo dos demais direitos assegurados à CONTRATANTE pela legislação.",
    ].join("\n"),

    [
      "CLÁUSULA 14 - DA EQUIPE DE TRABALHO",
      "Em caso de impossibilidade da CONTRATADA de comparecer ao evento por motivo de força maior ou caso fortuito, a CONTRATADA designará outro profissional de sua equipe para a realização do serviço contratado, comunicando o fato à CONTRATANTE tão logo tenha conhecimento do impedimento. **A CONTRATANTE declara estar ciente de que o profissional designado atuará seguindo o mesmo padrão de trabalho, identidade visual e diretrizes previamente estabelecidas pela CONTRATADA, e de que tal substituição não caracterizará descumprimento contratual.**",
      "Parágrafo único. Não sendo possível a substituição, o contrato será resolvido e a CONTRATADA restituirá integralmente os valores pagos pela CONTRATANTE, em até 10 (dez) dias.",
    ].join("\n"),

    [
      "CLÁUSULA 15 - DA ASSINATURA ELETRÔNICA",
      "As partes reconhecem como válida e eficaz a assinatura deste instrumento por meio eletrônico, pela plataforma iLovePDF, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, e declaram que a versão eletrônica, acompanhada do respectivo registro de assinaturas, constitui o original deste contrato.",
    ].join("\n"),

    [
      "CLÁUSULA 16 - DO FORO",
      "As partes elegem o foro da comarca do domicílio da CONTRATANTE para dirimir judicialmente as controvérsias inerentes ao presente contrato. E, por estarem assim justas e contratadas, as partes assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito.",
    ].join("\n"),

    "Campinas/SP, na data da última assinatura eletrônica registrada pela plataforma.",

    [
      "CONTRATANTE: Ana Paula Rocha, CPF: 123.456.789-09",
      "CONTRATADA: Mellayne Simão Sabino, CNPJ: 53.925.833/0001-20",
      "ANUENTE: João Pedro Lima, CPF: 987.654.321-00",
    ].join("\n"),
  ].join("\n\n");

  assert.equal(textoCorrido(documento), esperado);
  assert.equal(documento.versaoModelo, "2026-09-30");
  assert.deepEqual(
    documento.assinaturas.map((a) => a.email),
    ["ana.rocha@exemplo.com.br", "mel@wama.digital", "joao.lima@exemplo.com.br"],
  );
  assert.deepEqual(avisos, [
    {
      origem: "sistema",
      gravidade: "sugestao",
      clausula: "local",
      texto: "O local ou o horário do making of ficou “A DEFINIR”: o contrato dá à CONTRATANTE até 10 (dez) dias antes do evento para informar.",
    },
  ]);
});

// ------------------------------------------------------ storymaker auxiliar --

test("infantil Premium com 2 horas de auxiliar: o contrato promete o auxiliar por 2 horas, nao a cobertura inteira", () => {
  const storymaker = adicional("aniversario_infantil", "aniversario_infantil.storymaker", "Pacote Premium", { quantidade: 2 });
  const dados = dadosDe("aniversario_infantil", "Pacote Premium", {
    servico: { adicionais: [storymaker], escopo: { tempoReal: true } },
  });
  const { documento, avisos } = montarContrato(dados, contextoDe("aniversario_infantil"));
  const texto = conferirDocumento(documento, dados);

  assert.equal(escopoEfetivo(dados.servico, "aniversario_infantil").storymakers, 1);
  assert.equal(escopoEfetivo(dados.servico, "aniversario_infantil").minutosAuxiliar, 120);
  // Sem a arte (como o painel chama), a unidade sai do proprio id.
  assert.equal(escopoEfetivo(dados.servico).minutosAuxiliar, 120);

  assert.ok(texto.includes("A cobertura contará, por até 2 (duas) horas, com 1 (um) storymaker auxiliar."));
  assert.ok(texto.includes("C. Contar, por até 2 (duas) horas, com 1 (um) storymaker auxiliar, que atuará em conjunto com a CONTRATADA"));
  assert.ok(texto.includes("a CONTRATADA e 1 (um) profissional de sua equipe, que atuará por até 2 (duas) horas, têm direito"));
  assert.ok(!texto.includes("equipe composta"), "nada de equipe de dois a cobertura inteira");
  assert.ok(!texto.includes("durante a cobertura, seguindo"), "nem 'durante a cobertura'");
  assert.ok(
    !avisos.some((a) => a.texto.startsWith("A cobertura em tempo real costuma ter storymaker auxiliar")),
    "tem auxiliar (por 2 horas): a sugestao de auxiliar nao cabe",
  );
});

test("dois making ofs e adicional livre de auxiliar simultaneo: sem o paragrafo da alternancia, com aviso de atencao", () => {
  const dados = dadosDe("casamento", "Pacote Principal", {
    servico: {
      adicionais: [
        adicional("casamento", "casamento.making_of_noiva", "Pacote Principal"),
        adicional("casamento", "casamento.making_of_noivo", "Pacote Principal"),
        {
          id: "livre-1",
          tipo: "outro",
          descricao: "Storymaker auxiliar para o making of do noivo, simultâneo ao da noiva",
          quantidade: 1,
          valorUnitario: 30000,
          minutos: 0,
        },
      ],
    },
  });
  const { documento, avisos } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);
  assert.ok(!clausulaResolvida(documento, "adicionais").paragrafos.includes(PARAGRAFO_MAKING_OFS_ALTERNADOS));
  const aviso = avisos.find((a) => a.texto.startsWith("Há dois making ofs e um adicional com storymaker auxiliar"));
  assert.ok(aviso);
  assert.equal(aviso.gravidade, "atencao");
  assert.equal(aviso.clausula, "adicionais");

  // Sem o adicional livre, o paragrafo volta e o aviso some.
  const semLivre = dadosDe("casamento", "Pacote Principal", {
    servico: { adicionais: dados.servico.adicionais.slice(0, 2) },
  });
  assert.ok(!avisosDeterministicos(semLivre, contextoDe("casamento")).some((a) => a.texto.startsWith("Há dois making ofs")));
});

// ------------------------------------------------------------------ ensaio --

test("debutante Luxo: ensaio A DEFINIR na clausula 2, fora do tempo de servico, com sugestao", () => {
  const dados = dadosDe("debutante", "Pacote Luxo");
  const { documento, avisos } = montarContrato(dados, contextoDe("debutante"));
  conferirDocumento(documento, dados);
  const local = clausulaResolvida(documento, "local").paragrafos;
  assert.ok(local.some((p) => p.startsWith("Ensaio fotográfico: A DEFINIR, com duração de até 2 (duas) horas, em data, horário e local de comum acordo entre as partes, anterior à data do evento")));
  assert.equal(local.at(-1), "Tempo de serviço no dia do evento: 7 (sete) horas (2h de making of + 5h de cobertura do evento).");
  assert.ok(avisos.some((a) => a.gravidade === "sugestao" && a.clausula === "local" && a.texto.startsWith("A data, o local ou o horário do ensaio fotográfico")));
});

test("debutante Luxo com o ensaio preenchido: data, local e inicio no contrato, sem a sugestao", () => {
  const dados = dadosDe("debutante", "Pacote Luxo", {
    evento: { ensaioData: "2027-03-06", ensaioLocal: "Estúdio Luz, Rua Três, 30, Campinas/SP", ensaioHorario: "16:00" },
  });
  const { documento, avisos } = montarContrato(dados, contextoDe("debutante"));
  conferirDocumento(documento, dados);
  const local = clausulaResolvida(documento, "local").paragrafos;
  assert.ok(local.includes("Ensaio fotográfico: 6 de março de 2027, com duração de até 2 (duas) horas;"));
  assert.ok(local.includes("Local do ensaio fotográfico: Estúdio Luz, Rua Três, 30, Campinas/SP;"));
  assert.ok(local.includes("Início do ensaio fotográfico: 16h;"));
  assert.ok(!avisos.some((a) => a.texto.includes("ensaio fotográfico")));
});

test("ensaio depois do evento, data inexistente ou horario invalido: a montagem recusa", () => {
  const depois = dadosDe("debutante", "Pacote Luxo", { evento: { ensaioData: "2027-03-21" } });
  assert.ok(faltantes(depois, contextoDe("debutante")).includes("Data do ensaio fotográfico (é depois do evento; o ensaio acontece antes)"));

  const noDia = dadosDe("debutante", "Pacote Luxo", { evento: { ensaioData: "2027-03-20" } });
  assert.deepEqual(faltantes(noDia, contextoDe("debutante")), [], "no mesmo dia do evento ainda vale");

  const inexistente = dadosDe("debutante", "Pacote Luxo", { evento: { ensaioData: "2027-02-30", ensaioHorario: "25:00" } });
  const campos = faltantes(inexistente, contextoDe("debutante"));
  assert.ok(campos.includes("Data do ensaio fotográfico (a data não é válida)"));
  assert.ok(campos.includes("Início do ensaio fotográfico (horário inválido)"));

  // Sem ensaio no escopo, os campos nem vao para o contrato: nao bloqueiam.
  const semEnsaio = dadosDe("debutante", "Pacote Premium", { evento: { ensaioData: "2027-02-30" } });
  assert.deepEqual(faltantes(semEnsaio, contextoDe("debutante")), []);
});

test("contrato salvo antes dos campos do ensaio continua valido (ensaio A DEFINIR)", () => {
  const antigo = dadosContratoSchema.parse({
    servico: { tabela: "2027" },
    evento: { data: "2027-03-20", horarioInicio: "19:30", homenageado: "Maria", makingOfLocal: "", makingOfHorario: "" },
  });
  assert.equal(antigo.evento.ensaioData, "");
  assert.equal(antigo.evento.ensaioLocal, "");
  assert.equal(antigo.evento.ensaioHorario, "");
});

// --------------------------------------------------------- empresa contratante --

test("empresa contratando casamento, sem anuente: atencao, porque ninguem autoriza a imagem dos noivos", () => {
  const dados = dadosDe("casamento", "Pacote Principal", { contratante: { tipo: "pj" } });
  const { documento, avisos } = montarContrato(dados, contextoDe("casamento"));
  conferirDocumento(documento, dados);
  const aviso = avisos.find((a) => a.texto.startsWith("Quem assina é uma empresa: ela não autoriza o uso da imagem dos homenageados."));
  assert.ok(aviso, "a geracao nao e bloqueada, mas a Mel e avisada");
  assert.equal(aviso.gravidade, "atencao");
  assert.equal(aviso.clausula, "direitos");

  const comAnuente = dadosDe("casamento", "Pacote Principal", { contratante: { tipo: "pj" }, anuente: ANUENTE_NOIVO });
  const r = montarContrato(comAnuente, contextoDe("casamento"));
  conferirDocumento(r.documento, comAnuente);
  const direitos = clausulaResolvida(r.documento, "direitos").paragrafos;
  assert.ok(direitos[1].includes("a utilizar o material produzido no evento no portfólio"));
  assert.match(direitos[2], /^\d+\.3\. \*\*João Pedro Lima, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz\.\*\*$/);
  assert.ok(r.avisos.some((a) => a.gravidade === "atencao" && a.texto.includes("a do(a) outro(a) noivo(a) continua sem autorização")));
  assert.ok(!avisos.some((a) => a.texto.startsWith("Só quem assina autoriza")), "a sugestao de pessoa fisica nao se aplica");
});

test("empresa contratando evento de menor: atencao citando o menor; com o responsavel como anuente, ele autoriza pela crianca", () => {
  const semAnuente = dadosDe("debutante", "Pacote Básico", { contratante: { tipo: "pj", vinculo: "" } });
  const avisos = montarContrato(semAnuente, contextoDe("debutante")).avisos;
  const aviso = avisos.find((a) => a.texto.startsWith("Quem assina é uma empresa, e o evento é de menor de idade"));
  assert.ok(aviso);
  assert.equal(aviso.gravidade, "atencao");
  assert.ok(aviso.texto.includes("a empresa não autoriza o uso da imagem de Maria Eduarda"));
  assert.ok(aviso.texto.includes("Inclua o responsável legal do(a) menor como anuente"));

  const mae = { ...ANUENTE_NOIVO, nome: "Clara Nunes Lima", genero: "feminino", papel: "mãe da debutante" };
  const comMae = dadosDe("debutante", "Pacote Básico", { contratante: { tipo: "pj", vinculo: "" }, anuente: mae });
  const r = montarContrato(comMae, contextoDe("debutante"));
  const texto = conferirDocumento(r.documento, comMae);
  assert.ok(texto.includes("Clara Nunes Lima, na qualidade de anuente e de responsável legal de Maria Eduarda, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz e a imagem e a voz de Maria Eduarda."));
  assert.ok(texto.includes("exclusivamente para autorizar o uso de sua imagem e voz e da imagem e da voz de Maria Eduarda, de quem é responsável legal"));
  assert.match(clausulaResolvida(r.documento, "direitos").paragrafos[3], /^\d+\.4\. As publicações da CONTRATADA/);
  assert.ok(!r.avisos.some((a) => a.texto.startsWith("Quem assina é uma empresa")), "com o responsavel como anuente, sem o aviso");
});

test("empresa + anuente que e o proprio menor de 16: o aviso de empresa, e nao o de pessoa fisica ('CONTRATANTE como representante legal')", () => {
  const debutante = { ...ANUENTE_NOIVO, nome: "Maria Eduarda Lima", genero: "feminino", papel: "debutante" };
  const dados = dadosDe("debutante", "Pacote Básico", { contratante: { tipo: "pj", vinculo: "" }, anuente: debutante });
  const avisos = avisosDeterministicos(dados, contextoDe("debutante"));
  assert.ok(avisos.some((a) => a.texto.startsWith("Quem assina é uma empresa, e o evento é de menor de idade")));
  assert.ok(!avisos.some((a) => a.texto.includes("já é dada pela CONTRATANTE como representante legal")));
});

test("o anuente e o homenageado pelo papel so quando o papel comeca por ele: 'pai do aniversariante' nao e o aniversariante", () => {
  const com = (papel: string, nome = "Rafael Costa") =>
    dadosDe("aniversario_infantil", "Pacote Básico", { anuente: { ...ANUENTE_NOIVO, nome, papel } });
  assert.equal(anuenteEhHomenageado(com("aniversariante")), true);
  assert.equal(anuenteEhHomenageado(com("a debutante")), true);
  assert.equal(anuenteEhHomenageado(com("Aniversariante (10 anos)")), true);
  assert.equal(anuenteEhHomenageado(com("pai do aniversariante")), false);
  assert.equal(anuenteEhHomenageado(com("mãe da debutante")), false);
  assert.equal(anuenteEhHomenageado(com("irmão", "Pedro Henrique Rocha")), true, "pelo nome, como antes");
});

// ----------------------------------------------------------------- desconto --

test("desconto maior que o pacote: os adicionais impressos somam mais que o total, e a Mel e avisada", () => {
  // Casamento Principal (R$ 1.490), making of (R$ 380) e Polaroid (R$ 950), fechado em R$ 820.
  const dados = dadosDe("casamento", "Pacote Principal", {
    servico: {
      adicionais: [
        adicional("casamento", "casamento.making_of_noiva", "Pacote Principal"),
        adicional("casamento", "casamento.polaroid", "Pacote Principal"),
      ],
      desconto: 200000,
    },
  });
  assert.equal(totalContrato(dados.servico), 82000);
  const aviso = avisosDeterministicos(dados, contextoDe("casamento")).find((a) => a.texto.startsWith("O desconto"));
  assert.ok(aviso);
  assert.equal(aviso.gravidade, "atencao");
  assert.equal(aviso.clausula, "pagamento");
  assert.equal(
    aviso.texto,
    "O desconto (R$ 2.000,00) passou do valor do pacote (R$ 1.490,00), e os adicionais listados no contrato somam R$ 1.330,00, mais que o total de R$ 820,00. O contrato não mostra o desconto, então o texto se contradiz: ajuste os valores dos adicionais ou o desconto.",
  );

  const descontoPequeno = dadosDe("casamento", "Pacote Principal", {
    servico: { adicionais: dados.servico.adicionais, desconto: 10000 },
  });
  assert.ok(!avisosDeterministicos(descontoPequeno, contextoDe("casamento")).some((a) => a.texto.startsWith("O desconto")));
});

// ---------------------------------------------------------------------- CEP --

test("CEP preenchido pela metade (ou com digito a mais) impede a montagem; em branco, nao", () => {
  const incompleto = dadosDe("casamento", "Pacote Principal", { contratante: { pf: { endereco: { cep: "131015" } } } });
  assert.ok(faltantes(incompleto, contextoDe("casamento")).includes("Endereço de quem assina: CEP incompleto (são 8 números, ou deixe em branco)"));

  const aMais = dadosDe("corporativo", "Pacote Pocket", { contratante: { pj: { endereco: { cep: "130250001" } } } });
  assert.ok(faltantes(aMais, contextoDe("corporativo")).includes("Endereço da sede da empresa: CEP inválido (são 8 números, ou deixe em branco)"));

  const emBranco = dadosDe("casamento", "Pacote Principal", { contratante: { pf: { endereco: { cep: "" } } } });
  assert.deepEqual(faltantes(emBranco, contextoDe("casamento")), []);
  const comMascara = dadosDe("casamento", "Pacote Principal", { contratante: { pf: { endereco: { cep: "13101-538" } } } });
  assert.deepEqual(faltantes(comMascara, contextoDe("casamento")), []);
});
