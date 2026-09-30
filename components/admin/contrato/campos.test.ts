import assert from "node:assert/strict";
import { test } from "node:test";
import { dadosContratoSchema, type DadosContrato } from "@/lib/contrato/tipos";
import { adicionalDoCatalogo, ADICIONAL_LIVRE, novoAdicional, pacoteDoCatalogo } from "@/lib/contrato/catalogo";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import { faltantes, type ContextoMontagem } from "@/lib/contrato/montar";
import { campoDoFaltante, ID, secaoCitada } from "./campos";

// Tudo FICTICIO. Os cenarios sao dados INCOMPLETOS de proposito: o que se
// testa e que toda frase que a montagem devolve no 422 leva a um campo.
const HOJE = "2026-09-29";

function ctx(
  categoria: ContextoMontagem["categoria"],
  templateId: ContextoMontagem["templateId"],
  idade: number | null = null,
): ContextoMontagem {
  return { categoria, templateId, idadeHomenageado: idade, hojeISO: HOJE };
}

function dados(parcial: Record<string, unknown>): DadosContrato {
  return dadosContratoSchema.parse({ servico: { tabela: "2026" }, ...parcial });
}

function semAtalho(lista: string[], d: DadosContrato): string[] {
  return lista.filter((f) => campoDoFaltante(f, d) === null);
}

test("toda frase do 422 de um contrato vazio (PF, evento de menor) leva a um campo", () => {
  const d = dados({
    anuente: { ativo: true },
    evento: {
      locais: [
        { rotulo: "Local do evento", endereco: "" },
        { rotulo: "", endereco: "Salão Azul" },
      ],
    },
    pagamento: pagamentoDoPreset("15/15/70"),
  });
  const lista = faltantes(d, ctx("debutante", "debutante", 15));
  assert.ok(lista.length > 15, "o cenario precisa exercitar muitas frases");
  assert.deepEqual(semAtalho(lista, d), []);
});

test("toda frase do 422 de uma empresa (PJ) sem dados leva a um campo", () => {
  const d = dados({ contratante: { tipo: "pj", pj: { cnpj: "11222333000100" } } });
  const lista = faltantes(d, ctx("corporativo", "corporativo"));
  assert.ok(lista.some((f) => f.startsWith("CNPJ da empresa")));
  assert.deepEqual(semAtalho(lista, d), []);
});

test("dados invalidos (CPF, e-mail, UF, horario, data passada) tambem tem atalho", () => {
  const d = dados({
    contratante: {
      pf: {
        nome: "Ana",
        genero: "feminino",
        cpf: "11111111111",
        email: "ana@@exemplo",
        endereco: { logradouro: "Rua A", numero: "1", bairro: "B", cidade: "C", uf: "São Paulo" },
      },
    },
    evento: { data: "2020-01-01", horarioInicio: "25:00", homenageado: "Carla", makingOfHorario: "9h" },
  });
  const lista = faltantes(d, ctx("aniversario", "aniversario_adulto", 30));
  assert.deepEqual(semAtalho(lista, d), []);
  assert.equal(campoDoFaltante("CPF de quem assina (o número não é válido)", d), ID.pfCpf);
  assert.equal(
    campoDoFaltante("Endereço de quem assina: UF (a sigla, com 2 letras)", d),
    ID.pfEndereco("uf"),
  );
  assert.equal(campoDoFaltante("Início do making of (horário inválido)", d), ID.evMakingOfHorario);
});

test("CEP pela metade (PF e sede da empresa) leva ao campo do CEP", () => {
  const endereco = { logradouro: "Rua A", numero: "1", bairro: "B", cidade: "C", uf: "SP", cep: "131015" };
  const pf = dados({
    contratante: { pf: { nome: "Ana", genero: "feminino", cpf: "11144477735", email: "ana@exemplo.com.br", endereco } },
  });
  const listaPf = faltantes(pf, ctx("aniversario", "aniversario_adulto", 30));
  const cepPf = listaPf.find((f) => f.includes("CEP"));
  assert.ok(cepPf, "a montagem precisa recusar o CEP incompleto");
  assert.equal(campoDoFaltante(cepPf, pf), ID.pfEndereco("cep"));

  const pj = dados({ contratante: { tipo: "pj", pj: { cnpj: "11222333000181", endereco: { ...endereco, cep: "1310150000" } } } });
  const cepPj = faltantes(pj, ctx("corporativo", "corporativo")).find((f) => f.includes("CEP"));
  assert.ok(cepPj);
  assert.equal(campoDoFaltante(cepPj, pj), ID.pjEndereco("cep"));
});

test("adicional e citado pela posicao ou pela descricao, e o atalho vai para o adicional certo", () => {
  const noiva = adicionalDoCatalogo("casamento", "casamento.making_of_noiva");
  assert.ok(noiva);
  const livre = { ...novoAdicional(ADICIONAL_LIVRE, "Pacote Principal", "2027"), descricao: "" };
  const comValorZero = { ...novoAdicional(noiva, "Pacote Principal", "2027"), valorUnitario: 0, minutos: 0 };
  const d = dados({ servico: { tabela: "2026", adicionais: [livre, comValorZero] } });
  const lista = faltantes(d, ctx("casamento", "casamento"));
  assert.deepEqual(semAtalho(lista, d), []);
  assert.equal(campoDoFaltante("Descrição do adicional nº 1", d), ID.adDescricao(0));
  assert.equal(campoDoFaltante("Valor do adicional “Making of da noiva”", d), ID.adValor(1));
  assert.equal(campoDoFaltante("Duração do adicional “Making of da noiva”", d), ID.adMinutos(1));
});

test("frases do pagamento levam a parcela certa (pela letra) ou ao bloco", () => {
  const d = dados({});
  assert.equal(campoDoFaltante("Parcela B: informe a data de vencimento.", d), ID.pgData(1));
  assert.equal(campoDoFaltante("Parcela C: informe o percentual.", d), ID.pgPercentual(2));
  assert.equal(
    campoDoFaltante(
      "Parcela B: “até 10 dias antes do evento” cai em 20/09/2026, que já passou, e a parcela venceria antes da assinatura. Use “na assinatura”.",
      d,
    ),
    ID.pgDias(1),
  );
  assert.equal(
    campoDoFaltante(
      "Parcela A: a data do pagamento (01/12/2026) é futura; parcela ainda não paga usa outro vencimento.",
      d,
    ),
    ID.pgData(0),
  );
  assert.equal(campoDoFaltante("Os percentuais das parcelas somam 90%; precisam somar 100%.", d), ID.pg);
  assert.equal(
    campoDoFaltante("Marque pelo menos uma parcela como sinal: é ela que garante a reserva da data.", d),
    ID.pgSinal(0),
  );
  assert.equal(campoDoFaltante("Informe a data em que o pagamento foi quitado.", d), ID.pgQuitadoEm);
  assert.equal(
    campoDoFaltante("Informe que parte do valor pago corresponde ao sinal (o padrão é 30%).", d),
    ID.pgSinalQuitado,
  );
});

test("quitado sem data e total zerado tambem tem atalho", () => {
  const d = dados({ pagamento: pagamentoDoPreset("quitado") });
  const lista = faltantes(d, ctx("casamento", "casamento"));
  assert.ok(lista.some((f) => f.includes("quitado")));
  assert.deepEqual(semAtalho(lista, d), []);
});

test("local citado pelo endereco ou pelo rotulo vai para a linha certa", () => {
  const d = dados({
    evento: {
      locais: [
        { rotulo: "Local da cerimônia", endereco: "Igreja Matriz" },
        { rotulo: "Local da recepção", endereco: "" },
        { rotulo: "", endereco: "Salão Azul" },
      ],
    },
  });
  assert.equal(campoDoFaltante("Endereço: Local da recepção", d), ID.evLocalEndereco(1));
  assert.equal(
    campoDoFaltante("Nome da linha do local “Salão Azul” (Local do evento, Local da cerimônia...)", d),
    ID.evLocalRotulo(2),
  );
  assert.equal(campoDoFaltante("Local do evento", d), ID.evLocais);
});

test("frase desconhecida nao tem atalho (aparece na lista, so sem o link)", () => {
  assert.equal(campoDoFaltante("Alguma coisa que ninguém previu", dados({})), null);
  assert.equal(campoDoFaltante("", dados({})), null);
});

test("ensaio do Pacote Luxo com data depois do evento ou horario torto leva ao campo do ensaio", () => {
  const luxo = pacoteDoCatalogo("debutante", "Pacote Luxo");
  assert.ok(luxo, "o Pacote Luxo da debutante tem ensaio");
  const base = dados({});
  const d = dados({
    evento: {
      data: "2027-05-15",
      horarioInicio: "20:00",
      homenageado: "Beatriz Fictícia",
      ensaioData: "2027-06-01",
      ensaioHorario: "9h",
    },
    servico: { ...base.servico, pacote: luxo.nome, escopo: luxo.escopo },
  });
  const lista = faltantes(d, ctx("debutante", "debutante", 15));
  assert.ok(lista.some((f) => f.startsWith("Data do ensaio")), "a data depois do evento e acusada");
  assert.ok(lista.some((f) => f.startsWith("Início do ensaio")), "o horario torto e acusado");
  assert.deepEqual(semAtalho(lista, d), []);
  assert.equal(
    campoDoFaltante("Data do ensaio fotográfico (é depois do evento; o ensaio acontece antes)", d),
    ID.evEnsaioData,
  );
  assert.equal(campoDoFaltante("Início do ensaio fotográfico (horário inválido)", d), ID.evEnsaioHorario);
});

test("aviso que manda usar uma secao do formulario aponta para ela", () => {
  assert.deepEqual(secaoCitada("Pagamento em 3 vezes: ajuste as parcelas na seção Pagamento."), {
    id: ID.blocoPagamento,
    rotulo: "Pagamento",
  });
  assert.equal(
    secaoCitada("Storymaker auxiliar: inclua o adicional na seção Serviço e gere o texto de novo.")?.id,
    ID.blocoServico,
  );
  assert.equal(secaoCitada("Local do making of: informe na seção Evento.")?.id, ID.blocoEvento);
  assert.equal(secaoCitada("CPF do noivo: preencha na seção Quem assina, como anuente.")?.id, ID.blocoQuem);
  // Sem acento, e com o nome de dentro de Serviço.
  assert.equal(secaoCitada("veja a secao pagamento")?.id, ID.blocoPagamento);
  assert.equal(secaoCitada("Ajuste o número de storymakers em Detalhes do pacote.")?.id, ID.blocoServico);
  assert.equal(secaoCitada("Vídeo extra: inclua em Adicional personalizado.")?.id, ID.blocoServico);
  // Vale a primeira seção citada.
  assert.equal(secaoCitada("Na seção Evento, e depois na seção Pagamento.")?.id, ID.blocoEvento);
  // Nada citado: sem link.
  assert.equal(secaoCitada("Não entendi esta observação: reescreva, por favor."), null);
  assert.equal(secaoCitada(""), null);
});
