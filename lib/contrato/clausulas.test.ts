import assert from "node:assert/strict";
import { test } from "node:test";
import type { TemplateId } from "@/lib/form/types";
import { dadosContratoSchema, IDS_CLAUSULA, type Adicional, type DadosContrato } from "./tipos";
import { adicionalDoCatalogo, novoAdicional, pacoteDoCatalogo } from "./catalogo";
import { pagamentoDoPreset } from "./pagamento";
import { baseDeRedacao, type ContextoMontagem } from "./montar";
import {
  adicionalIndicaSegundaPessoa,
  cabecalhoClausula,
  clausulaAdicionais,
  clausulaAlimentacao,
  clausulaCondicoesEspeciais,
  clausulaCondicoesTecnicas,
  clausulaDesistencia,
  clausulaDireitos,
  clausulaEquipe,
  clausulaForo,
  clausulaInstagram,
  clausulaLocal,
  clausulaObjeto,
  clausulaPagamento,
  clausulaPrazos,
  clausulaServicos,
  dataPorExtenso,
  fraseDoReels,
  PARAGRAFO_MAKING_OFS_ALTERNADOS,
  PARAGRAFO_UNICO_CONDICOES_ESPECIAIS,
  parteAnuente,
  PREAMBULO,
  preambuloDoContrato,
  quantidadeMakingOfs,
  textoAdicional,
  textoVencimento,
  TITULOS_CLAUSULA,
  type AdicionalRedacao,
} from "./clausulas";

// Dados FICTICIOS (CPF gerado com digito verificador valido, de ninguem).

const HOJE = "2026-09-29";

function ctxDe(t: TemplateId, idade: number | null = null): ContextoMontagem {
  const categoria = t === "aniversario_infantil" || t === "aniversario_adulto" ? "aniversario" : t;
  return { categoria, templateId: t, idadeHomenageado: idade, hojeISO: HOJE };
}

type Mudar = (d: DadosContrato) => void;

function dados(t: TemplateId, pacote: string, mudar: Mudar = () => {}): DadosContrato {
  const d = dadosContratoSchema.parse({
    contratante: {
      tipo: "pf",
      pf: {
        nome: "Beatriz Nunes Prado",
        genero: "feminino",
        cpf: "27182818205",
        email: "bia.prado@exemplo.com.br",
        endereco: { logradouro: "Rua Sete", numero: "7", bairro: "Centro", cidade: "Jundiaí", uf: "SP" },
      },
      vinculo: "mãe",
    },
    evento: {
      data: "2027-05-01",
      horarioInicio: "18:00",
      homenageado: "Sofia",
      locais: [{ rotulo: "Local do evento", endereco: "Salão Flor de Lis, Rua Dez, 100, Jundiaí/SP" }],
    },
    servico: { tabela: "2027", pacote, valorPacote: 120000, escopo: pacoteDoCatalogo(t, pacote)!.escopo },
    pagamento: pagamentoDoPreset("30/70"),
  });
  mudar(d);
  return d;
}

function base(t: TemplateId, pacote: string, mudar: Mudar = () => {}, idade: number | null = null) {
  return baseDeRedacao(dados(t, pacote, mudar), ctxDe(t, idade));
}

function ad(parcial: Partial<AdicionalRedacao> & Pick<Adicional, "tipo">): AdicionalRedacao {
  return { id: "x", descricao: "", quantidade: 1, valorUnitario: 10000, minutos: 0, unidade: null, ...parcial };
}

// ------------------------------------------------------------- tabelas --

test("todo id do modelo tem titulo, e o cabecalho e 'CLÁUSULA N - TÍTULO'", () => {
  for (const id of IDS_CLAUSULA) assert.ok(TITULOS_CLAUSULA[id]?.trim(), id);
  assert.equal(cabecalhoClausula(7, TITULOS_CLAUSULA.pagamento), "CLÁUSULA 7 - DO PAGAMENTO");
});

test("data por extenso em minusculas, com o dia primeiro ordinal", () => {
  assert.equal(dataPorExtenso("2027-01-23"), "23 de janeiro de 2027");
  assert.equal(dataPorExtenso("2027-03-01"), "1º de março de 2027");
  assert.equal(dataPorExtenso("2027-03-10"), "10 de março de 2027");
});

test("frase de cada Reels depois de 'um'/'outro'", () => {
  assert.equal(fraseDoReels("resumo do evento"), "com o resumo do evento");
  assert.equal(fraseDoReels("exclusivo do making of"), "exclusivo do making of");
  assert.equal(fraseDoReels("do ensaio fotográfico."), "do ensaio fotográfico");
  assert.equal(fraseDoReels("a entrada da debutante"), "com a entrada da debutante");
  assert.equal(fraseDoReels("  "), "");
});

// ---------------------------------------------------------------- objeto --

test("objeto: personalizado nao diz 'no Personalizado'", () => {
  const p = clausulaObjeto(base("casamento", "Personalizado")).paragrafos[0];
  assert.ok(p.startsWith("O presente contrato tem por objeto a prestação de serviços de storymaker, consistindo na cobertura do casamento de Sofia,"));
});

test("objeto: dois Reels levam 'cada' e a lista 'um ... e outro ...'", () => {
  const p = clausulaObjeto(base("debutante", "Pacote Premium", undefined, 15)).paragrafos[0];
  assert.equal(
    p,
    "O presente contrato tem por objeto a prestação de serviços de storymaker, no Pacote Premium, consistindo na cobertura da festa de 15 (quinze) anos de Sofia, pelo período de até 5 (cinco) horas, acrescido de até 2 (duas) horas de making of, através de registros em formato de stories ilimitados (Instagram), incluindo stories do making of e dos melhores momentos do evento, bem como a gravação e edição de 2 (dois) Reels de até 1 (um) minuto e 30 (trinta) segundos cada, sendo um exclusivo do making of e outro com o resumo do evento.",
  );
});

test("objeto: making of e ensaio juntos, tres Reels e o bonus em 'Inclui-se, ainda'", () => {
  const c = clausulaObjeto(base("debutante", "Pacote Luxo", undefined, 15));
  assert.ok(
    c.paragrafos[0].includes(
      "pelo período de até 5 (cinco) horas, acrescido de até 2 (duas) horas de making of, e de até 2 (duas) horas de cobertura do ensaio fotográfico, através de registros",
    ),
  );
  assert.ok(c.paragrafos[0].endsWith("3 (três) Reels de até 1 (um) minuto e 30 (trinta) segundos cada, sendo um do ensaio fotográfico, um do making of e outro com o resumo do evento."));
  assert.deepEqual(c.paragrafos.slice(1), ["Inclui-se, ainda: 10 (dez) fotos Polaroid, como bônus."]);
});

test("objeto: sem stories e sem Reels, as frases correspondentes somem sem deixar virgula", () => {
  const b = base("corporativo", "Pacote Pocket", (d) => {
    d.servico.escopo.stories = false;
    d.servico.escopo.reels = [];
  });
  assert.equal(
    clausulaObjeto(b).paragrafos[0],
    "O presente contrato tem por objeto a prestação de serviços de storymaker, no Pacote Pocket, consistindo na cobertura do evento corporativo da empresa Sofia, pelo período de até 2 (duas) horas.",
  );
});

test("objeto: descricao do evento por categoria (corporativo 'da empresa', com o tipo entre aspas)", () => {
  assert.ok(clausulaObjeto(base("aniversario_adulto", "Pacote Pocket", undefined, 30)).paragrafos[0].includes("cobertura da festa de aniversário de Sofia,"));
  const corp = base("corporativo", "Pacote Luxo", (d) => {
    d.evento.tipoEvento = "\"Convenção de vendas\"";
  });
  // "do evento corporativo de Vértice Soluções" soava traduzido: nome de empresa pede artigo ou "da empresa".
  assert.ok(
    clausulaObjeto(corp).paragrafos[0].includes(
      "cobertura do evento corporativo “Convenção de vendas” da empresa Sofia, pelo período de até 7 (sete) horas",
    ),
  );
});

test("objeto: equipe com dois auxiliares no plural", () => {
  const b = base("casamento", "Pacote Real Time", (d) => {
    d.servico.escopo.storymakers = 3;
  });
  assert.ok(clausulaObjeto(b).paragrafos.includes("A cobertura será realizada por equipe composta pela CONTRATADA e 2 (dois) storymakers auxiliares."));
  assert.ok(
    clausulaServicos(b).paragrafos.includes(
      "C. Contar com 2 (dois) storymakers auxiliares, que atuarão em conjunto com a CONTRATADA durante a cobertura, seguindo as diretrizes por ela estabelecidas.",
    ),
  );
});

test("objeto: dado digitado com marcacao do contrato nao vira negrito nem remissao", () => {
  const b = base("casamento", "Pacote Principal", (d) => {
    d.evento.homenageado = "**Ana** e {{João}}";
  });
  assert.ok(clausulaObjeto(b).paragrafos[0].includes("do casamento de Ana e João,"));
});

// ----------------------------------------------------------------- local --

test("local: making of com local e sem horario, e o tempo de servico detalhado", () => {
  const b = base("aniversario_adulto", "Pacote Luxo", (d) => {
    d.evento.makingOfLocal = "Casa da aniversariante.";
  }, 30);
  assert.deepEqual(clausulaLocal(b).paragrafos, [
    "Data do evento: 1º de maio de 2027;",
    "Início da cobertura do evento: 18h;",
    "Local do evento: Salão Flor de Lis, Rua Dez, 100, Jundiaí/SP;",
    "Local do making of: Casa da aniversariante;",
    "Início do making of: A DEFINIR, devendo ser informado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
    "Tempo de serviço: 6 (seis) horas e 30 (trinta) minutos (1h30 de making of + 5h de cobertura do evento).",
  ]);
});

test("local: sem making of, o tempo de servico e uma parcela so, sem parenteses", () => {
  const b = base("corporativo", "Pacote Pocket", (d) => {
    d.evento.locais.push({ rotulo: "", endereco: "" });
    d.evento.horarioInicio = "09:05";
  });
  assert.deepEqual(clausulaLocal(b).paragrafos, [
    "Data do evento: 1º de maio de 2027;",
    "Início da cobertura do evento: 9h05;",
    "Local do evento: Salão Flor de Lis, Rua Dez, 100, Jundiaí/SP;",
    "Tempo de serviço: 2 (duas) horas.",
  ]);
});

// -------------------------------------------------------------- servicos --

test("servicos: sem stories, o Reels vira o item A e os extras fecham a lista", () => {
  const b = base("aniversario_infantil", "Pacote Luxo", (d) => {
    d.servico.escopo.stories = false;
  }, 8);
  assert.deepEqual(clausulaServicos(b).paragrafos, [
    "A. Gravar e editar 1 (um) Reels/Vídeo com o resumo do evento, com duração de até 1 (um) minuto e 30 (trinta) segundos.",
    "B. Disponibilizar o cantinho das fotos Polaroid com álbum de recados.",
  ]);
  assert.equal(clausulaInstagram(b), null, "sem stories, sem a clausula do Instagram");
});

test("servicos: extra que comeca com quantidade e 'Entregar'", () => {
  const b = base("debutante", "Pacote Luxo", undefined, 15);
  assert.equal(clausulaServicos(b).paragrafos.at(-1), "C. Entregar 10 (dez) fotos Polaroid, como bônus.");
});

test("servicos: prazo de 1 dia util no singular, antes da conta (o prazo e da publicacao, nao do fornecimento da conta)", () => {
  const b = base("casamento", "Pacote Principal", (d) => {
    d.servico.escopo.diasStories = 1;
  });
  assert.equal(
    clausulaServicos(b).paragrafos[0],
    "A. Realizar stories ilimitados do evento, utilizando equipamento próprio, com publicação, em até 1 (um) dia útil após o evento, diretamente na conta do Instagram fornecida pela CONTRATANTE.",
  );
});

// ------------------------------------------------------------- adicionais --

test("hora adicional: uma hora sem 'por hora'; varias com unitario e total", () => {
  const hora = ad({ tipo: "hora_adicional", descricao: "hora adicional de cobertura", valorUnitario: 35000, unidade: "hora" });
  assert.equal(textoAdicional(hora), "1 (uma) hora adicional de cobertura, no valor de R$ 350,00 (trezentos e cinquenta reais).");
  assert.equal(
    textoAdicional({ ...hora, quantidade: 3 }),
    "3 (três) horas adicionais de cobertura, no valor de R$ 350,00 (trezentos e cinquenta reais) por hora, totalizando R$ 1.050,00 (mil e cinquenta reais).",
  );
  assert.equal(
    textoAdicional({ ...hora, descricao: "Cobertura da after party", quantidade: 2 }),
    "Cobertura da after party: 2 (duas) horas, no valor de R$ 350,00 (trezentos e cinquenta reais) por hora, totalizando R$ 700,00 (setecentos reais).",
  );
});

test("adicional por unidade: um so com o valor; varios em 'unidades'", () => {
  const reels = ad({
    tipo: "reels",
    descricao: "Reels ou trend adicional, de até 1 (um) minuto e 30 (trinta) segundos",
    valorUnitario: 30000,
    unidade: "unidade",
  });
  assert.equal(
    textoAdicional(reels),
    "Reels ou trend adicional, de até 1 (um) minuto e 30 (trinta) segundos, no valor de R$ 300,00 (trezentos reais).",
  );
  assert.equal(
    textoAdicional({ ...reels, quantidade: 2 }),
    "Reels ou trend adicional, de até 1 (um) minuto e 30 (trinta) segundos: 2 (duas) unidades, no valor de R$ 300,00 (trezentos reais) por unidade, totalizando R$ 600,00 (seiscentos reais).",
  );
});

test("adicional de valor fechado: descricao com inicial maiuscula e sem ponto duplicado", () => {
  assert.equal(
    textoAdicional(ad({ tipo: "locomocao", descricao: "despesas de locomoção da CONTRATADA até o local do evento.", valorUnitario: 12050 })),
    "Despesas de locomoção da CONTRATADA até o local do evento, no valor de R$ 120,50 (cento e vinte reais e cinquenta centavos).",
  );
  assert.equal(
    textoAdicional(ad({ tipo: "storymaker", descricao: "1 (um) storymaker auxiliar, para a cobertura em tempo real", valorUnitario: 50000 })),
    "1 (um) storymaker auxiliar, para a cobertura em tempo real, no valor de R$ 500,00 (quinhentos reais).",
  );
});

test("making of adicional: duracao por extenso", () => {
  assert.equal(
    textoAdicional(ad({ tipo: "making_of", descricao: "Making of do noivo", valorUnitario: 38000, minutos: 90 })),
    "Making of do noivo, com duração de até 1 (uma) hora e 30 (trinta) minutos, no valor de R$ 380,00 (trezentos e oitenta reais).",
  );
});

test("making ofs contados: o do pacote mais os adicionais", () => {
  const noiva = novoAdicional(adicionalDoCatalogo("casamento", "casamento.making_of_noiva")!, "", "2027");
  const b = base("debutante", "Pacote Premium", (d) => {
    d.servico.adicionais = [noiva];
  }, 15);
  assert.equal(quantidadeMakingOfs(b), 2);
});

// ----------------------------------------------------------------- prazos --

test("prazos: material antes dos Reels (debutante 4/4/7)", () => {
  assert.equal(
    clausulaPrazos(base("debutante", "Pacote Básico", undefined, 15)).paragrafos[0],
    "A CONTRATADA compromete-se a entregar a cobertura completa dos stories no prazo de até 4 (quatro) dias úteis após o evento, todo o material bruto captado no prazo de até 4 (quatro) dias úteis e o Reels em até 7 (sete) dias úteis.",
  );
});

test("prazos: material depois dos Reels mantem os dois prazos", () => {
  const b = base("casamento", "Pacote Principal", (d) => {
    d.servico.escopo.diasMaterial = 10;
  });
  assert.equal(
    clausulaPrazos(b).paragrafos[0],
    "A CONTRATADA compromete-se a entregar a cobertura completa dos stories no prazo de até 5 (cinco) dias úteis após o evento, o Reels no prazo de até 7 (sete) dias úteis e todo o material bruto captado em até 10 (dez) dias úteis.",
  );
});

test("prazos: sem Reels, so stories e material bruto", () => {
  const b = base("casamento", "Pacote Principal", (d) => {
    d.servico.escopo.reels = [];
  });
  assert.equal(
    clausulaPrazos(b).paragrafos[0],
    "A CONTRATADA compromete-se a entregar a cobertura completa dos stories no prazo de até 5 (cinco) dias úteis após o evento, bem como todo o material bruto captado no prazo de até 7 (sete) dias úteis.",
  );
});

test("condicoes tecnicas: varios Reels e prazos diferentes para Reels e material", () => {
  const b = base("casamento", "Pacote Real Time", (d) => {
    d.servico.escopo.reels = ["resumo do evento", "da cerimônia"];
    d.servico.escopo.diasMaterial = 10;
  });
  assert.equal(
    clausulaCondicoesTecnicas(b).paragrafos[4],
    "A CONTRATADA compromete-se, ainda, a entregar os Reels no prazo de até 7 (sete) dias úteis após a data do evento, e o material bruto captado em até 10 (dez) dias úteis.",
  );
});

// -------------------------------------------------------------- pagamento --

test("vencimentos: assinatura, data, dias antes (inclusive 1 e 0) e ja pago", () => {
  assert.equal(textoVencimento({ tipo: "assinatura" }), "a ser pago na assinatura deste contrato");
  assert.equal(textoVencimento({ tipo: "data", data: "2027-02-01" }), "com vencimento em 1º de fevereiro de 2027");
  assert.equal(textoVencimento({ tipo: "dias_antes", dias: 10 }), "a ser pago até 10 (dez) dias antes da data do evento");
  assert.equal(textoVencimento({ tipo: "dias_antes", dias: 1 }), "a ser pago até 1 (um) dia antes da data do evento");
  assert.equal(textoVencimento({ tipo: "dias_antes", dias: 0 }), "a ser pago até a data do evento");
  assert.equal(textoVencimento({ tipo: "pago", data: "2026-08-20" }), "já pago pela CONTRATANTE em 20 de agosto de 2026");
});

test("pagamento: sinal em duas parcelas ja pagas nao repete a frase em negrito", () => {
  const b = base("casamento", "Pacote Principal", (d) => {
    d.pagamento.parcelas = [
      { percentual: 15, sinal: true, vencimento: { tipo: "pago", data: "2026-09-01" } },
      { percentual: 15, sinal: true, vencimento: { tipo: "pago", data: "2026-09-15" } },
      { percentual: 70, sinal: false, vencimento: { tipo: "dias_antes", dias: 10 } },
    ];
  });
  assert.ok(
    clausulaPagamento(b).paragrafos.includes(
      "O sinal destinado a garantir a reserva da data corresponde à soma das parcelas acima identificadas como parte do sinal, no total de R$ 360,00 (trezentos e sessenta reais), e a reserva da data fica garantida com o sinal já pago.",
    ),
  );
});

test("pagamento: sinal partido diz 'como parte do sinal' em cada parcela, e a reserva so no resumo", () => {
  const b = base("casamento", "Pacote Principal", (d) => {
    d.pagamento = pagamentoDoPreset("15/15/70");
    d.pagamento.parcelas[1].vencimento = { tipo: "data", data: "2026-12-15" };
  });
  const p = clausulaPagamento(b).paragrafos;
  const parcelas = p.filter((x) => /^[A-C]\. /.test(x));
  assert.ok(parcelas[0].includes(", como parte do sinal, a ser pago na assinatura"));
  assert.ok(parcelas[1].includes(", como parte do sinal, com vencimento em 15 de dezembro de 2026"));
  // Repetido em cada parcela, "para garantir a reserva da data" fazia a
  // CONTRATANTE ler a data reservada ja na primeira, e o resumo desmentia.
  assert.equal(p.filter((x) => x.includes("garantir a reserva da data")).length, 1);
  assert.ok(p.some((x) => x.startsWith("O sinal destinado a garantir a reserva da data") && x.endsWith("confirmação do pagamento integral do sinal.**")));

  const umSinal = clausulaPagamento(base("casamento", "Pacote Principal")).paragrafos;
  assert.ok(umSinal[1].includes(", a título de sinal para garantir a reserva da data, a ser pago na assinatura"), "com um sinal so, nada muda");
});

// ---------------------------------------------------------------- direitos --

const ANUENTE_RAFAEL = {
  ativo: true,
  nome: "Rafael Costa",
  genero: "masculino" as const,
  cpf: "22233366638",
  email: "rafa@exemplo.com.br",
  papel: "palestrante",
};

test("direitos: pessoa juridica com anuente -- a autorizacao dele e um item proprio, nas mesmas condicoes", () => {
  const b = base("corporativo", "Pacote Premium", (d) => {
    d.contratante.tipo = "pj";
    d.anuente = { ...ANUENTE_RAFAEL };
  });
  const p = clausulaDireitos(b).paragrafos;
  assert.ok(p[1].endsWith("com a CONTRATANTE e com outros fornecedores envolvidos no evento.**"));
  assert.equal(
    p[2],
    "{{n}}.3. **Rafael Costa, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.**",
  );
  assert.equal(p.length, 3);
});

test("direitos: autorizacao da CONTRATANTE e do anuente em itens separados, com o alcance na da CONTRATANTE", () => {
  // Numa frase so, "captadas no evento, no portfólio ... inclusive em anúncios
  // pagos" ficava preso a oracao do anuente, e a autorizacao da CONTRATANTE
  // sem finalidade expressa.
  const b = base("casamento", "Pacote Principal", (d) => {
    d.anuente = { ...ANUENTE_RAFAEL, papel: "noivo" };
  });
  assert.deepEqual(clausulaDireitos(b).paragrafos.slice(1), [
    "{{n}}.2. **A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar sua imagem e voz, captadas no evento, no portfólio e na divulgação do trabalho da CONTRATADA em seu site e em seus perfis profissionais nas redes sociais, inclusive em anúncios pagos, podendo as publicações incluir marcações, menções ou colaborações com outros fornecedores envolvidos no evento.**",
    "{{n}}.3. **Rafael Costa, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.**",
  ]);
});

test("direitos: evento de menor com anuente -- o item dos menores vira o 4", () => {
  const b = base(
    "debutante",
    "Pacote Básico",
    (d) => {
      d.anuente = { ...ANUENTE_RAFAEL, papel: "pai da debutante" };
    },
    15,
  );
  const p = clausulaDireitos(b).paragrafos;
  assert.ok(p[1].includes("a utilizar sua imagem e voz e, na qualidade de mãe e representante legal, a imagem e a voz de Sofia, captadas no evento"));
  assert.ok(p[2].startsWith("{{n}}.3. **Rafael Costa, na qualidade de anuente, autoriza"));
  assert.match(p[3], /^\{\{n\}\}\.4\. As publicações da CONTRATADA não incluirão/);
});

test("direitos: empresa contratando evento de menor -- o anuente responsavel autoriza tambem a imagem do menor", () => {
  const b = base(
    "aniversario_infantil",
    "Pacote Básico",
    (d) => {
      d.contratante.tipo = "pj";
      d.anuente = { ...ANUENTE_RAFAEL, papel: "pai do aniversariante" };
    },
    6,
  );
  const p = clausulaDireitos(b).paragrafos;
  assert.equal(
    p[2],
    "{{n}}.3. **Rafael Costa, na qualidade de anuente e de responsável legal de Sofia, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz e a imagem e a voz de Sofia.**",
  );
  assert.match(p[3], /^\{\{n\}\}\.4\. As publicações/);
  assert.ok(
    parteAnuente(b)!.texto.includes(
      "exclusivamente para autorizar o uso de sua imagem e voz e da imagem e da voz de Sofia, de quem é responsável legal, nos termos da Cláusula {{ref:direitos}}.",
    ),
  );
});

test("direitos: empresa nao assiste menor -- aniversariante de 17 como anuente sai sem 'assistido pela CONTRATANTE'", () => {
  const b = base(
    "aniversario_adulto",
    "Pacote Pocket",
    (d) => {
      d.contratante.tipo = "pj";
      d.anuente = { ...ANUENTE_RAFAEL, papel: "aniversariante" };
    },
    17,
  );
  const p = clausulaDireitos(b).paragrafos;
  assert.equal(p[2], "{{n}}.3. **Rafael Costa, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.**");
});

// ---------------------------------------------------------------- partes --

test("preambulo: com anuente, as tres partes nomeadas e a remissao aos direitos", () => {
  assert.equal(preambuloDoContrato(base("casamento", "Pacote Principal")), PREAMBULO);
  assert.equal(
    preambuloDoContrato(base("casamento", "Pacote Principal", (d) => (d.anuente = { ...ANUENTE_RAFAEL, papel: "noivo" }))),
    "Pelo presente instrumento particular, as partes acima identificadas e qualificadas, doravante denominadas simplesmente CONTRATANTE, CONTRATADA e ANUENTE, esta última interveniente apenas para os fins da Cláusula {{ref:direitos}}, têm entre si justo e contratado o que segue, nos termos e condições abaixo:",
  );
});

test("direitos: a remissao e o numero da propria clausula ficam como marcacao ate a leitura", () => {
  const p = clausulaDireitos(base("casamento", "Pacote Principal")).paragrafos;
  assert.ok(p[0].startsWith("{{n}}.1. "));
  assert.ok(p[1].startsWith("{{n}}.2. **") && p[1].endsWith(".**"));
  assert.equal(p.length, 2, "casamento nao e evento de menor");
});

// -------------------------------------------------------------- alimentacao --

test("alimentacao: concordancia com a equipe (tem / têm, profissional / profissionais)", () => {
  const texto = (n: number) =>
    clausulaAlimentacao(
      base("casamento", "Pacote Principal", (d) => {
        d.servico.escopo.storymakers = n;
      }),
    )!.paragrafos[0];
  // "bem como A TER acesso À alimentação e ÀS bebidas": o segundo termo com a mesma regencia do primeiro.
  assert.equal(
    texto(1),
    "A CONTRATANTE informará à equipe do local do evento que a CONTRATADA tem direito a se servir do buffet, bem como a ter acesso à alimentação e às bebidas não alcoólicas disponibilizadas durante o evento.",
  );
  assert.equal(
    texto(2),
    "A CONTRATANTE informará à equipe do local do evento que a CONTRATADA e 1 (um) profissional de sua equipe têm direito a se servir do buffet, bem como a ter acesso à alimentação e às bebidas não alcoólicas disponibilizadas durante o evento.",
  );
  assert.ok(texto(3).includes("que a CONTRATADA e 2 (dois) profissionais de sua equipe têm direito"));
  assert.equal(
    clausulaAlimentacao(
      base("casamento", "Pacote Principal", (d) => {
        d.evento.alimentacao = false;
      }),
    ),
    null,
  );
});

// ------------------------------------------------------- condicoes especiais --

test("condicoes especiais: paragrafos limpos, o paragrafo unico no fim e origem 'ia'", () => {
  const c = clausulaCondicoesEspeciais(["  Fica acordado que\na CONTRATADA chegará antes.  ", "", "   "]);
  assert.ok(c);
  assert.deepEqual(c.paragrafos, ["Fica acordado que a CONTRATADA chegará antes.", PARAGRAFO_UNICO_CONDICOES_ESPECIAIS]);
  assert.equal(c.origem, "ia");
  assert.equal(c.titulo, "DAS CONDIÇÕES ESPECIAIS");
  assert.equal(clausulaCondicoesEspeciais([]), null);
  assert.equal(clausulaCondicoesEspeciais(null), null);
});

// ------------------------------------------------------ storymaker auxiliar --

function comStorymakerPorHora(horas: number, mudar: Mudar = () => {}) {
  return base(
    "aniversario_infantil",
    "Pacote Premium",
    (d) => {
      const item = adicionalDoCatalogo("aniversario_infantil", "aniversario_infantil.storymaker")!;
      d.servico.adicionais = [{ ...novoAdicional(item, "Pacote Premium", "2027"), quantidade: horas }];
      mudar(d);
    },
    6,
  );
}

test("auxiliar por hora, por menos horas que a cobertura: 'por até N horas', nunca equipe o evento inteiro", () => {
  // Pacote Premium do infantil = 5 h; o auxiliar foi contratado por 2.
  const b = comStorymakerPorHora(2);
  assert.equal(b.escopo.storymakers, 1, "a equipe da cobertura inteira continua so a CONTRATADA");
  assert.equal(b.escopo.minutosAuxiliar, 120);

  const objeto = clausulaObjeto(b).paragrafos;
  assert.ok(objeto.includes("A cobertura contará, por até 2 (duas) horas, com 1 (um) storymaker auxiliar."));
  assert.ok(!objeto.some((p) => p.includes("equipe composta")));
  assert.ok(
    clausulaServicos(b).paragrafos.includes(
      "C. Contar, por até 2 (duas) horas, com 1 (um) storymaker auxiliar, que atuará em conjunto com a CONTRATADA, seguindo as diretrizes por ela estabelecidas.",
    ),
  );
  assert.equal(
    clausulaAlimentacao(b)!.paragrafos[0],
    "A CONTRATANTE informará à equipe do local do evento que a CONTRATADA e 1 (um) profissional de sua equipe, que atuará por até 2 (duas) horas, têm direito a se servir do buffet, bem como a ter acesso à alimentação e às bebidas não alcoólicas disponibilizadas durante o evento.",
  );
});

test("auxiliar por hora que cobre a cobertura inteira (ja somada a hora adicional) vira equipe de dois", () => {
  const inteiro = comStorymakerPorHora(5);
  assert.equal(inteiro.escopo.storymakers, 2);
  assert.equal(inteiro.escopo.minutosAuxiliar, 300);
  assert.ok(clausulaObjeto(inteiro).paragrafos.includes("A cobertura será realizada por equipe composta pela CONTRATADA e 1 (um) storymaker auxiliar."));

  // Com 1 hora adicional a cobertura vai a 6 h, e as mesmas 5 h de auxiliar voltam a ser parciais.
  const comHoraExtra = comStorymakerPorHora(5, (d) => {
    const hora = adicionalDoCatalogo("aniversario_infantil", "aniversario_infantil.hora_adicional")!;
    d.servico.adicionais.push(novoAdicional(hora, "Pacote Premium", "2027"));
  });
  assert.equal(comHoraExtra.escopo.storymakers, 1);
  assert.ok(clausulaObjeto(comHoraExtra).paragrafos.includes("A cobertura contará, por até 5 (cinco) horas, com 1 (um) storymaker auxiliar."));
});

test("storymaker adicional por evento (debutante) continua sendo equipe a cobertura inteira", () => {
  const b = base(
    "debutante",
    "Pacote Básico",
    (d) => {
      d.servico.adicionais = [novoAdicional(adicionalDoCatalogo("debutante", "debutante.storymaker")!, "Pacote Básico", "2027")];
    },
    15,
  );
  assert.equal(b.escopo.storymakers, 2);
  assert.equal(b.escopo.minutosAuxiliar, 300);
});

test("adicional que indica segunda pessoa: todo storymaker e o livre que fala em storymaker, auxiliar ou simultaneo", () => {
  const livre = (descricao: string) => ({ id: "livre-1", tipo: "outro" as const, descricao });
  assert.equal(adicionalIndicaSegundaPessoa({ id: "aniversario_infantil.storymaker", tipo: "storymaker", descricao: "" }), true);
  assert.equal(adicionalIndicaSegundaPessoa(livre("Storymaker auxiliar para o making of do noivo")), true);
  assert.equal(adicionalIndicaSegundaPessoa(livre("Making of do noivo simultâneo ao da noiva")), true);
  assert.equal(adicionalIndicaSegundaPessoa(livre("Profissional AUXILIAR no making of")), true);
  assert.equal(adicionalIndicaSegundaPessoa(livre("Vídeo de até 20 minutos")), false);
  // O Polaroid do catalogo tem "auxiliando os convidados": nao e livre, e nao e segunda storymaker.
  assert.equal(
    adicionalIndicaSegundaPessoa({ id: "casamento.polaroid", tipo: "polaroid", descricao: "com profissional no local auxiliando os convidados" }),
    false,
  );
});

test("dois making ofs com adicional livre de auxiliar simultaneo: sem o paragrafo 'impossibilitando a realização simultânea'", () => {
  const making = (id: string) => novoAdicional(adicionalDoCatalogo("casamento", id)!, "Pacote Principal", "2027");
  const semAuxiliar = base("casamento", "Pacote Principal", (d) => {
    d.servico.adicionais = [making("casamento.making_of_noiva"), making("casamento.making_of_noivo")];
  });
  assert.ok(clausulaAdicionais(semAuxiliar)!.paragrafos.includes(PARAGRAFO_MAKING_OFS_ALTERNADOS));

  const comAuxiliar = base("casamento", "Pacote Principal", (d) => {
    d.servico.adicionais = [
      making("casamento.making_of_noiva"),
      making("casamento.making_of_noivo"),
      { id: "livre-1", tipo: "outro", descricao: "Storymaker auxiliar para o making of do noivo, simultâneo ao da noiva", quantidade: 1, valorUnitario: 30000, minutos: 0 },
    ];
  });
  assert.ok(!clausulaAdicionais(comAuxiliar)!.paragrafos.includes(PARAGRAFO_MAKING_OFS_ALTERNADOS));
});

// ------------------------------------------------------------------ ensaio --

function luxo(mudar: Mudar = () => {}) {
  return base("debutante", "Pacote Luxo", mudar, 15);
}

const ENSAIO_A_DEFINIR =
  "Ensaio fotográfico: A DEFINIR, com duração de até 2 (duas) horas, em data, horário e local de comum acordo entre as partes, anterior à data do evento e sujeitos à disponibilidade da CONTRATADA, devendo ser agendado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;";

test("ensaio sem data: A DEFINIR, de comum acordo, antes do evento, agendado com 10 dias; e fora do tempo de servico do dia", () => {
  assert.deepEqual(clausulaLocal(luxo()).paragrafos, [
    "Data do evento: 1º de maio de 2027;",
    "Início da cobertura do evento: 18h;",
    "Local do evento: Salão Flor de Lis, Rua Dez, 100, Jundiaí/SP;",
    "Local e início do making of: A DEFINIR, devendo ser informados pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
    ENSAIO_A_DEFINIR,
    // Antes: "9 (nove) horas (2h de making of + 2h de ensaio + 5h de cobertura do evento)",
    // lido como 2 h de ensaio no dia da festa.
    "Tempo de serviço no dia do evento: 7 (sete) horas (2h de making of + 5h de cobertura do evento).",
  ]);
});

test("ensaio com data, local e horario: uma linha para cada, como o making of", () => {
  const b = luxo((d) => {
    d.evento.ensaioData = "2027-04-10";
    d.evento.ensaioLocal = "Parque Ecológico, Rodovia Heitor Penteado, s/n, Campinas/SP.";
    d.evento.ensaioHorario = "15:30";
  });
  assert.deepEqual(clausulaLocal(b).paragrafos.slice(4, 7), [
    "Ensaio fotográfico: 10 de abril de 2027, com duração de até 2 (duas) horas;",
    "Local do ensaio fotográfico: Parque Ecológico, Rodovia Heitor Penteado, s/n, Campinas/SP;",
    "Início do ensaio fotográfico: 15h30;",
  ]);
});

test("ensaio preenchido pela metade: o que falta fica A DEFINIR, sem repetir o que ja foi dito", () => {
  const soData = luxo((d) => {
    d.evento.ensaioData = "2027-04-10";
  });
  assert.deepEqual(clausulaLocal(soData).paragrafos.slice(4, 7), [
    "Ensaio fotográfico: 10 de abril de 2027, com duração de até 2 (duas) horas;",
    "Local do ensaio fotográfico: A DEFINIR, devendo ser informado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
    "Início do ensaio fotográfico: A DEFINIR, devendo ser informado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
  ]);

  const soLocal = luxo((d) => {
    d.evento.ensaioLocal = "Estúdio Luz";
  });
  assert.deepEqual(clausulaLocal(soLocal).paragrafos.slice(4, 6), [
    "Ensaio fotográfico: A DEFINIR, com duração de até 2 (duas) horas, em data e horário de comum acordo entre as partes, anterior à data do evento e sujeitos à disponibilidade da CONTRATADA, devendo ser agendado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
    "Local do ensaio fotográfico: Estúdio Luz;",
  ]);

  const localEHora = luxo((d) => {
    d.evento.ensaioLocal = "Estúdio Luz";
    d.evento.ensaioHorario = "10:00";
  });
  assert.ok(
    clausulaLocal(localEHora).paragrafos[4].includes("em data de comum acordo entre as partes, anterior à data do evento e sujeita à disponibilidade da CONTRATADA"),
    "uma coisa so a definir: 'sujeita', no singular",
  );
});

test("sem ensaio no escopo, os campos do ensaio nao entram no contrato", () => {
  const b = base(
    "debutante",
    "Pacote Premium",
    (d) => {
      d.evento.ensaioData = "2027-04-10";
    },
    15,
  );
  assert.ok(!clausulaLocal(b).paragrafos.some((p) => p.includes("ensaio")));
});

// -------------------------------------------------------------- desistencia --

test("desistencia: restitui o que foi pago alem do sinal, aproveita os valores no adiamento livre, e a reciprocidade fica por ultimo", () => {
  assert.deepEqual(clausulaDesistencia({ sinal: 38700 }).paragrafos, [
    "{{n}}.1. **Em caso de desistência ou cancelamento do evento pela CONTRATANTE, o sinal previsto na Cláusula {{ref:pagamento}} não será reembolsado.**",
    "{{n}}.2. **Se o evento for adiado e a nova data coincidir com outro compromisso da CONTRATADA, o serviço não será prestado e o sinal não será reembolsado.**",
    "{{n}}.3. Nas hipóteses dos itens {{n}}.1 e {{n}}.2, os valores pagos além do sinal serão restituídos à CONTRATANTE em até 10 (dez) dias.",
    "{{n}}.4. Adiado o evento a pedido da CONTRATANTE para data em que a CONTRATADA esteja disponível, os valores já pagos serão aproveitados para a nova data.",
    "{{n}}.5. Caso a CONTRATADA deixe de prestar os serviços por motivo a ela imputável, fora das hipóteses da Cláusula {{ref:equipe}}, restituirá à CONTRATANTE, em até 10 (dez) dias, a integralidade dos valores pagos, acrescida de quantia equivalente ao sinal, sem prejuízo dos demais direitos assegurados à CONTRATANTE pela legislação.",
  ]);
});

test("desistencia sem sinal (pagamento personalizado sem entrada): sem retencao, com adiamento e reciprocidade", () => {
  assert.deepEqual(clausulaDesistencia({ sinal: 0 }).paragrafos, [
    "{{n}}.1. Adiado o evento a pedido da CONTRATANTE para data em que a CONTRATADA esteja disponível, os valores já pagos serão aproveitados para a nova data.",
    "{{n}}.2. Caso a CONTRATADA deixe de prestar os serviços por motivo a ela imputável, fora das hipóteses da Cláusula {{ref:equipe}}, restituirá à CONTRATANTE, em até 10 (dez) dias, a integralidade dos valores pagos, sem prejuízo dos demais direitos assegurados à CONTRATANTE pela legislação.",
  ]);
});

// ------------------------------------------------------------ equipe e foro --

test("equipe: 'comunicando o fato à CONTRATANTE' (comunicar algo a alguem)", () => {
  assert.ok(clausulaEquipe().paragrafos[0].includes(", comunicando o fato à CONTRATANTE tão logo tenha conhecimento do impedimento."));
});

test("foro: 'justas e contratadas, as partes assinam', na pessoa fisica e na juridica", () => {
  const fecho = "E, por estarem assim justas e contratadas, as partes assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito.";
  assert.ok(clausulaForo(base("casamento", "Pacote Principal")).paragrafos[0].endsWith(fecho));
  const pj = base("corporativo", "Pacote Pocket", (d) => {
    d.contratante.tipo = "pj";
  });
  assert.ok(clausulaForo(pj).paragrafos[0].endsWith(fecho));
  assert.ok(!clausulaForo(pj).paragrafos[0].includes("justos"));
});
