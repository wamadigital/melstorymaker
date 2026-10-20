import assert from "node:assert/strict";
import { test } from "node:test";
import { pacoteDoCatalogo } from "./catalogo";
import { montarContrato, type ContextoMontagem } from "./montar";
import { pagamentoDoPreset } from "./pagamento";
import { dadosContratoSchema, type DadosContrato } from "./tipos";
import { assinantesConferemComDados } from "./assinantes";

// Dados ficticios, sem servicos externos nem credenciais.
const CTX: ContextoMontagem = {
  categoria: "casamento",
  templateId: "casamento",
  idadeHomenageado: null,
  hojeISO: "2026-10-20",
};

function dadosFicticios(tipo: "pf" | "pj" = "pf"): DadosContrato {
  const pacote = pacoteDoCatalogo("casamento", "Pacote Principal");
  assert.ok(pacote);
  const endereco = {
    logradouro: "Rua Ficticia",
    numero: "123",
    bairro: "Centro",
    cidade: "Campinas",
    uf: "SP",
  };
  return dadosContratoSchema.parse({
    contratante: {
      tipo,
      pf: {
        nome: "Ana Paula Exemplo",
        genero: "feminino",
        cpf: "12345678909",
        email: "ana@example.com",
        endereco,
      },
      pj: {
        razaoSocial: "Alfa Ficticia Ltda.",
        cnpj: "11222333000181",
        endereco,
        representante: {
          nome: "Roberto Exemplo",
          genero: "masculino",
          cpf: "31415926590",
          cargo: "socio-administrador",
          email: "roberto@example.com",
        },
      },
    },
    anuente: {
      ativo: true,
      nome: "Joao Exemplo",
      genero: "masculino",
      cpf: "98765432100",
      email: "joao@example.com",
      papel: "noivo",
    },
    evento: {
      data: "2027-03-20",
      horarioInicio: "16:00",
      homenageado: "Ana e Joao",
      locais: [{ rotulo: "Local do evento", endereco: "Espaco Ficticio, Campinas/SP" }],
    },
    servico: { tabela: "2027", pacote: pacote.nome, valorPacote: 149000, escopo: pacote.escopo },
    pagamento: pagamentoDoPreset("30/70"),
  });
}

test("clausula manual e dados de valor/data alterados preservam a identidade de quem assina", () => {
  const dados = dadosFicticios();
  const { documento } = montarContrato(dados, CTX);
  assert.equal(assinantesConferemComDados(documento, dados, CTX), true);
  documento.clausulas[0] = {
    ...documento.clausulas[0],
    origem: "editada",
    paragrafos: ["Texto aprovado e escrito manualmente pela Mel."],
  };
  dados.servico.valorPacote = 200000;
  dados.evento.data = "2027-06-01";
  const antes = structuredClone({ documento, dados });
  assert.equal(assinantesConferemComDados(documento, dados, CTX), true);
  assert.deepEqual({ documento, dados }, antes, "a conferencia nao remonta nem altera o documento");
});

for (const campo of ["nome", "cpf", "email"] as const) {
  test(`alterar ${campo} da pessoa fisica impede enviar para a identidade antiga`, () => {
    const dados = dadosFicticios();
    const { documento } = montarContrato(dados, CTX);
    dados.contratante.pf[campo] = campo === "cpf" ? "98765432100" : `${dados.contratante.pf[campo]} alterado`;
    assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
  });
}

for (const campo of ["papel", "rotulo", "nome", "documento", "email"] as const) {
  test(`o campo ${campo} do bloco de assinaturas precisa corresponder exatamente`, () => {
    const dados = dadosFicticios();
    const { documento } = montarContrato(dados, CTX);
    if (campo === "papel") documento.assinaturas[0].papel = "anuente";
    else documento.assinaturas[0][campo] += " alterado";
    assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
  });
}

test("a ordem e a quantidade de assinantes precisam corresponder", () => {
  const dados = dadosFicticios();
  const { documento } = montarContrato(dados, CTX);
  documento.assinaturas.reverse();
  assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
  documento.assinaturas.reverse();
  documento.assinaturas.pop();
  assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
});

test("desativar ou mudar o e-mail do anuente impede o envio com o bloco antigo", () => {
  const dados = dadosFicticios();
  const { documento } = montarContrato(dados, CTX);
  dados.anuente.email = "outro@example.com";
  assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
  dados.anuente.email = "joao@example.com";
  dados.anuente.ativo = false;
  assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
});

test("PJ preserva a empresa no bloco e confere os dados de seu representante", () => {
  const dados = dadosFicticios("pj");
  const { documento } = montarContrato(dados, CTX);
  assert.equal(documento.assinaturas[0].nome, "Alfa Ficticia Ltda.");
  assert.equal(assinantesConferemComDados(documento, dados, CTX), true);
  for (const campo of ["nome", "cpf", "email"] as const) {
    const alterados = structuredClone(dados);
    alterados.contratante.pj.representante[campo] =
      campo === "cpf" ? "12345678909" : `${alterados.contratante.pj.representante[campo]} alterado`;
    assert.equal(assinantesConferemComDados(documento, alterados, CTX), false, campo);
  }
  for (const campo of ["razaoSocial", "cnpj"] as const) {
    const alterados = structuredClone(dados);
    alterados.contratante.pj[campo] = campo === "cnpj" ? "55444333000182" : `${alterados.contratante.pj[campo]} alterado`;
    assert.equal(assinantesConferemComDados(documento, alterados, CTX), false, campo);
  }
});

test("falha ao derivar os assinantes devolve false sem liberar o envio", () => {
  const dados = dadosFicticios();
  const { documento } = montarContrato(dados, CTX);
  Object.defineProperty(dados, "servico", { get: () => { throw new Error("Dado indisponivel"); } });
  assert.equal(assinantesConferemComDados(documento, dados, CTX), false);
});
