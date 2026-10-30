import assert from "node:assert/strict";
import { test } from "node:test";
import { pacoteDoCatalogo, precoPacote } from "./catalogo";
import { PARAGRAFO_UNICO_CONDICOES_ESPECIAIS } from "./clausulas";
import { CamposFaltandoContratoError, faltantes, montarContrato, totalContrato, type ContextoMontagem } from "./montar";
import {
  condicoesNegociadasCasamento,
  editarCondicoesCasamento,
  editarServicoCasamento,
  ErroNegociacaoCasamento,
  iniciarNegociacaoCasamento,
  mudarModoCasamento,
  OPCOES_CASAMENTO,
  opcaoCasamentoSelecionada,
  resolverNegociacaoCasamento,
  selecionarOpcaoCasamento,
} from "./negociacao-casamento";
import { pagamentoDoPreset } from "./pagamento";
import { dadosContratoSchema, type DadosContrato, type Servico } from "./tipos";
import { textoCorrido, validarDocumento } from "./validar";

const CTX: ContextoMontagem = {
  categoria: "casamento", templateId: "casamento", hojeISO: "2026-10-29", idadeHomenageado: null,
};

/** Dados inteiramente ficticios, sem rede, banco, IA ou envio. */
function dadosBase(pacote = "Pacote Principal"): DadosContrato {
  const catalogo = pacoteDoCatalogo("casamento", pacote)!;
  return dadosContratoSchema.parse({
    contratante: { pf: {
      nome: "Ana Paula Fictícia", genero: "feminino", cpf: "12345678909", email: "ana@example.com",
      endereco: { logradouro: "Rua Fictícia", numero: "10", bairro: "Centro", cidade: "Campinas", uf: "SP" },
    } },
    evento: {
      data: "2027-08-14", horarioInicio: "17:00", homenageado: "Ana & João",
      locais: [{ rotulo: "Local da cerimônia e recepção", endereco: "Salão Fictício, Campinas/SP" }],
    },
    servico: { tabela: "2027", pacote, valorPacote: precoPacote("casamento", "2027", pacote)!, escopo: catalogo.escopo },
    pagamento: pagamentoDoPreset("30/70"),
  });
}

function congelar<T>(valor: T): T {
  if (valor && typeof valor === "object") {
    Object.freeze(valor);
    for (const filho of Object.values(valor)) congelar(filho);
  }
  return valor;
}

function personalizado(dados = iniciarNegociacaoCasamento(dadosBase())): DadosContrato {
  return editarServicoCasamento(dados, {
    ...dados.servico, valorPacote: 149099, desconto: 0,
    escopo: { ...dados.servico.escopo, minutosCobertura: 240, extras: ["12 fotografias digitais escolhidas pelo casal"] },
  });
}

test("metadados sao opcionais, sem criar chave em contratos legados", () => {
  const dados = dadosBase();
  assert.equal("negociacaoCasamento" in dados, false);
  for (const ctx of [CTX, { categoria: "corporativo", templateId: "corporativo" }, { categoria: "aniversario" }]) {
    assert.equal(resolverNegociacaoCasamento(dados, ctx), dados);
  }
});

test("catalogo identifica Opção 1/2 pelos pacotes reais, sem inventar a duração do exemplo", () => {
  assert.deepEqual(OPCOES_CASAMENTO.map(({ id, pacote }) => ({ id, pacote })), [
    { id: "opcao1", pacote: "Pacote Principal" }, { id: "opcao2", pacote: "Pacote Real Time" },
  ]);
  for (const opcao of OPCOES_CASAMENTO) {
    const dados = iniciarNegociacaoCasamento(dadosBase(opcao.pacote));
    assert.equal(opcaoCasamentoSelecionada(dados), opcao.id);
    assert.equal(dados.negociacaoCasamento![opcao.id].modo, "original");
    assert.equal(dados.servico.escopo.minutosCobertura, 300);
  }
});

test("inicializacao preserva servico legado editado como rascunho personalizado e nao muta entrada", () => {
  const legado = dadosBase();
  legado.servico.escopo.minutosCobertura = 240;
  legado.servico.valorPacote = 149099;
  const original = structuredClone(legado);
  congelar(legado);
  const novo = iniciarNegociacaoCasamento(legado);
  assert.deepEqual(novo.servico, original.servico);
  assert.equal(novo.negociacaoCasamento!.opcao1.modo, "personalizado");
  assert.deepEqual(novo.negociacaoCasamento!.opcao1.servico, original.servico);
  assert.equal(novo.negociacaoCasamento!.opcao2.modo, "original");
  assert.deepEqual(legado, original);
  assert.equal(iniciarNegociacaoCasamento(novo), novo);
});

test("adicionais legados sao preservados e reconhecidos como negociação", () => {
  const dados = dadosBase();
  dados.servico.adicionais.push({ id: "livre-1", tipo: "outro", descricao: "Entrega extra", quantidade: 1, valorUnitario: 10000, minutos: 0 });
  const novo = iniciarNegociacaoCasamento(dados);
  assert.deepEqual(novo.servico.adicionais, dados.servico.adicionais);
  assert.equal(novo.negociacaoCasamento!.opcao1.modo, "personalizado");
});

test("legado sob medida permanece editavel sem inferir origem; escolha explicita abre os novos rascunhos", () => {
  const legado = dadosBase();
  legado.servico.pacote = "Personalizado";
  assert.equal(iniciarNegociacaoCasamento(legado), legado);
  assert.equal(opcaoCasamentoSelecionada(legado), null);
  const editado = editarServicoCasamento(legado, { ...legado.servico, valorPacote: 198076 });
  assert.equal(editado.servico.valorPacote, 198076);
  assert.equal(editado.negociacaoCasamento, undefined);
  const escolhido = selecionarOpcaoCasamento(editado, "opcao2");
  assert.equal(escolhido.servico.pacote, "Pacote Real Time");
  assert.equal(escolhido.negociacaoCasamento!.opcao2.modo, "original");
});

test("alternar opções e recarregar JSON preserva duração, valores e condições independentes", () => {
  let dados = editarCondicoesCasamento(personalizado(), "Chegada pela entrada lateral.");
  const opcao1 = structuredClone(dados.negociacaoCasamento!.opcao1);
  dados = selecionarOpcaoCasamento(dados, "opcao2");
  assert.equal(dados.servico.escopo.tempoReal, true);
  dados = editarServicoCasamento(dados, { ...dados.servico, valorPacote: 324011, escopo: { ...dados.servico.escopo, minutosCobertura: 420 } });
  dados = editarCondicoesCasamento(dados, "Publicação na conta do evento.");
  const opcao2 = structuredClone(dados.negociacaoCasamento!.opcao2);
  dados = dadosContratoSchema.parse(JSON.parse(JSON.stringify(dados)));
  dados = selecionarOpcaoCasamento(dados, "opcao1");
  assert.equal(dados.servico.escopo.minutosCobertura, 240);
  assert.equal(dados.servico.valorPacote, 149099);
  assert.deepEqual(condicoesNegociadasCasamento(dados), ["Chegada pela entrada lateral."]);
  assert.deepEqual(dados.negociacaoCasamento!.opcao2, opcao2);
  dados = selecionarOpcaoCasamento(dados, "opcao2");
  assert.equal(dados.servico.escopo.minutosCobertura, 420);
  assert.equal(dados.servico.valorPacote, 324011);
  assert.deepEqual(dados.negociacaoCasamento!.opcao1, opcao1);
  assert.deepEqual(resolverNegociacaoCasamento(dados, CTX), dados);
});

test("modo original restaura catalogo sem apagar rascunho e condições personalizados", () => {
  const dados = congelar(editarCondicoesCasamento(personalizado(), "Entrega combinada com o casal."));
  const original = mudarModoCasamento(dados, "original");
  assert.equal(original.servico.escopo.minutosCobertura, 300);
  assert.equal(original.servico.valorPacote, precoPacote("casamento", "2027", "Pacote Principal"));
  assert.deepEqual(original.servico.adicionais, []);
  assert.equal(original.servico.desconto, 0);
  assert.deepEqual(condicoesNegociadasCasamento(original), []);
  assert.deepEqual(mudarModoCasamento(original, "personalizado"), dados);
});

test("tabela de cada opção é independente, sem reajustar a outra", () => {
  let dados = iniciarNegociacaoCasamento(dadosBase());
  dados = editarServicoCasamento(dados, { ...dados.servico, tabela: "2028", valorPacote: 333333 });
  dados = mudarModoCasamento(dados, "original");
  assert.equal(dados.servico.tabela, "2028");
  assert.equal(dados.servico.valorPacote, precoPacote("casamento", "2028", "Pacote Principal"));
  dados = selecionarOpcaoCasamento(dados, "opcao2");
  assert.equal(dados.servico.tabela, "2027");
});

test("helpers nao modificam os pacotes globais do catálogo", () => {
  const antes = structuredClone(pacoteDoCatalogo("casamento", "Pacote Principal"));
  const dados = selecionarOpcaoCasamento(dadosBase(), "opcao1");
  dados.servico.escopo.reels.push("novo vídeo negociado");
  assert.deepEqual(pacoteDoCatalogo("casamento", "Pacote Principal"), antes);
});

test("servidor recusa metadados em outras categorias e template divergente", () => {
  const dados = iniciarNegociacaoCasamento(dadosBase());
  for (const ctx of [
    { categoria: "corporativo", templateId: "corporativo" },
    { categoria: "aniversario", templateId: "aniversario_adulto" },
    { categoria: "debutante", templateId: "debutante" },
    { categoria: "casamento", templateId: "corporativo" },
    { categoria: "casamento" },
  ]) {
    assert.throws(() => resolverNegociacaoCasamento(dados, ctx), ErroNegociacaoCasamento);
  }
});

test("servidor recusa pacote adulterado tanto no rascunho selecionado quanto no inativo", () => {
  for (const opcao of ["opcao1", "opcao2"] as const) {
    const dados = iniciarNegociacaoCasamento(dadosBase());
    dados.negociacaoCasamento![opcao].servico.pacote = "Personalizado";
    assert.throws(() => resolverNegociacaoCasamento(dados, CTX), /pacote do rascunho/);
  }
});

test("servidor recusa serviço ativo divergente sem sobrescrever silenciosamente", () => {
  const dados = personalizado();
  dados.servico.escopo.minutosCobertura = 599;
  assert.throws(() => resolverNegociacaoCasamento(dados, CTX), /diverge/);
  const original = iniciarNegociacaoCasamento(dadosBase());
  original.servico.valorPacote += 1;
  assert.throws(() => resolverNegociacaoCasamento(original, CTX), /diverge/);
  assert.throws(() => editarServicoCasamento(personalizado(), { ...dados.servico, pacote: "Pacote Real Time" }), /manter o pacote/);
});

test("ordem de chaves JSON não cria divergência falsa", () => {
  const dados = personalizado();
  dados.servico = Object.fromEntries(Object.entries(dados.servico).reverse()) as Servico;
  assert.doesNotThrow(() => resolverNegociacaoCasamento(dados, CTX));
});

test("condições têm limites de tamanho e parágrafos sem contar linhas vazias", () => {
  const dados = iniciarNegociacaoCasamento(dadosBase());
  const permitidas = Array.from({ length: 38 }, (_, i) => `Condição ${i + 1}.`).join("\n\n");
  assert.equal(condicoesNegociadasCasamento(editarCondicoesCasamento(dados, permitidas)).length, 38);
  const excedidas = editarCondicoesCasamento(dados, `${permitidas}\nOutra.`);
  assert.throws(() => resolverNegociacaoCasamento(excedidas, CTX), /38 parágrafos/);
  assert.throws(() => editarCondicoesCasamento(dados, "a".repeat(6001)));
});

test("montagem original continua idêntica com ou sem a nova inicialização", () => {
  for (const { pacote } of OPCOES_CASAMENTO) {
    const dados = dadosBase(pacote);
    assert.deepEqual(montarContrato(iniciarNegociacaoCasamento(dados), CTX), montarContrato(dados, CTX));
  }
});

test("contrato usa horas, itens, preço final e parcelas exatos da opção personalizada", () => {
  const dados = personalizado();
  const { documento } = montarContrato(dados, CTX);
  const texto = textoCorrido(documento);
  assert.match(texto, /4 \(quatro\) horas/);
  assert.match(texto, /R\$ 1\.490,99/);
  assert.match(texto, /12 fotografias digitais escolhidas pelo casal/);
  assert.equal(totalContrato(dados.servico), 149099);
  assert.match(texto, /R\$ 447,30/);
  assert.match(texto, /R\$ 1\.043,69/);
  assert.deepEqual(validarDocumento(documento), []);
});

test("condições negociadas são determinísticas sem IA e preservam texto, pontuação e espaços internos", () => {
  const dados = editarCondicoesCasamento(personalizado(), "\nAcesso  pela porta lateral.\r\n\r\nCobertura sem publicação no Instagram!\n");
  const { documento } = montarContrato(dados, CTX);
  const especiais = documento.clausulas.find((item) => item.id === "condicoes_especiais")!;
  assert.equal(especiais.origem, "padrao");
  assert.deepEqual(especiais.problemas, []);
  assert.deepEqual(especiais.paragrafos, [
    "Acesso  pela porta lateral.", "Cobertura sem publicação no Instagram!", PARAGRAFO_UNICO_CONDICOES_ESPECIAIS,
  ]);
  assert.equal(documento.clausulas.indexOf(especiais), documento.clausulas.findIndex((item) => item.id === "assinatura_eletronica") - 1);
});

test("condições de opção inativa ou em modo original não entram no contrato", () => {
  const negociado = editarCondicoesCasamento(personalizado(), "CONDIÇÃO EXCLUSIVA DA OPÇÃO 1.");
  for (const dados of [selecionarOpcaoCasamento(negociado, "opcao2"), mudarModoCasamento(negociado, "original")]) {
    assert.equal(montarContrato(dados, CTX).documento.clausulas.some((item) => item.id === "condicoes_especiais"), false);
  }
});

test("mescla negociação e IA sem validar a negociação como IA nem apagar problemas da IA", () => {
  const dados = editarCondicoesCasamento(personalizado(), "Entrega adicional em 45 dias úteis.");
  const { documento } = montarContrato(dados, CTX, ["Entrega adicional em 99 dias úteis."]);
  const especiais = documento.clausulas.find((item) => item.id === "condicoes_especiais")!;
  assert.equal(especiais.origem, "ia");
  assert.deepEqual(especiais.paragrafos.slice(0, 2), ["Entrega adicional em 45 dias úteis.", "Entrega adicional em 99 dias úteis."]);
  assert.ok(especiais.problemas.some((problema) => problema.includes("99 dias")));
  assert.equal(especiais.problemas.some((problema) => problema.includes("45 dias")), false);
  assert.equal(especiais.paragrafos.at(-1), PARAGRAFO_UNICO_CONDICOES_ESPECIAIS);
});

test("38 condições cabem sem IA; combinação acima do limite recusa em vez de truncar negociação", () => {
  const dados = editarCondicoesCasamento(personalizado(), Array.from({ length: 38 }, (_, i) => `Condição ${i + 1}.`).join("\n"));
  assert.equal(montarContrato(dados, CTX).documento.clausulas.find((item) => item.id === "condicoes_especiais")!.paragrafos.length, 39);
  assert.equal(montarContrato(dados, CTX, ["Uma observação."]).documento.clausulas.find((item) => item.id === "condicoes_especiais")!.paragrafos.length, 40);
  assert.throws(() => montarContrato(dados, CTX, ["Primeira observação.", "Segunda observação."]), (erro) => {
    assert.ok(erro instanceof CamposFaltandoContratoError);
    assert.match(erro.campos.join(" "), /mais de 40 parágrafos/);
    return true;
  });
});

test("faltantes e montagem recusam metadados fora de casamento ou rascunhos inconsistentes", () => {
  const dados = iniciarNegociacaoCasamento(dadosBase());
  const ctx: ContextoMontagem = { ...CTX, categoria: "corporativo", templateId: "corporativo" };
  assert.match(faltantes(dados, ctx).join(" "), /exclusiva/);
  assert.throws(() => montarContrato(dados, ctx));
  dados.servico.pacote = "Personalizado";
  assert.match(faltantes(dados, CTX).join(" "), /Opção 1 ou a Opção 2/);
});
