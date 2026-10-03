import assert from "node:assert/strict";
import { test } from "node:test";
import type { Categoria, Lead, Respostas } from "@/lib/form/types";
import { STATUS_ASSINATURA, STATUS_CONTRATO, dadosContratoSchema } from "./tipos";
import { pagamentoDoPreset, validarPagamento } from "./pagamento";
import { faltantes } from "./montar";
import {
  ROTULO_STATUS_ASSINATURA,
  ROTULO_STATUS_CONTRATO,
  contextoDoLead,
  dadosIniciais,
  ehEventoDeMenor,
  hojeEmSaoPaulo,
  idadeHomenageado,
  templateDoLead,
} from "./regras";

const HOJE = "2026-09-29";

/** Lead FICTICIO. Nenhum nome, e-mail ou telefone aqui e de cliente. */
function lead(categoria: Categoria, respostas: Respostas): Lead {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    categoria,
    status: "aguardando_revisao",
    respostas: { contato_whatsapp: "(19) 99999-0000", contato_email: "Contato@Exemplo.com", ...respostas },
    passo_atual: null,
    nome_display: null,
    data_evento: null,
    email: null,
    whatsapp: null,
    pdf_url: null,
    pdf_gerado_em: null,
    enviado_em: null,
    lembrete_7_em: null,
    lembrete_30_em: null,
  };
}

// ------------------------------------------------------------ menoridade --

test("debutante e sempre evento de menor", () => {
  assert.equal(ehEventoDeMenor("debutante", {}), true);
  assert.equal(ehEventoDeMenor("debutante", 30), true);
  assert.equal(idadeHomenageado("debutante", {}), 15);
});

test("aniversario e de menor abaixo de 18, e sem idade conta como menor por seguranca", () => {
  assert.equal(ehEventoDeMenor("aniversario", { idade: "5" }), true);
  assert.equal(ehEventoDeMenor("aniversario", { idade: "17" }), true);
  assert.equal(ehEventoDeMenor("aniversario", { idade: "18" }), false);
  assert.equal(ehEventoDeMenor("aniversario", { idade: "40" }), false);
  assert.equal(ehEventoDeMenor("aniversario", {}), true);
  assert.equal(ehEventoDeMenor("aniversario", { idade: "dezesseis" }), true);
  assert.equal(ehEventoDeMenor("aniversario", null), true);
  assert.equal(ehEventoDeMenor("aniversario", 16), true);
  assert.equal(ehEventoDeMenor("aniversario", 18), false);
  assert.equal(ehEventoDeMenor("aniversario", Number.NaN), true);
});

/**
 * A arte "aniversario_adulto" comeca aos 15. Derivar a menoridade da arte
 * trataria um aniversariante de 16 como adulto -- e ele assinaria (ou deixaria
 * de ter quem assine por ele) um contrato que nao pode assinar sozinho.
 */
test("menoridade NAO vem da arte: 16 anos e arte de adulto e evento de menor", () => {
  const l = lead("aniversario", { idade: "16" });
  assert.equal(templateDoLead(l), "aniversario_adulto");
  assert.equal(ehEventoDeMenor("aniversario", l.respostas), true);
});

test("casamento e corporativo nunca sao evento de menor", () => {
  assert.equal(ehEventoDeMenor("casamento", {}), false);
  assert.equal(ehEventoDeMenor("corporativo", { idade: "10" }), false);
  assert.equal(idadeHomenageado("casamento", {}), null);
});

test("contexto do lead para a montagem", () => {
  assert.deepEqual(contextoDoLead(lead("aniversario", { idade: "10", entrega: "Em tempo real" }), HOJE), {
    categoria: "aniversario",
    templateId: "aniversario_infantil",
    idadeHomenageado: 10,
    hojeISO: HOJE,
    entregaSolicitada: "Em tempo real",
  });
  assert.equal(contextoDoLead(lead("aniversario", {}), HOJE).templateId, null, "sem idade nao se chuta a arte");
  assert.equal(contextoDoLead(lead("corporativo", {}), HOJE).entregaSolicitada, "");
});

test("hoje em Sao Paulo, e nao em UTC", () => {
  // 02h30 UTC do dia 30 ainda e 23h30 do dia 29 em Brasilia.
  assert.equal(hojeEmSaoPaulo(Date.UTC(2026, 8, 30, 2, 30)), "2026-09-29");
  assert.equal(hojeEmSaoPaulo(new Date(Date.UTC(2026, 8, 30, 3, 30))), "2026-09-30");
  assert.equal(hojeEmSaoPaulo(Date.UTC(2027, 0, 1, 2, 59)), "2026-12-31");
});

// ------------------------------------------------------- pre-preenchimento --

test("casamento: pacote pela entrega, homenageado sem '&', um local quando e o mesmo lugar", () => {
  const dados = dadosIniciais(
    lead("casamento", {
      nome: "Cerimonialista Teste",
      noivos: "Ana & João",
      data: "2027-01-23",
      horario: "16:30",
      local_cerimonia: "Espaço Jardim Fictício",
      local_festa: "espaco jardim ficticio",
      making_of: "Não",
      entrega: "Em tempo real",
    }),
    HOJE,
  );
  assert.deepEqual(dadosContratoSchema.parse(dados), dados, "valido pelo schema");
  assert.equal(dados.evento.homenageado, "Ana e João");
  assert.deepEqual(dados.evento.locais, [{ rotulo: "Local da cerimônia e recepção", endereco: "Espaço Jardim Fictício" }]);
  assert.equal(dados.evento.data, "2027-01-23");
  assert.equal(dados.evento.horarioInicio, "16:30");
  assert.equal(dados.servico.tabela, "2027");
  assert.equal(dados.servico.pacote, "Pacote Real Time");
  assert.equal(dados.servico.valorPacote, 209000);
  assert.equal(dados.servico.escopo.tempoReal, true);
  assert.equal(dados.servico.escopo.storymakers, 2);
  assert.deepEqual(dados.servico.adicionais, []);
  assert.equal(dados.contratante.tipo, "pf");
  assert.equal(dados.contratante.pf.nome, "Cerimonialista Teste", "adulto: nome pre-preenchido, a Mel confirma");
  assert.equal(dados.contratante.pf.email, "contato@exemplo.com");
  assert.equal(dados.contratante.pf.telefone, "(19) 99999-0000");
  assert.equal(dados.anuente.ativo, false);
});

test("casamento: locais diferentes viram duas linhas, e 'mesmo local' vira uma", () => {
  const base = { noivos: "Bia & Caio", data: "2026-11-14", entrega: "Em até 1 semana", making_of: "Não" };
  const dois = dadosIniciais(lead("casamento", { ...base, local_cerimonia: "Igreja Fictícia", local_festa: "Salão Fictício" }), HOJE);
  assert.deepEqual(dois.evento.locais, [
    { rotulo: "Local da cerimônia", endereco: "Igreja Fictícia" },
    { rotulo: "Local da recepção", endereco: "Salão Fictício" },
  ]);
  assert.equal(dois.servico.pacote, "Pacote Principal");
  assert.equal(dois.servico.tabela, "2026");
  assert.equal(dois.servico.valorPacote, 129000);

  for (const festa of ["Mesmo local", "no mesmo lugar", "O mesmo", "idem"]) {
    const um = dadosIniciais(lead("casamento", { ...base, local_cerimonia: "Chácara Fictícia", local_festa: festa }), HOJE);
    assert.deepEqual(um.evento.locais, [{ rotulo: "Local da cerimônia e recepção", endereco: "Chácara Fictícia" }], festa);
  }
});

test("'A definir' do formulario chega VAZIO: horario e local seguem faltando no contrato", () => {
  // A caixa "decidir depois" grava "A definir". Passado adiante, viraria um
  // endereco valido ("Local da cerimônia: A definir") e, no horario, "horário
  // inválido". Vazio, a montagem acusa a falta e a Mel confirma com o cliente.
  const l = lead("casamento", {
    noivos: "Bia & Caio",
    data: "2027-05-08",
    horario: "A definir",
    local_cerimonia: "A definir",
    local_festa: "A definir",
    making_of: "Sim",
    local_making_of: "A definir",
    entrega: "Em até 1 semana",
  });
  const dados = dadosIniciais(l, HOJE);
  assert.equal(dados.evento.horarioInicio, "");
  // Duas linhas vazias, e nao "mesmo lugar": dois "A definir" iguais nao
  // dizem que cerimonia e festa sao no mesmo endereco.
  assert.deepEqual(dados.evento.locais, [
    { rotulo: "Local da cerimônia", endereco: "" },
    { rotulo: "Local da recepção", endereco: "" },
  ]);
  assert.equal(dados.evento.makingOfLocal, "");

  const falta = faltantes(dados, { ...contextoDoLead(l, HOJE), templateId: "casamento" });
  assert.ok(falta.includes("Início da cobertura do evento"), falta.join(" | "));
  assert.ok(falta.includes("Endereço: Local da cerimônia"), falta.join(" | "));
  assert.ok(falta.includes("Endereço: Local da recepção"), falta.join(" | "));
  assert.ok(!falta.some((f) => /inválido/.test(f)), falta.join(" | "));

  const outro = dadosIniciais(lead("aniversario", { idade: "30", horario: "A definir", local: "A definir" }), HOJE);
  assert.equal(outro.evento.horarioInicio, "");
  assert.deepEqual(outro.evento.locais, [{ rotulo: "Local do evento", endereco: "" }]);
});

test("casamento com making of: making of da noiva pre-marcado e local do making of", () => {
  const dados = dadosIniciais(
    lead("casamento", {
      noivos: "Ana & João",
      data: "2027-01-23",
      local_cerimonia: "A",
      local_festa: "B",
      making_of: "Sim",
      local_making_of: "Hotel Fictício",
      entrega: "Em até 1 semana",
    }),
    HOJE,
  );
  assert.equal(dados.evento.makingOfLocal, "Hotel Fictício");
  assert.equal(dados.evento.makingOfHorario, "");
  assert.deepEqual(dados.servico.adicionais, [
    {
      id: "casamento.making_of_noiva",
      tipo: "making_of",
      descricao: "Making of da noiva",
      quantidade: 1,
      valorUnitario: 38000,
      minutos: 120,
    },
  ]);
});

test("debutante: nome de quem assina fica vazio (a Mel confirma o responsavel), pacote a escolher", () => {
  const dados = dadosIniciais(
    lead("debutante", {
      nome: "Debutante Que Preencheu",
      debutante: "Maria Fictícia",
      data: "2027-03-20",
      horario: "20:00",
      local: "Buffet Fictício",
      making_of: "Sim",
      local_making_of: "Salão de beleza fictício",
      entrega: "Em até 1 semana",
    }),
    HOJE,
  );
  assert.deepEqual(dadosContratoSchema.parse(dados), dados);
  assert.equal(dados.contratante.pf.nome, "");
  assert.equal(dados.contratante.pf.email, "contato@exemplo.com", "contato vem mesmo assim");
  assert.equal(dados.contratante.vinculo, "");
  assert.equal(dados.evento.homenageado, "Maria Fictícia");
  assert.deepEqual(dados.evento.locais, [{ rotulo: "Local do evento", endereco: "Buffet Fictício" }]);
  assert.equal(dados.evento.makingOfLocal, "Salão de beleza fictício");
  assert.equal(dados.servico.pacote, "");
  assert.equal(dados.servico.valorPacote, 0);
  assert.deepEqual(dados.servico.adicionais, [], "o making of da debutante esta nos pacotes, nao e adicional");
  assert.equal(dados.servico.tabela, "2027");
});

test("aniversario: menor sem nome pre-preenchido; adulto com nome", () => {
  const menor = dadosIniciais(lead("aniversario", { nome: "Mãe Fictícia", aniversariante: "Theo", idade: "6", data: "2026-12-05", local: "Casa de festas" }), HOJE);
  assert.equal(menor.contratante.pf.nome, "");
  assert.equal(menor.evento.homenageado, "Theo");

  const adulto = dadosIniciais(lead("aniversario", { nome: "Pessoa Fictícia", aniversariante: "Pessoa Fictícia", idade: "30", data: "2026-12-05", local: "Bar" }), HOJE);
  assert.equal(adulto.contratante.pf.nome, "Pessoa Fictícia");

  const dezessete = dadosIniciais(lead("aniversario", { nome: "Jovem Fictício", idade: "17", data: "2026-12-05" }), HOJE);
  assert.equal(dezessete.contratante.pf.nome, "", "17 anos ainda e menor");
});

test("corporativo nasce como pessoa juridica com a razao social e o tipo do evento", () => {
  const dados = dadosIniciais(
    lead("corporativo", {
      nome: "Pessoa do Marketing",
      empresa: "Empresa Fictícia Ltda",
      tipo_evento: "lançamento",
      data: "2026-11-10",
      horario: "19:00",
      local: "Centro de convenções fictício",
    }),
    HOJE,
  );
  assert.deepEqual(dadosContratoSchema.parse(dados), dados);
  assert.equal(dados.contratante.tipo, "pj");
  assert.equal(dados.contratante.pj.razaoSocial, "Empresa Fictícia Ltda");
  assert.equal(dados.contratante.pj.representante.email, "contato@exemplo.com");
  assert.equal(dados.contratante.pj.representante.nome, "", "quem representa a empresa e a Mel que confirma");
  assert.equal(dados.evento.tipoEvento, "lançamento");
  assert.equal(dados.evento.homenageado, "Empresa Fictícia Ltda");
});

test("pagamento pre-preenchido e o 30/70, e passa na validacao com evento futuro", () => {
  const dados = dadosIniciais(lead("casamento", { noivos: "A & B", data: "2027-01-23", entrega: "Em até 1 semana" }), HOJE);
  assert.deepEqual(dados.pagamento, pagamentoDoPreset("30/70"));
  assert.deepEqual(validarPagamento(dados.pagamento, 149000, dados.evento.data, HOJE), []);
});

test("tabela sai do ano do evento; sem data, do ano de hoje", () => {
  assert.equal(dadosIniciais(lead("debutante", { data: "2026-12-31" }), HOJE).servico.tabela, "2026");
  assert.equal(dadosIniciais(lead("debutante", { data: "2027-01-01" }), HOJE).servico.tabela, "2027");
  assert.equal(dadosIniciais(lead("debutante", {}), HOJE).servico.tabela, "2026");
  assert.equal(dadosIniciais(lead("debutante", {}), "2027-02-01").servico.tabela, "2027");
});

test("lead quase vazio (so o WhatsApp) ainda gera dados validos pelo schema", () => {
  for (const categoria of ["debutante", "aniversario", "casamento", "corporativo"] as const) {
    const l = lead(categoria, {});
    l.respostas = { contato_whatsapp: "(19) 99999-0000" };
    const dados = dadosIniciais(l, HOJE);
    assert.deepEqual(dadosContratoSchema.parse(dados), dados, categoria);
    assert.equal(dados.contratante.pf.email, "");
  }
});

test("resposta gigante e cortada no limite do schema em vez de derrubar o pre-preenchimento", () => {
  const dados = dadosIniciais(lead("debutante", { local: "x".repeat(5000) }), HOJE);
  assert.equal(dados.evento.locais[0].endereco.length, 2000);
});

// ---------------------------------------------------------------- rotulos --

test("todo status tem rotulo para o painel", () => {
  for (const s of STATUS_CONTRATO) assert.ok(ROTULO_STATUS_CONTRATO[s], s);
  for (const s of STATUS_ASSINATURA) assert.ok(ROTULO_STATUS_ASSINATURA[s], s);
  assert.equal(ROTULO_STATUS_CONTRATO.enviado, "Aguardando assinaturas");
  assert.equal(ROTULO_STATUS_ASSINATURA.concluido, "Assinado por todos");
});
