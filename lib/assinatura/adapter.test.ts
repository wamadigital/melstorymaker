import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { env } from "@/lib/env";
import {
  ASSUNTO_ASSINATURA,
  AssinaturaError,
  AssinaturaNaoConfiguradaError,
  MENSAGEM_ASSINATURA,
  ProvedorDryRun,
  assinaturaConfigurada,
  assinaturaEmDryRun,
  criarProvedorAssinatura,
  escolherProvedor,
  mascararEmail,
  nomeArquivoSeguro,
  pedidoInalcancavel,
  provedorDoToken,
  recuperarPapel,
  signatariosDoContrato,
  validarPedido,
  type PedidoAssinatura,
} from "./adapter";
import { dadosContratoSchema, type Assinante } from "@/lib/contrato/tipos";

/**
 * O `env` do projeto e um Proxy preguicoso que le `process.env` na primeira
 * leitura e cacheia. Os testes nao carregam `.env.local`, entao o ambiente e
 * montado aqui -- UMA vez por arquivo, porque o cache e do modulo. O cenario
 * escolhido e o do desenvolvimento: dry run ligado e sem chave da iLoveAPI.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.MAIL_FROM = "Mel <mel@wama.digital>";
process.env.MAIL_DRY_RUN = "1";
process.env.APP_URL = "https://melstorymaker.com.br";
process.env.MEL_WHATSAPP = "5519988887777";
process.env.ASSINATURA_DRY_RUN = "1";
delete process.env.ILOVEAPI_PUBLIC_KEY;
delete process.env.ILOVEAPI_SECRET_KEY;

// Dados todos FICTICIOS (dominios example.*, reservados pela RFC 2606).
const PDF = new TextEncoder().encode("%PDF-1.7\n% contrato de teste\n%%EOF\n");

function pedido(extra: Partial<PedidoAssinatura> = {}): PedidoAssinatura {
  return {
    pdf: PDF,
    nomeArquivo: "Contrato - Maria Eduarda.pdf",
    signatarios: [
      { papel: "contratante", nome: "Joana Exemplo da Silva", email: "joana.exemplo@example.com" },
      { papel: "contratada", nome: "Storymaker Fictícia", email: "contratada@example.org" },
    ],
    posicoes: [
      { papel: "contratante", pagina: 4, x: 64, yTopo: 612, largura: 200, altura: 40 },
      { papel: "contratada", pagina: 4, x: 331, yTopo: 612, largura: 200, altura: 40 },
    ],
    assunto: ASSUNTO_ASSINATURA,
    mensagem: MENSAGEM_ASSINATURA,
    diasValidade: 30,
    ...extra,
  };
}

function invalidoCom(trecho: RegExp) {
  return (e: unknown) => {
    assert.ok(e instanceof AssinaturaError, `esperava AssinaturaError, veio ${String(e)}`);
    assert.equal(e.codigo, "pedido_invalido");
    assert.match(e.message, trecho);
    return true;
  };
}

// ------------------------------------------------------------ utilitarios --

test("e-mail no log sai mascarado: primeira letra e domínio", () => {
  assert.equal(mascararEmail("mel@wama.digital"), "m***@wama.digital");
  assert.equal(mascararEmail("  Joana.Exemplo@example.com "), "J***@example.com");
  assert.equal(mascararEmail("@example.com"), "***@example.com");
  assert.equal(mascararEmail("sem-arroba"), "***");
});

test("o papel volta pelo e-mail, sem caixa; pelo nome só quando não há dúvida", () => {
  const conhecidos = [
    { papel: "contratante" as const, email: "Joana.Exemplo@example.com", nome: "Joana Exemplo da Silva" },
    { papel: "anuente" as const, email: "pedro@example.net", nome: "Pedro Exemplo" },
    { papel: "contratada" as const, email: "contratada@example.org", nome: "Pedro Exemplo" },
  ];
  assert.equal(recuperarPapel(" joana.exemplo@EXAMPLE.com", "", conhecidos), "contratante");
  // E-mail corrigido no painel da iLoveAPI: o nome ainda identifica.
  assert.equal(recuperarPapel("joana.nova@example.com", "JOANA  Éxemplo da Silva", conhecidos), "contratante");
  // Dois conhecidos com o mesmo nome: nulo, nunca o papel errado.
  assert.equal(recuperarPapel("outro@example.com", "Pedro Exemplo", conhecidos), null);
  assert.equal(recuperarPapel("outro@example.com", "", conhecidos), null);
});

test("nome do arquivo perde caminho e controle e termina em .pdf", () => {
  assert.equal(nomeArquivoSeguro("Contrato - Maria Eduarda.pdf"), "Contrato - Maria Eduarda.pdf");
  assert.equal(nomeArquivoSeguro("Contrato - Ana/João"), "Contrato - Ana João.pdf");
  assert.equal(nomeArquivoSeguro("..\\..\\x\u0000.PDF"), ".. .. x.pdf");
  assert.equal(nomeArquivoSeguro("   "), "Contrato.pdf");
});

// ------------------------------------------------------- quem a plataforma ve --

/** Bloco de assinaturas como `assinaturasDoContrato` o monta. Tudo ficticio. */
const BLOCO_PJ: Assinante[] = [
  {
    papel: "contratante",
    rotulo: "CONTRATANTE",
    nome: "Alfa Eventos Fictícios Ltda.",
    documento: "CNPJ: 11.222.333/0001-81 — p. Roberto Alves Exemplo, CPF: 314.159.265-90",
    email: "roberto@alfa.example.com",
  },
  {
    papel: "contratada",
    rotulo: "CONTRATADA",
    nome: "Storymaker Fictícia",
    documento: "CPF: 123.456.789-09",
    email: "contratada@example.org",
  },
];

const SERVICO = { tabela: "2027", pacote: "Pacote Pocket" };

function dadosPj(representante: string) {
  return dadosContratoSchema.parse({
    servico: SERVICO,
    contratante: {
      tipo: "pj",
      pj: {
        razaoSocial: "Alfa Eventos Fictícios Ltda.",
        cnpj: "11222333000181",
        representante: { nome: representante, cpf: "31415926590", email: "roberto@alfa.example.com" },
      },
    },
  });
}

test("contratante PJ vai à plataforma com o nome do representante, não com a razão social", () => {
  const signatarios = signatariosDoContrato(BLOCO_PJ, dadosPj("  Roberto   Alves Exemplo "));
  assert.deepEqual(signatarios, [
    { papel: "contratante", nome: "Roberto Alves Exemplo", email: "roberto@alfa.example.com" },
    { papel: "contratada", nome: "Storymaker Fictícia", email: "contratada@example.org" },
  ]);
  assert.ok(!signatarios.some((s) => /Ltda/.test(s.nome)), "a razão social fica só no PDF");
});

test("contratante PF, contratada e anuente vão com o nome do bloco", () => {
  const bloco: Assinante[] = [
    { ...BLOCO_PJ[0], nome: "Joana Exemplo da Silva", documento: "CPF: 123.456.789-09", email: "joana@example.com" },
    BLOCO_PJ[1],
    { papel: "anuente", rotulo: "ANUENTE", nome: "Pedro Exemplo", documento: "CPF: 987.654.321-00", email: "pedro@example.net" },
  ];
  // Os dados PJ guardados ao lado (a Mel alternou para PF) nao contam.
  const dados = dadosContratoSchema.parse({
    servico: SERVICO,
    contratante: { tipo: "pf", pj: { representante: { nome: "Outro Nome" } } },
  });
  assert.deepEqual(
    signatariosDoContrato(bloco, dados).map((s) => s.nome),
    ["Joana Exemplo da Silva", "Storymaker Fictícia", "Pedro Exemplo"],
  );
});

test("PJ sem nome de representante cai na razão social em vez de mandar nome vazio", () => {
  assert.equal(signatariosDoContrato(BLOCO_PJ, dadosPj("   "))[0].nome, "Alfa Eventos Fictícios Ltda.");
});

// ----------------------------------------------------- pedido inalcancavel --

test("pedido que sumiu da plataforma ou token ilegível é inalcançável; token de outro provedor não é", () => {
  const erro = (codigo: ConstructorParameters<typeof AssinaturaError>[1]["codigo"], status: number | null = null) =>
    new AssinaturaError("x", { codigo, status });
  assert.equal(pedidoInalcancavel(erro("inexistente", 404)), true);
  assert.equal(pedidoInalcancavel(erro("token_ilegivel")), true);
  // Envio de verdade chegando ao dry run: o pedido pode estar vivo no cliente.
  assert.equal(pedidoInalcancavel(erro("token_invalido")), false);
  assert.equal(pedidoInalcancavel(erro("http", 404)), false);
  assert.equal(pedidoInalcancavel(erro("http", 502)), false);
  assert.equal(pedidoInalcancavel(erro("rede")), false);
  assert.equal(pedidoInalcancavel(new Error("inexistente")), false);
});

// ---------------------------------------------------------------- validacao --

test("pedido completo passa na validação", () => {
  assert.doesNotThrow(() => validarPedido(pedido()));
});

test("mesmo e-mail em duas pessoas é recusado, nomeando os dois papéis", () => {
  const [contratante, contratada] = pedido().signatarios;
  assert.throws(
    () => validarPedido(pedido({ signatarios: [contratante, { ...contratada, email: "JOANA.EXEMPLO@example.com" }] })),
    invalidoCom(/^CONTRATANTE e CONTRATADA estão com o mesmo e-mail\. Cada pessoa precisa de um e-mail próprio para assinar\.$/),
  );
});

test("e-mail inválido, nome vazio e papel repetido são recusados", () => {
  const [contratante, contratada] = pedido().signatarios;
  assert.throws(
    () => validarPedido(pedido({ signatarios: [{ ...contratante, email: "joana@" }, contratada] })),
    invalidoCom(/^O e-mail de quem assina como CONTRATANTE não parece válido\.$/),
  );
  assert.throws(
    () => validarPedido(pedido({ signatarios: [contratante, { ...contratada, nome: "  " }] })),
    invalidoCom(/^Falta o nome de quem assina como CONTRATADA\.$/),
  );
  assert.throws(
    () => validarPedido(pedido({ signatarios: [contratante, { ...contratante, email: "outra@example.com" }] })),
    invalidoCom(/^Há duas pessoas assinando como CONTRATANTE\.$/),
  );
  assert.throws(() => validarPedido(pedido({ signatarios: [] })), invalidoCom(/ninguém para assinar/));
});

test("signatário sem lugar de assinatura no PDF é recusado", () => {
  const p = pedido();
  p.signatarios.push({ papel: "anuente", nome: "Pedro Exemplo", email: "pedro@example.net" });
  assert.throws(
    () => validarPedido(p),
    invalidoCom(/^O PDF não tem o lugar da assinatura de quem assina como ANUENTE\. Gere o PDF de novo\.$/),
  );
  const [contratante] = pedido().posicoes;
  assert.throws(
    () => validarPedido(pedido({ posicoes: [{ ...contratante, pagina: 0 }, pedido().posicoes[1]] })),
    invalidoCom(/ficou inválido no PDF/),
  );
  assert.throws(
    () => validarPedido(pedido({ posicoes: [{ ...contratante, yTopo: Number.NaN }, pedido().posicoes[1]] })),
    invalidoCom(/ficou inválido no PDF/),
  );
});

test("prazo fora de 1 a 130 dias e arquivo que não é PDF são recusados", () => {
  assert.throws(() => validarPedido(pedido({ diasValidade: 0 })), invalidoCom(/entre 1 e 130 dias/));
  assert.throws(() => validarPedido(pedido({ diasValidade: 131 })), invalidoCom(/entre 1 e 130 dias/));
  assert.throws(() => validarPedido(pedido({ diasValidade: 7.5 })), invalidoCom(/entre 1 e 130 dias/));
  assert.throws(
    () => validarPedido(pedido({ pdf: new TextEncoder().encode("<html>") })),
    invalidoCom(/não é um PDF válido/),
  );
  assert.throws(() => validarPedido(pedido({ pdf: new Uint8Array() })), invalidoCom(/não é um PDF válido/));
});

// ------------------------------------------------------------------ dry run --

test("dry run não chama rede, devolve token de teste e todos pendentes", async () => {
  const chamadasFetch = mock.method(globalThis, "fetch", async () => new Response("não devia"));
  mock.method(console, "info", () => {});

  const r = await new ProvedorDryRun().enviar(pedido());

  assert.equal(chamadasFetch.mock.callCount(), 0);
  assert.match(r.token, /^dry-[0-9a-f-]{36}$/);
  assert.equal(r.status, "enviado");
  assert.deepEqual(r.signatarios, [
    { papel: "contratante", nome: "Joana Exemplo da Silva", email: "joana.exemplo@example.com", status: "pendente", assinadoEm: null },
    { papel: "contratada", nome: "Storymaker Fictícia", email: "contratada@example.org", status: "pendente", assinadoEm: null },
  ]);
  mock.restoreAll();
});

test("o log do dry run mascara o e-mail e não traz nome de ninguém", async () => {
  const linhas: string[] = [];
  mock.method(console, "info", (...args: unknown[]) => linhas.push(args.map(String).join(" ")));

  await new ProvedorDryRun().enviar(pedido());
  const log = linhas.join("\n");

  assert.match(log, /ASSINATURA_DRY_RUN=1, nada foi enviado/);
  assert.match(log, /contratante j\*\*\*@example\.com/);
  assert.match(log, /contratada c\*\*\*@example\.org/);
  assert.doesNotMatch(log, /joana\.exemplo@|contratada@/, "e-mail completo no log");
  // Nem quem assina nem o homenageado (que esta no nome do arquivo).
  assert.doesNotMatch(log, /Joana|Storymaker|Maria Eduarda/);
  mock.restoreAll();
});

test("dry run valida o pedido como o provedor de verdade", async () => {
  const [contratante, contratada] = pedido().signatarios;
  await assert.rejects(
    new ProvedorDryRun().enviar(pedido({ signatarios: [contratante, { ...contratada, email: contratante.email }] })),
    invalidoCom(/mesmo e-mail/),
  );
});

test("consulta do dry run fica enviado com os conhecidos pendentes; baixar não tem o que baixar", async () => {
  const dry = new ProvedorDryRun();
  const conhecidos = pedido().signatarios.map((s) => ({ ...s, status: "pendente" as const, assinadoEm: null }));

  const r = await dry.consultar("dry-1234", conhecidos);
  assert.equal(r.status, "enviado");
  assert.equal(r.concluidoEm, null);
  assert.deepEqual(
    r.signatarios.map((s) => [s.papel, s.status]),
    [
      ["contratante", "pendente"],
      ["contratada", "pendente"],
    ],
  );

  for (const baixar of [dry.baixarAssinado.bind(dry), dry.baixarTrilha.bind(dry)]) {
    await assert.rejects(baixar("dry-1234"), (e) => e instanceof AssinaturaError && e.codigo === "sem_arquivo");
  }

  mock.method(console, "info", () => {});
  await dry.cancelar("dry-1234");
  mock.restoreAll();
});

test("dry run recusa token de envio de verdade em vez de fingir que cancelou", async () => {
  const dry = new ProvedorDryRun();
  for (const acao of [
    () => dry.cancelar("api84.ilovepdf.com|tr-abc"),
    () => dry.consultar("api84.ilovepdf.com|tr-abc"),
    () => dry.baixarAssinado("api84.ilovepdf.com|tr-abc"),
  ]) {
    await assert.rejects(acao(), (e) => e instanceof AssinaturaError && e.codigo === "token_invalido");
  }
});

// ------------------------------------------------------------------ fabrica --

test("com dry run ligado o provedor é sempre o de teste, mesmo com chave", async () => {
  assert.equal((await escolherProvedor({ dryRun: true, publicKey: "project_public_x" })).nome, "dry-run");
  assert.equal((await escolherProvedor({ dryRun: true, publicKey: undefined })).nome, "dry-run");
});

test("sem dry run e sem chave, a assinatura não está configurada", async () => {
  await assert.rejects(escolherProvedor({ dryRun: false, publicKey: undefined }), (e) => {
    assert.ok(e instanceof AssinaturaNaoConfiguradaError);
    // Nao e AssinaturaError: a rota responde 503, e nao "plataforma fora do ar".
    assert.ok(!(e instanceof AssinaturaError));
    assert.equal(e.message, "A assinatura eletrônica não está configurada.");
    return true;
  });
});

test("sem dry run e com chave, o provedor é a iLoveAPI", async () => {
  const provedor = await escolherProvedor({ dryRun: false, publicKey: "project_public_x" });
  assert.equal(provedor.nome, "ilovepdf");
});

// As chaves ASSINATURA_DRY_RUN e ILOVEAPI_PUBLIC_KEY entram no schema de
// lib/env.ts em outra frente. Ate la o Proxy devolve `undefined` para elas, e
// estes testes -- os unicos que passam pelo env -- ficam pulados em vez de
// falhar por um motivo que nao e deste modulo. Com o schema pronto, o
// ASSINATURA_DRY_RUN vira booleano e eles rodam.
const envSemAssinatura =
  (env as unknown as Record<string, unknown>).ASSINATURA_DRY_RUN === undefined
    ? "lib/env.ts ainda não tem ASSINATURA_DRY_RUN"
    : false;

test("o env do desenvolvimento (dry run, sem chave) libera o botão e usa o provedor de teste", { skip: envSemAssinatura }, async () => {
  assert.equal(assinaturaEmDryRun(), true);
  assert.equal(assinaturaConfigurada(), true);
  assert.equal((await criarProvedorAssinatura()).nome, "dry-run");
});

test("envio existente segue o provedor que o fez, não o env de agora", { skip: envSemAssinatura }, async () => {
  assert.equal((await provedorDoToken("dry-1234")).nome, "dry-run");
  // Token de verdade com o dry run ligado vai para a iLoveAPI -- que aqui nao
  // tem chave, entao a resposta honesta e "nao configurada", nunca o dry run.
  await assert.rejects(provedorDoToken("api84.ilovepdf.com|tr-abc"), AssinaturaNaoConfiguradaError);
});
