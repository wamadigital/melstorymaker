import assert from "node:assert/strict";
import { test } from "node:test";
import { dadosContratoSchema, type Contratante, type DadosContrato } from "@/lib/contrato/tipos";
import { adicionalDoCatalogo, novoAdicional, pacoteDoCatalogo } from "@/lib/contrato/catalogo";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import { montarContrato, type ContextoMontagem } from "@/lib/contrato/montar";
import {
  avisoNaoIncorporado,
  ehAvisoNaoIncorporado,
  PREFIXO_NAO_INCORPORADO as PREFIXO_DA_ROTA,
} from "@/app/api/admin/leads/[id]/contrato/_comum";
import {
  avisoDoUltimoEnvio,
  avisosParaExibir,
  bloqueioDoEnvio,
  chaveDoCronometro,
  chaveEstavel,
  dadosDoRegistro,
  linkSaiDaPagina,
  mesclarContratante,
  motivoSemEnvio,
  origemDoAviso,
  paragrafosDoTexto,
  PREFIXO_NAO_INCORPORADO,
  recadoDoCancelamento,
  recolhimentoDoFormulario,
  ROTULO_ORIGEM_AVISO,
  temQuantidade,
  textoDaConsultaQueFalhou,
  textoDesatualizado,
  unidadeDoAdicional,
  vizinhaDaRemovida,
} from "./estado";
import { unidadeDoAdicional as unidadeNaMontagem } from "@/lib/contrato/montar";

// Tudo FICTICIO: CPFs gerados para passar no digito verificador, nomes,
// e-mails e enderecos inventados.
const HOJE = "2026-09-29";
const CTX: ContextoMontagem = {
  categoria: "casamento",
  templateId: "casamento",
  idadeHomenageado: null,
  hojeISO: HOJE,
};

function dadosCompletos(): DadosContrato {
  const pacote = pacoteDoCatalogo("casamento", "Pacote Principal");
  assert.ok(pacote);
  return dadosContratoSchema.parse({
    contratante: {
      tipo: "pf",
      pf: {
        nome: "Ana Paula Rocha",
        genero: "feminino",
        cpf: "12345678909",
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
      data: "2027-03-20",
      horarioInicio: "16:00",
      homenageado: "Ana e João",
      locais: [
        {
          rotulo: "Local da cerimônia e recepção",
          endereco: "Espaço Jardim das Flores, Estrada Velha, 900, Campinas/SP",
        },
      ],
      alimentacao: true,
    },
    servico: {
      tabela: "2027",
      pacote: pacote.nome,
      valorPacote: 148500,
      escopo: pacote.escopo,
      adicionais: [],
      desconto: 0,
    },
    pagamento: pagamentoDoPreset("30/70"),
  });
}

// ------------------------------------------------------------ comparacao --

test("chaveEstavel ignora a ordem em que as chaves foram criadas", () => {
  assert.equal(
    chaveEstavel({ a: 1, b: { c: 2, d: [1, { f: 1, e: 2 }] } }),
    chaveEstavel({ b: { d: [1, { e: 2, f: 1 }], c: 2 }, a: 1 }),
  );
  assert.notEqual(chaveEstavel({ a: [1, 2] }), chaveEstavel({ a: [2, 1] }));
});

test("dados que voltam do servidor passam pelo schema; lixo vira null em vez de formulario quebrado", () => {
  const d = dadosDoRegistro({ servico: { tabela: "2026" } });
  assert.ok(d);
  assert.equal(d.pagamento.modo, "parcelas");
  assert.equal(d.contratante.tipo, "pf");
  assert.equal(dadosDoRegistro({ servico: { tabela: "1999" } }), null);
  assert.equal(dadosDoRegistro(null), null);
});

// -------------------------------------------------------------- extracao --

function contratanteVazio(tipo: "pf" | "pj" = "pf"): Contratante {
  return dadosContratoSchema.parse({ servico: { tabela: "2026" }, contratante: { tipo } }).contratante;
}

test("extracao so sobrescreve o que veio preenchido: vazio da IA nao apaga o que a Mel digitou", () => {
  const atual = contratanteVazio();
  atual.pf.nome = "Nome Digitado Pela Mel";
  atual.pf.telefone = "19999990000";
  atual.pf.endereco.bairro = "Centro";

  const { contratante, preenchidos } = mesclarContratante(atual, {
    tipo: "pf",
    pf: {
      nome: "",
      cpf: "123.456.789-09",
      email: "  Ana.Rocha@Exemplo.com.BR ",
      endereco: { logradouro: "Rua das Acácias", numero: "120", bairro: "", uf: "sp", cep: "13000-000" },
    },
  });

  assert.equal(contratante.pf.nome, "Nome Digitado Pela Mel");
  assert.equal(contratante.pf.telefone, "19999990000");
  assert.equal(contratante.pf.endereco.bairro, "Centro");
  assert.equal(contratante.pf.cpf, "12345678909");
  assert.equal(contratante.pf.email, "ana.rocha@exemplo.com.br");
  assert.equal(contratante.pf.endereco.logradouro, "Rua das Acácias");
  assert.equal(contratante.pf.endereco.uf, "SP");
  assert.equal(contratante.pf.endereco.cep, "13000000");
  assert.equal(preenchidos, 6);
});

test("o tratamento (genero) nunca vem da extracao: a concordancia e escolha da Mel", () => {
  const atual = contratanteVazio();
  atual.pf.genero = "feminino";
  const { contratante } = mesclarContratante(atual, { pf: { nome: "Ana", genero: "masculino" } });
  assert.equal(contratante.pf.genero, "feminino");
});

test("vira pessoa juridica so quando a IA achou razao social ou CNPJ, e nunca volta para PF sozinha", () => {
  const pf = mesclarContratante(contratanteVazio("pf"), {
    tipo: "pj",
    pj: { razaoSocial: "Alfa Eventos Ltda." },
  });
  assert.equal(pf.contratante.tipo, "pj");
  assert.equal(pf.contratante.pj.razaoSocial, "Alfa Eventos Ltda.");

  const semEmpresa = mesclarContratante(contratanteVazio("pf"), { tipo: "pj", pf: { nome: "Roberto" } });
  assert.equal(semEmpresa.contratante.tipo, "pf");

  const pj = mesclarContratante(contratanteVazio("pj"), {
    tipo: "pf",
    pj: { representante: { nome: "Roberto Alves", cpf: "314.159.265-90" } },
  });
  assert.equal(pj.contratante.tipo, "pj");
  assert.equal(pj.contratante.pj.representante.nome, "Roberto Alves");
  assert.equal(pj.contratante.pj.representante.cpf, "31415926590");
});

test("CNPJ alfanumerico extraido mantem as letras (em maiusculas)", () => {
  const { contratante } = mesclarContratante(contratanteVazio("pj"), { pj: { cnpj: "12.abc.345/01de-35" } });
  assert.equal(contratante.pj.cnpj, "12ABC34501DE35");
});

test("resposta da extracao fora do formato nao mexe em nada", () => {
  const atual = contratanteVazio();
  atual.pf.nome = "Ana";
  const r = mesclarContratante(atual, { tipo: "empresa-grande" });
  assert.equal(r.preenchidos, 0);
  assert.equal(r.contratante, atual);
});

// ------------------------------------------------------ texto desatualizado --

test("texto recem-montado com os mesmos dados esta em dia", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);
  assert.equal(textoDesatualizado(documento, dados, CTX), false);
});

test("mudar valor, nome de quem assina ou data depois de gerar o texto deixa o texto desatualizado", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);

  const valor = structuredClone(dados);
  valor.servico.valorPacote = 150000;
  assert.equal(textoDesatualizado(documento, valor, CTX), true);

  const nome = structuredClone(dados);
  nome.contratante.pf.nome = "Ana Paula Rocha Souza";
  assert.equal(textoDesatualizado(documento, nome, CTX), true);

  const data = structuredClone(dados);
  data.evento.data = "2027-04-10";
  assert.equal(textoDesatualizado(documento, data, CTX), true);
});

test("dado que nao entra no texto (telefone, observacoes) nao desatualiza nada", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);
  const outro = structuredClone(dados);
  outro.contratante.pf.telefone = "11911112222";
  outro.observacoes = "Cliente pediu para chegar 15 minutos antes.";
  assert.equal(textoDesatualizado(documento, outro, CTX), false);
});

test("clausula editada a mao fica fora da comparacao: editar e a Mel assumir o texto", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);
  const pagamento = documento.clausulas.find((c) => c.id === "pagamento");
  assert.ok(pagamento);
  pagamento.origem = "editada";
  pagamento.paragrafos = ["Texto de pagamento escrito pela Mel."];
  assert.equal(textoDesatualizado(documento, dados, CTX), false);
});

test("clausula opcional removida no editor nao conta como texto velho; tirar o buffet dos dados conta", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);

  const semAlimentacao = {
    ...documento,
    clausulas: documento.clausulas.filter((c) => c.id !== "alimentacao"),
  };
  assert.equal(textoDesatualizado(semAlimentacao, dados, CTX), false);

  const semBuffet = structuredClone(dados);
  semBuffet.evento.alimentacao = false;
  assert.equal(textoDesatualizado(documento, semBuffet, CTX), true);
});

test("acrescentar um adicional depois do texto desatualiza (objeto e pagamento mudam)", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);
  const item = adicionalDoCatalogo("casamento", "casamento.hora_adicional");
  assert.ok(item);
  const comAdicional = structuredClone(dados);
  comAdicional.servico.adicionais = [novoAdicional(item, dados.servico.pacote, "2027")];
  assert.equal(textoDesatualizado(documento, comAdicional, CTX), true);
});

test("dados incompletos depois do texto contam como texto velho; sem texto ou sem arte nao ha o que comparar", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);
  const incompleto = structuredClone(dados);
  incompleto.contratante.pf.cpf = "";
  assert.equal(textoDesatualizado(documento, incompleto, CTX), true);
  assert.equal(textoDesatualizado(null, dados, CTX), false);
  assert.equal(textoDesatualizado(documento, dados, null), false);
});

// ------------------------------------------------------------------ avisos --

test("sem texto, os avisos sao os do sistema calculados ao vivo sobre a tela", () => {
  const dados = dadosCompletos();
  dados.anuente.ativo = false;
  const avisos = avisosParaExibir({
    documento: null,
    avisosSalvos: [],
    dados,
    ctx: CTX,
    desatualizado: false,
  });
  assert.ok(avisos.some((a) => a.origem === "sistema" && a.clausula === "direitos"));
});

test("com o texto em dia valem os avisos salvos com ele, inclusive os da revisao da IA", () => {
  const dados = dadosCompletos();
  const { documento } = montarContrato(dados, CTX);
  const salvos = [{ origem: "ia" as const, gravidade: "atencao" as const, texto: "Confira o horário." }];
  assert.deepEqual(
    avisosParaExibir({ documento, avisosSalvos: salvos, dados, ctx: CTX, desatualizado: false }),
    salvos,
  );
  // texto velho: os da IA falam de um texto que vai mudar
  const vivos = avisosParaExibir({ documento, avisosSalvos: salvos, dados, ctx: CTX, desatualizado: true });
  assert.ok(vivos.every((a) => a.origem === "sistema"));
});

// ------------------------------------------------------------- adicionais --

test("unidade e quantidade do adicional seguem o catalogo; item fechado nao tem quantidade", () => {
  assert.equal(
    unidadeDoAdicional("casamento", { id: "casamento.hora_adicional", tipo: "hora_adicional" }),
    "hora",
  );
  assert.equal(unidadeDoAdicional("casamento", { id: "casamento.making_of_noiva", tipo: "making_of" }), null);
  assert.equal(unidadeDoAdicional(null, { id: "x", tipo: "trend" }), "unidade");
  assert.equal(
    unidadeDoAdicional("aniversario_infantil", { id: "aniversario_infantil.storymaker", tipo: "storymaker" }),
    "hora",
  );
  assert.ok(temQuantidade("casamento", { id: "casamento.reels", tipo: "reels" }));
  assert.ok(temQuantidade("casamento", { id: "livre-1", tipo: "outro" }));
  assert.ok(!temQuantidade("casamento", { id: "casamento.making_of_noiva", tipo: "making_of" }));
  assert.ok(!temQuantidade("casamento", { id: "locomocao", tipo: "locomocao" }));
});

test("a unidade do painel e a da montagem: o storymaker por hora do infantil segue por hora na arte do adulto", () => {
  // A idade mudou e a arte virou a do adulto, mas o adicional continua na
  // lista. O contrato diz "N horas ... por hora" (a montagem acha o item em
  // qualquer arte); o painel precisa abrir o campo de horas tambem.
  const storymaker = { id: "aniversario_infantil.storymaker", tipo: "storymaker" as const };
  assert.equal(unidadeNaMontagem(storymaker, "aniversario_adulto"), "hora");
  assert.equal(unidadeDoAdicional("aniversario_adulto", storymaker), "hora");
  assert.ok(temQuantidade("aniversario_adulto", storymaker));
  assert.equal(unidadeDoAdicional(null, storymaker), "hora");

  // Sem nada no catalogo, os dois lados caem na mesma regra do tipo.
  for (const a of [
    { id: "livre-1", tipo: "outro" as const },
    { id: "x", tipo: "hora_adicional" as const },
    { id: "y", tipo: "reels" as const },
    { id: "casamento.making_of_noiva", tipo: "making_of" as const },
  ]) {
    assert.equal(unidadeDoAdicional("casamento", a), unidadeNaMontagem(a, "casamento"), a.id);
  }
});

// ------------------------------------------------------------ assinatura --

test("consulta silenciosa que falhou: erro passageiro vira a frase generica, pedido sumido mostra a saida do servidor", () => {
  const sumiu =
    "Não encontrei este envio na plataforma de assinatura: ele pode ter sido apagado pelo painel da iLovePDF. Use “Cancelar envio” para destravar o contrato e enviar de novo.";
  // Ao abrir a pagina (silencioso), o 409 do pedido sumido NAO pode virar
  // "tente de novo": tentar de novo nunca resolve, a saida e cancelar.
  assert.equal(textoDaConsultaQueFalhou({ silencioso: true, erro: sumiu, pedidoInexistente: true }), sumiu);
  assert.match(
    textoDaConsultaQueFalhou({ silencioso: true, erro: "Algo deu errado do lado do servidor." }),
    /Toque em “Atualizar status” para tentar de novo/,
  );
  // Clicado pela Mel, sempre a frase do servidor.
  assert.equal(textoDaConsultaQueFalhou({ silencioso: false, erro: "Plataforma fora do ar." }), "Plataforma fora do ar.");
  assert.equal(textoDaConsultaQueFalhou({ silencioso: false, erro: sumiu, pedidoInexistente: true }), sumiu);
});

test("cancelar envio: o aviso do envio encerrado so no sistema aparece no lugar do 'Envio cancelado'", () => {
  assert.deepEqual(recadoDoCancelamento({ registro: { status: "pdf_gerado" } }), {
    tom: "ok",
    texto: "Envio cancelado. O texto está destravado.",
  });

  const aviso =
    "O registro do envio estava corrompido, então ele foi encerrado só aqui. Antes de enviar de novo, confira no painel da iLoveAPI se o pedido antigo não ficou aberto.";
  assert.deepEqual(
    recadoDoCancelamento({ registro: { status: "pdf_gerado" }, pedidoInexistente: true, aviso }),
    { tom: "atencao", texto: aviso },
  );

  // Aviso vazio ou sem a marca do pedido inexistente: o recado de sempre.
  assert.equal(recadoDoCancelamento({ registro: null, pedidoInexistente: true, aviso: "  " }).tom, "ok");
  assert.equal(recadoDoCancelamento({ registro: null, aviso }).texto, "Envio cancelado. O texto está destravado.");

  assert.match(recadoDoCancelamento({ registro: { status: "assinado" } }).texto, /todos já tinham assinado/);
});

// --------------------------------------------------------------- editor --

test("no editor, linha em branco separa paragrafos e quebra simples vira espaco", () => {
  assert.deepEqual(
    paragrafosDoTexto("Primeiro parágrafo\ncontinua aqui.\n\n  \nSegundo **em negrito**.\n\n"),
    ["Primeiro parágrafo continua aqui.", "Segundo **em negrito**."],
  );
  assert.deepEqual(paragrafosDoTexto("   \n\n  "), []);
  assert.deepEqual(paragrafosDoTexto("A.  Item com   espaços\tsobrando."), ["A. Item com espaços sobrando."]);
});

// ------------------------------------------------------- origem do aviso --

test("aviso do que ficou FORA do texto e da redacao da IA, nao da revisao", () => {
  // O prefixo do painel e o da rota (server-only) precisam continuar iguais.
  assert.equal(PREFIXO_NAO_INCORPORADO, PREFIXO_DA_ROTA);

  const fora = avisoNaoIncorporado("Pagamento em 3 vezes: ajuste as parcelas na seção Pagamento.");
  assert.ok(ehAvisoNaoIncorporado(fora));
  assert.equal(origemDoAviso(fora), "redacao_ia");
  assert.equal(ROTULO_ORIGEM_AVISO[origemDoAviso(fora)], "Redação da IA");

  const revisao = { origem: "ia" as const, texto: "O item 13.2 só trata do adiamento com data já ocupada." };
  assert.equal(origemDoAviso(revisao), "revisao_ia");
  assert.equal(ROTULO_ORIGEM_AVISO[origemDoAviso(revisao)], "Revisão da IA");

  assert.equal(origemDoAviso({ origem: "sistema", texto: `${PREFIXO_NAO_INCORPORADO}x` }), "sistema");
});

// ------------------------------------------------------------ cronometro --

test("o cronometro recomeca quando o texto do progresso muda (redacao -> revisao)", () => {
  const redacao = chaveDoCronometro({ lugar: "dados", texto: "Escrevendo o contrato com IA…" });
  const revisao = chaveDoCronometro({ lugar: "dados", texto: "Revisando com IA…" });
  assert.notEqual(redacao, null);
  assert.notEqual(redacao, revisao);
  assert.equal(redacao, chaveDoCronometro({ lugar: "dados", texto: "Escrevendo o contrato com IA…" }));
  assert.notEqual(
    chaveDoCronometro({ lugar: "texto", texto: "Revisando com IA…" }),
    revisao,
    "mesmo texto em outro lugar tambem e outro cronometro",
  );
  assert.equal(chaveDoCronometro(null), null);
});

// ------------------------------------------------------- sair da pagina --

test("so link interno que troca de pagina pede confirmacao de alteracoes nao salvas", () => {
  const atual = "http://localhost:3107/admin/leads/abc";
  const clique = { target: null, download: false, atual, botao: 0, modificador: false };
  // "Voltar para a lista" e o logo: navegacao do App Router, sem beforeunload.
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin" }), true);
  assert.equal(linkSaiDaPagina({ ...clique, href: "http://localhost:3107/admin/leads/outro" }), true);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin/leads/abc?aba=2" }), true);
  // Ficam na pagina ou abrem outra aba: nao perguntam.
  assert.equal(linkSaiDaPagina({ ...clique, href: "#ct-texto" }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin/leads/abc#ct-texto" }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin", target: "_blank" }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin", modificador: true }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin", botao: 1 }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/api/admin/x/arquivo", download: true }), false);
  // Outra origem sai de verdade: quem pergunta e o beforeunload.
  assert.equal(linkSaiDaPagina({ ...clique, href: "https://wa.me/5519900000000" }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "mailto:alguem@exemplo.com" }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: null }), false);
  assert.equal(linkSaiDaPagina({ ...clique, href: "/admin", target: "_self" }), true);
});

// ------------------------------------------------------------- assinatura --

test("dados nao salvos travam o envio, inclusive o Confirmar da confirmacao ja aberta", () => {
  // Corrigir o e-mail sem salvar nao desatualiza o texto enquanto o texto
  // salvo e o PDF sao os antigos -- mas o link iria para o e-mail velho.
  const sujo = bloqueioDoEnvio({ editandoClausula: false, desatualizado: false, sujo: true });
  assert.ok(sujo && /não salvas/.test(sujo));
  assert.equal(bloqueioDoEnvio({ editandoClausula: false, desatualizado: false, sujo: false }), null);
  assert.match(
    bloqueioDoEnvio({ editandoClausula: true, desatualizado: true, sujo: true }) ?? "",
    /cláusula que você está editando/,
  );
  assert.match(
    bloqueioDoEnvio({ editandoClausula: false, desatualizado: true, sujo: true }) ?? "",
    /gere o texto e o PDF de novo/,
  );

  // O motivo e o mesmo para os dois botoes.
  assert.equal(
    motivoSemEnvio({ assinaturaConfigurada: true, bloqueioEnvio: sujo, rotulosComEmailInvalido: [] }),
    sujo,
  );
  assert.equal(
    motivoSemEnvio({ assinaturaConfigurada: true, bloqueioEnvio: null, rotulosComEmailInvalido: [] }),
    null,
  );
  assert.match(
    motivoSemEnvio({ assinaturaConfigurada: true, bloqueioEnvio: null, rotulosComEmailInvalido: ["CONTRATANTE"] }) ?? "",
    /Confira o e-mail de: CONTRATANTE/,
  );
  assert.match(
    motivoSemEnvio({ assinaturaConfigurada: false, bloqueioEnvio: null, rotulosComEmailInvalido: [] }) ?? "",
    /não está configurada/,
  );
});

test("envio cancelado de proposito fica neutro; recusado e expirado pedem acao", () => {
  const cancelado = avisoDoUltimoEnvio("cancelado");
  assert.deepEqual(cancelado, { tom: "info", texto: "Envio anterior cancelado." });
  assert.ok(!/corrija/i.test(cancelado?.texto ?? ""));

  assert.equal(avisoDoUltimoEnvio("recusado")?.tom, "atencao");
  assert.match(avisoDoUltimoEnvio("recusado")?.texto ?? "", /Corrija/);
  assert.equal(avisoDoUltimoEnvio("expirado")?.tom, "atencao");

  assert.equal(avisoDoUltimoEnvio("enviado"), null);
  assert.equal(avisoDoUltimoEnvio("concluido"), null);
  assert.equal(avisoDoUltimoEnvio(null), null);
});

// ------------------------------------------------------------- formulario --

test("com o PDF gerado o formulario recolhe, e abre sozinho com alteracao nao salva ou pendencia", () => {
  assert.deepEqual(recolhimentoDoFormulario({ travado: false, temPdf: false, sujo: true, pendencias: true }), {
    recolhido: false,
  });
  assert.deepEqual(recolhimentoDoFormulario({ travado: false, temPdf: true, sujo: false, pendencias: false }), {
    recolhido: true,
    resumo: "Ver e editar os dados do contrato",
    abrir: false,
  });
  const comAlteracao = recolhimentoDoFormulario({ travado: false, temPdf: true, sujo: true, pendencias: false });
  assert.ok(comAlteracao.recolhido && comAlteracao.abrir);
  const comPendencia = recolhimentoDoFormulario({ travado: false, temPdf: true, sujo: false, pendencias: true });
  assert.ok(comPendencia.recolhido && comPendencia.abrir);
  // Travado: so leitura, fechado.
  assert.deepEqual(recolhimentoDoFormulario({ travado: true, temPdf: true, sujo: false, pendencias: false }), {
    recolhido: true,
    resumo: "Ver os dados do contrato",
    abrir: false,
  });
});

// ---------------------------------------------------------------- editor --

test("o recado de clausula removida vai para a que ficou no lugar dela", () => {
  const cl = [{ id: "objeto" }, { id: "local" }, { id: "adicionais" }, { id: "foro" }];
  assert.equal(vizinhaDaRemovida(cl, "local"), "adicionais");
  assert.equal(vizinhaDaRemovida(cl, "foro"), "adicionais");
  assert.equal(vizinhaDaRemovida(cl, "objeto"), "local");
  assert.equal(vizinhaDaRemovida([{ id: "x" }], "x"), null);
  assert.equal(vizinhaDaRemovida(cl, "nao-existe"), null);
});
