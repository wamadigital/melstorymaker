import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  AssinaturaError,
  type PedidoAssinatura,
  type ProvedorAssinatura,
  type ResultadoConsulta,
  type ResultadoEnvio,
} from "@/lib/assinatura/adapter";
import { EnvioAssinaturaIncertoError } from "@/lib/assinatura/envio-incerto";
import { ILoveApi, montarToken } from "@/lib/assinatura/ilovepdf";
import { pacoteDoCatalogo, precoPacote } from "@/lib/contrato/catalogo";
import { montarContrato } from "@/lib/contrato/montar";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import { dadosContratoSchema } from "@/lib/contrato/tipos";
import { sha256Hex } from "@/lib/supabase/contratos";
import { Recusa, contextoDeMontagem, type LeadDoContrato } from "../_comum";
import { ID, bancoFalso, pdfDe } from "../_teste-banco";
import { MENSAGEM_PEDIDO_SUMIU, cancelarEnvio, enviarParaAssinatura, sincronizar, type IoAssinatura } from "./_fluxo";

// O fluxo da assinatura com o banco em memoria e um provedor falso (ou a
// iLoveAPI de verdade com um `fetch` falso). Nada sai para a rede. Tudo
// FICTICIO: dominios example.*, CPFs e CNPJ gerados so para o digito
// verificador.

const SERVER = "api84.ilovepdf.com";
const API = "https://api.ilovepdf.com/v1";
const TOKEN = montarToken(SERVER, "tr-abc");

/** Banco com um envio aberto na plataforma. */
function envioAberto(token: string | null = TOKEN) {
  return bancoFalso({
    status: "enviado",
    assinatura_provedor: "ilovepdf",
    assinatura_token: token,
    assinatura_status: "enviado",
    assinatura_signatarios: [],
  });
}

function provedorFalso(metodos: Partial<ProvedorAssinatura> = {}): ProvedorAssinatura {
  return {
    nome: "ilovepdf",
    enviar: async () => {
      throw new Error("enviar não era esperado");
    },
    consultar: async (): Promise<ResultadoConsulta> => ({ status: "enviado", signatarios: [], concluidoEm: null }),
    baixarAssinado: async () => {
      throw new Error("baixar não era esperado");
    },
    baixarTrilha: async () => {
      throw new Error("baixar não era esperado");
    },
    cancelar: async () => {},
    ...metodos,
  };
}

function ioCom(banco: ReturnType<typeof bancoFalso>, provedor: ProvedorAssinatura): IoAssinatura {
  return { ...banco.io, criarProvedor: async () => provedor, provedorDoToken: async () => provedor };
}

/** Silencia e guarda o console.warn/error/log do fluxo. */
function capturarLogs() {
  const linhas: string[] = [];
  const guardar = (...args: unknown[]) => {
    linhas.push(args.map(String).join(" "));
  };
  for (const metodo of ["warn", "error", "log"] as const) mock.method(console, metodo, guardar);
  return linhas;
}

function recusa(status: number, mensagem?: string | RegExp) {
  return (e: unknown) => {
    assert.ok(e instanceof Recusa, `esperava Recusa, veio ${String(e)}`);
    assert.equal(e.status, status);
    if (typeof mensagem === "string") assert.equal(e.message, mensagem);
    else if (mensagem) assert.match(e.message, mensagem);
    return true;
  };
}

const naoEncontrado = () =>
  new Response(JSON.stringify({ error: { code: 404, message: "Signature not found" } }), { status: 404 });

/** A iLoveAPI de verdade, falando com um `fetch` falso roteado por "METODO url". */
function iloveApiCom(rotas: Record<string, () => Response>): ILoveApi {
  const f = async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const chave = `${(init.method ?? "GET").toUpperCase()} ${String(entrada)}`;
    const rota = rotas[chave];
    if (!rota) throw new Error(`rota não mockada: ${chave}`);
    return rota();
  };
  return new ILoveApi({ publicKey: `project_public_fluxo_${Math.random()}`, fetch: f as typeof fetch });
}

const ROTA_AUTH = { [`POST ${API}/auth`]: () => new Response(JSON.stringify({ token: "jwt-1" })) };

// ------------------------------------------------ envio que nao existe mais --

test("Cancelar envio de pedido que sumiu da plataforma (404 no void e na consulta) destrava o contrato", async () => {
  const logs = capturarLogs();
  const banco = envioAberto();
  const api = iloveApiCom({
    ...ROTA_AUTH,
    [`PUT ${API}/signature/void/tr-abc`]: naoEncontrado,
    [`GET ${API}/signature/requesterview/tr-abc`]: naoEncontrado,
  });

  const resposta = await cancelarEnvio(ID, banco.linha, ioCom(banco, api));
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.registro.status, "pdf_gerado");
  assert.equal(corpo.registro.assinatura_status, "cancelado");
  assert.equal(corpo.pedidoInexistente, true);
  assert.match(corpo.aviso, /não existia mais na plataforma/);
  assert.equal(banco.linha.status, "pdf_gerado");

  // O motivo vai para o log, sem PII: so o id do lead e o que aconteceu.
  assert.ok(logs.some((l) => l.includes(ID) && l.includes("não existe mais na plataforma (404)")));
  assert.ok(!logs.some((l) => /@|tr-abc/.test(l)), "log sem e-mail nem token");
  mock.restoreAll();
});

test("Cancelar envio com o token ilegível também destrava, e manda conferir o painel da plataforma", async () => {
  capturarLogs();
  const banco = envioAberto("registro-corrompido");
  // Sem rota nenhuma: o token ilegivel e recusado antes de qualquer chamada.
  const resposta = await cancelarEnvio(ID, banco.linha, ioCom(banco, iloveApiCom({})));

  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.registro.status, "pdf_gerado");
  assert.equal(corpo.registro.assinatura_status, "cancelado");
  assert.match(corpo.aviso, /confira no painel da plataforma de assinatura/);
  mock.restoreAll();
});

test("o encerramento só no sistema tem o guard de sempre: outro envio no meio não é destravado", async () => {
  capturarLogs();
  const banco = envioAberto();
  const lido = banco.linha;
  const provedor = provedorFalso({
    cancelar: async () => {
      // Outra aba cancelou e enviou de novo enquanto esta falava com a plataforma.
      banco.deFora({ assinatura_token: montarToken(SERVER, "tr-novo") });
      throw new AssinaturaError("Não encontrado.", { codigo: "inexistente", etapa: "void", status: 404 });
    },
  });

  const resposta = await cancelarEnvio(ID, lido, ioCom(banco, provedor));
  const corpo = await resposta.json();
  // Devolve o registro como esta (o envio novo), sem destravar.
  assert.equal(corpo.registro.status, "enviado");
  assert.equal(banco.linha.status, "enviado");
  assert.equal(banco.linha.assinatura_token, montarToken(SERVER, "tr-novo"));
  mock.restoreAll();
});

test("plataforma fora do ar ou token de outro provedor NÃO destravam o contrato", async () => {
  capturarLogs();
  for (const [erro, status] of [
    [new AssinaturaError("Instável.", { codigo: "http", etapa: "void", status: 503 }), 502],
    [new AssinaturaError("404 sem confirmação.", { codigo: "http", etapa: "void", status: 404 }), 502],
    [new AssinaturaError("Envio de verdade no dry run.", { codigo: "token_invalido", etapa: "void" }), 409],
  ] as const) {
    const banco = envioAberto();
    const provedor = provedorFalso({
      cancelar: async () => {
        throw erro;
      },
    });
    await assert.rejects(cancelarEnvio(ID, banco.linha, ioCom(banco, provedor)), recusa(status, erro.message));
    assert.equal(banco.linha.status, "enviado", erro.codigo);
  }
  mock.restoreAll();
});

test("“Atualizar status” de pedido que sumiu devolve o recado com a saída pelo “Cancelar envio”", async () => {
  const logs = capturarLogs();
  const banco = envioAberto();
  const api = iloveApiCom({ ...ROTA_AUTH, [`GET ${API}/signature/requesterview/tr-abc`]: naoEncontrado });

  await assert.rejects(sincronizar(ID, banco.linha, ioCom(banco, api)), (e) => {
    recusa(409, MENSAGEM_PEDIDO_SUMIU)(e);
    assert.equal((e as Recusa).extra.pedidoInexistente, true);
    return true;
  });
  assert.match(MENSAGEM_PEDIDO_SUMIU, /Use “Cancelar envio” para destravar o contrato/);
  // A consulta nao destrava sozinha: quem encerra o envio e a Mel.
  assert.equal(banco.linha.status, "enviado");
  assert.ok(logs.some((l) => l.includes(ID) && l.includes("404")));
  mock.restoreAll();
});

test("“Atualizar status” com o token ilegível também aponta o “Cancelar envio”", async () => {
  capturarLogs();
  const banco = envioAberto("registro-corrompido");
  await assert.rejects(sincronizar(ID, banco.linha, ioCom(banco, iloveApiCom({}))), (e) => {
    recusa(409, /Use “Cancelar envio” para destravar o contrato/)(e);
    assert.equal((e as Recusa).extra.pedidoInexistente, true);
    return true;
  });
  mock.restoreAll();
});

// ------------------------------------------------------------------ envio --

const LEAD: LeadDoContrato = { id: ID, categoria: "corporativo", respostas: {}, nome_display: "Alfa Eventos" };

/** Contrato corporativo com CONTRATANTE PJ, texto montado e PDF no bucket. */
function contratoPjComPdf() {
  const pacote = pacoteDoCatalogo("corporativo", "Pacote Pocket");
  assert.ok(pacote);
  const dados = dadosContratoSchema.parse({
    contratante: {
      tipo: "pj",
      pj: {
        razaoSocial: "Alfa Eventos Fictícios Ltda.",
        cnpj: "11222333000181",
        endereco: {
          logradouro: "Alameda Fictícia",
          numero: "200",
          bairro: "Centro",
          cidade: "Campinas",
          uf: "SP",
          cep: "13024000",
        },
        representante: {
          nome: "Roberto Alves Exemplo",
          genero: "masculino",
          cpf: "31415926590",
          cargo: "sócio-administrador",
          email: "roberto@alfa.example.com",
        },
      },
    },
    evento: {
      data: "2027-03-20",
      horarioInicio: "19:30",
      homenageado: "Alfa Eventos",
      tipoEvento: "Lançamento de coleção",
      locais: [{ rotulo: "Local do evento", endereco: "Espaço Fictício, Rua Um, 10, Centro, Campinas/SP" }],
      alimentacao: true,
    },
    servico: {
      tabela: "2027",
      pacote: pacote.nome,
      valorPacote: precoPacote("corporativo", "2027", pacote.nome) ?? 120000,
      escopo: pacote.escopo,
    },
    pagamento: pagamentoDoPreset("30/70"),
  });
  const { documento } = montarContrato(dados, contextoDeMontagem(LEAD));
  const pdf = pdfDe(documento);
  const pdf_path = `${ID}/contrato.pdf`;
  const banco = bancoFalso({
    status: "pdf_gerado",
    dados,
    documento,
    pdf_path,
    pdf_sha256: sha256Hex(pdf.bytes),
    posicoes_assinatura: documento.assinaturas.map((a, i) => ({
      papel: a.papel,
      pagina: 5,
      x: 64 + i * 260,
      yTopo: 600,
      largura: 200,
      altura: 40,
    })),
  });
  banco.arquivos.set(pdf_path, pdf.bytes);
  return banco;
}

function provedorQueEnvia(pedidos: PedidoAssinatura[]): ProvedorAssinatura {
  return provedorFalso({
    nome: "dry-run",
    enviar: async (p) => {
      pedidos.push(p);
      return {
        token: "dry-00000000-0000-4000-8000-000000000002",
        status: "enviado",
        signatarios: p.signatarios.map((s) => ({ ...s, status: "pendente" as const, assinadoEm: null })),
      };
    },
  });
}

for (const marcaAnterior of ["iLovePDF", "iLoveAPI"]) {
  test(`Assinafy recusa contrato que declara ${marcaAnterior} antes da reserva e de acessar o PDF`, async () => {
    const banco = contratoPjComPdf();
    const documento = banco.linha.documento!;
    const clausula = documento.clausulas.find((c) => c.id === "assinatura_eletronica")!;
    clausula.paragrafos = clausula.paragrafos.map((p) =>
      p.replace("pela plataforma identificada no respectivo registro de assinaturas", `pela plataforma ${marcaAnterior}`),
    );
    assert.ok(clausula.paragrafos.some((p) => p.includes(marcaAnterior)), "fixture representa o texto antigo");
    const pdf = pdfDe(documento);
    const caminho = banco.linha.pdf_path!;
    banco.arquivos.set(caminho, pdf.bytes);
    banco.deFora({ documento, pdf_sha256: sha256Hex(pdf.bytes) });
    const antes = banco.linha;
    const enviar = mock.fn(provedorQueEnvia([]).enviar);
    const salvar = mock.fn(banco.io.salvar);
    const baixarPdf = mock.fn(banco.io.baixarPdf);
    const io = {
      ...ioCom(banco, provedorFalso({ nome: "assinafy", enviar })),
      salvar,
      baixarPdf,
    };

    await assert.rejects(
      enviarParaAssinatura(ID, LEAD, antes, io),
      recusa(409, /Edite essa cláusula e gere o PDF de novo antes de enviar pelo Assinafy/),
    );
    assert.equal(salvar.mock.callCount(), 0, "nem a reserva foi gravada");
    assert.equal(baixarPdf.mock.callCount(), 0, "nenhum arquivo foi acessado");
    assert.equal(enviar.mock.callCount(), 0, "nada foi enviado à plataforma");
    assert.deepEqual(banco.linha, antes, "o documento antigo permanece intacto");
    assert.deepEqual(banco.arquivos.get(caminho), pdf.bytes, "o PDF antigo permanece intacto");
  });
}

test("contratante PJ vai à plataforma com o nome do representante; a razão social fica no PDF", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  const pedidos: PedidoAssinatura[] = [];

  const resposta = await enviarParaAssinatura(ID, LEAD, banco.linha, ioCom(banco, provedorQueEnvia(pedidos)));
  assert.equal(resposta.status, 200);
  assert.equal(pedidos.length, 1);

  const contratante = pedidos[0].signatarios.find((s) => s.papel === "contratante");
  assert.equal(contratante?.nome, "Roberto Alves Exemplo");
  assert.equal(contratante?.email, "roberto@alfa.example.com");
  assert.ok(!pedidos[0].signatarios.some((s) => /Ltda/.test(s.nome)));
  // No bloco impresso a parte continua sendo a empresa.
  assert.equal(banco.linha.documento?.assinaturas[0].nome, "Alfa Eventos Fictícios Ltda.");
  assert.equal(banco.linha.status, "enviado");
  mock.restoreAll();
});

test("envio usa o PDF do texto manual mesmo quando valor e data dos dados mudaram", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  const documento = banco.linha.documento!;
  const dados = banco.linha.dados;
  documento.clausulas[0] = {
    ...documento.clausulas[0],
    origem: "editada",
    paragrafos: ["Texto fictício conferido e editado manualmente pela Mel."],
  };
  dados.servico.valorPacote += 50000;
  dados.evento.data = "2027-06-01";
  const pdf = pdfDe(documento);
  banco.arquivos.set(banco.linha.pdf_path!, pdf.bytes);
  banco.deFora({ dados, documento, pdf_sha256: sha256Hex(pdf.bytes) });
  const pedidos: PedidoAssinatura[] = [];

  const resposta = await enviarParaAssinatura(ID, LEAD, banco.linha, ioCom(banco, provedorQueEnvia(pedidos)));

  assert.equal(resposta.status, 200);
  assert.equal(pedidos.length, 1);
  assert.deepEqual(pedidos[0].pdf, pdf.bytes, "a plataforma falsa recebe o PDF do texto que a Mel conferiu");
  assert.deepEqual(banco.linha.documento, documento, "nenhuma clausula foi remontada pelos dados");
  assert.equal(pedidos[0].signatarios[0].nome, "Roberto Alves Exemplo");
  assert.equal(pedidos[0].signatarios[0].email, "roberto@alfa.example.com");
  assert.equal(banco.linha.status, "enviado");
  mock.restoreAll();
});

test("escrita de outra aba entre a leitura e a reserva: o contrato não é enviado", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  const lido = banco.linha;
  // Outra aba grava qualquer coisa (aqui, os avisos) depois da leitura.
  banco.deFora({ avisos: [{ origem: "sistema", gravidade: "atencao", texto: "Aviso fictício." }] });
  const pedidos: PedidoAssinatura[] = [];

  await assert.rejects(
    enviarParaAssinatura(ID, LEAD, lido, ioCom(banco, provedorQueEnvia(pedidos))),
    recusa(409, "O contrato mudou ou já está sendo enviado. Atualize a página."),
  );
  assert.equal(pedidos.length, 0, "nada saiu para a plataforma");
  assert.equal(banco.linha.status, "pdf_gerado");
  mock.restoreAll();
});

// --------------------------------------------------- envio de resultado incerto --

const TOKEN_INCERTO = "assinafy-documento-ficticio-opaco";

function resultadoIncerto(p: PedidoAssinatura): ResultadoEnvio {
  return {
    token: TOKEN_INCERTO,
    status: "enviado",
    signatarios: p.signatarios.map((s) => ({ ...s, status: "pendente" as const, assinadoEm: null })),
  };
}

for (const [codigo, statusEsperado] of [
  ["timeout", 504],
  ["rede", 502],
  ["resposta_invalida", 502],
  ["http", 502],
] as const) {
  test(`envio incerto (${codigo}) guarda token e signatários, mantém a reserva e impede novo clique`, async () => {
    const logs = capturarLogs();
    const banco = contratoPjComPdf();
    const causa = new AssinaturaError("Erro bruto: cliente-privado@example.com, CPF 123.456.789-09", {
      codigo,
      etapa: "assignment",
      status: codigo === "http" ? 503 : null,
    });
    let chamadas = 0;
    const cancelados: string[] = [];
    const provedor = provedorFalso({
      nome: "assinafy",
      enviar: async (p) => {
        await p.antesDeNotificar?.(resultadoIncerto(p));
        assert.equal(banco.linha.assinatura_token, TOKEN_INCERTO, "token persistido antes de poder notificar");
        assert.equal(banco.linha.assinatura_enviada_em, null, "preparação não afirma envio confirmado");
        chamadas++;
        throw new EnvioAssinaturaIncertoError(resultadoIncerto(p), causa);
      },
      cancelar: async (token) => { cancelados.push(token); },
    });
    const io = ioCom(banco, provedor);
    const escritas: Array<Parameters<IoAssinatura["salvar"]>> = [];
    io.salvar = async (...args) => {
      escritas.push(args);
      return banco.io.salvar(...args);
    };

    await assert.rejects(enviarParaAssinatura(ID, LEAD, banco.linha, io), (e) => {
      recusa(statusEsperado, /Não consegui confirmar se os convites/)(e);
      assert.match((e as Recusa).message, /“Atualizar status”.*“Cancelar envio”/);
      const registro = (e as Recusa).extra.registro;
      assert.equal(typeof registro, "object");
      assert.ok(registro && typeof registro === "object" && !("assinatura_token" in registro), "token não sai na resposta pública");
      assert.doesNotMatch((e as Recusa).message, /cliente-privado|123\.456|assinafy-documento/);
      return true;
    });

    assert.equal(banco.linha.status, "enviado");
    assert.equal(banco.linha.assinatura_provedor, "assinafy");
    assert.equal(banco.linha.assinatura_token, TOKEN_INCERTO);
    assert.equal(banco.linha.assinatura_status, "enviado");
    assert.equal(banco.linha.assinatura_signatarios?.length, 2);
    assert.equal(banco.linha.assinatura_signatarios?.[0].email, "roberto@alfa.example.com");
    assert.equal(banco.linha.assinatura_enviada_em, null, "resultado incerto ainda não confirma a data de envio");
    assert.equal(escritas.length, 3, "reserva, preparação e persistência; nenhuma escrita desfaz o envio");
    assert.deepEqual(escritas[1][2], { status: ["enviado"], token: null });
    assert.deepEqual(escritas[2][2], { status: ["enviado"], token: TOKEN_INCERTO });
    assert.deepEqual(cancelados, [], "pedido recuperável não é cancelado automaticamente");

    await assert.rejects(enviarParaAssinatura(ID, LEAD, banco.linha, io), recusa(409, /já está aguardando/));
    assert.equal(chamadas, 1, "novo clique não repete os convites");
    assert.ok(logs.some((linha) => linha.includes(`assinatura ${codigo === "http" ? "resposta_invalida" : codigo}`)));
    assert.ok(!logs.some((linha) => /@|123\.456|assinafy-documento|Roberto/.test(linha)), "logs não contêm causa, token ou signatários");
    mock.restoreAll();
  });
}

test("erro seguro anterior ao envio desfaz a reserva e permite uma nova tentativa", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  const rejeitado = provedorFalso({
    nome: "assinafy",
    enviar: async () => {
      throw new AssinaturaError("Confira os dados antes de enviar.", { codigo: "pedido_invalido", etapa: "upload" });
    },
  });

  await assert.rejects(
    enviarParaAssinatura(ID, LEAD, banco.linha, ioCom(banco, rejeitado)),
    recusa(422, "Confira os dados antes de enviar."),
  );
  assert.equal(banco.linha.status, "pdf_gerado");
  assert.equal(banco.linha.assinatura_token, null);
  assert.equal(banco.linha.assinatura_enviada_em, null);

  const pedidos: PedidoAssinatura[] = [];
  const resposta = await enviarParaAssinatura(ID, LEAD, banco.linha, ioCom(banco, provedorQueEnvia(pedidos)));
  assert.equal(resposta.status, 200);
  assert.equal(pedidos.length, 1);
  mock.restoreAll();
});

test("o guard impede gravar token incerto se outra aba cancelar durante o envio; o pedido órfão é cancelado", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  const cancelados: string[] = [];
  const provedor = provedorFalso({
    nome: "assinafy",
    enviar: async (p) => {
      await p.antesDeNotificar?.(resultadoIncerto(p));
      banco.deFora({ status: "pdf_gerado", assinatura_status: "cancelado", assinatura_token: null });
      throw new EnvioAssinaturaIncertoError(resultadoIncerto(p));
    },
    cancelar: async (token) => { cancelados.push(token); },
  });

  await assert.rejects(
    enviarParaAssinatura(ID, LEAD, banco.linha, ioCom(banco, provedor)),
    recusa(409, /contrato mudou enquanto era enviado/),
  );
  assert.deepEqual(cancelados, [TOKEN_INCERTO]);
  assert.equal(banco.linha.status, "pdf_gerado");
  assert.equal(banco.linha.assinatura_status, "cancelado");
  assert.equal(banco.linha.assinatura_token, null, "a escrita incerta não sobrescreve o cancelamento");
  mock.restoreAll();
});

for (const falhaCancelamento of [false, true]) {
  test(`falha ao guardar envio incerto tenta cancelar o pedido órfão (${falhaCancelamento ? "cancelamento falha" : "cancelamento confirmado"})`, async () => {
    const logs = capturarLogs();
    const banco = contratoPjComPdf();
    const cancelados: string[] = [];
    const provedor = provedorFalso({
      nome: "assinafy",
      enviar: async (p) => { throw new EnvioAssinaturaIncertoError(resultadoIncerto(p)); },
      cancelar: async (token) => {
        cancelados.push(token);
        if (falhaCancelamento) throw new Error("corpo privado cliente-privado@example.com");
      },
    });
    const io = ioCom(banco, provedor);
    io.salvar = async (id, patch, condicao) => {
      if (patch.assinatura_token) throw new Error("falha de banco com cliente-privado@example.com");
      return banco.io.salvar(id, patch, condicao);
    };

    await assert.rejects(
      enviarParaAssinatura(ID, LEAD, banco.linha, io),
      recusa(falhaCancelamento ? 500 : 409, falhaCancelamento ? /painel da plataforma de assinatura/ : /cancelei o envio/),
    );
    assert.deepEqual(cancelados, [TOKEN_INCERTO]);
    assert.equal(banco.linha.status, "enviado", "a falha não destrava um envio possivelmente notificado");
    assert.equal(banco.linha.assinatura_token, null);
    assert.ok(!logs.some((linha) => /@|assinafy-documento/.test(linha)), "nem erros de banco/cancelamento expõem corpo ou token");
    mock.restoreAll();
  });
}

test("enquanto o provedor confirma o envio, o token já está guardado e o segundo clique é recusado", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  let pronto!: () => void;
  const preparado = new Promise<void>((resolve) => { pronto = resolve; });
  let concluir!: () => void;
  const confirmacao = new Promise<void>((resolve) => { concluir = resolve; });
  let notificacoes = 0;
  const provedor = provedorFalso({
    nome: "assinafy",
    enviar: async (p) => {
      const resultado = resultadoIncerto(p);
      await p.antesDeNotificar?.(resultado);
      pronto();
      await confirmacao;
      notificacoes++;
      return resultado;
    },
  });
  const io = ioCom(banco, provedor);
  const enviando = enviarParaAssinatura(ID, LEAD, banco.linha, io);
  await preparado;

  assert.equal(banco.linha.status, "enviado");
  assert.equal(banco.linha.assinatura_token, TOKEN_INCERTO);
  assert.equal(banco.linha.assinatura_enviada_em, null);
  await assert.rejects(enviarParaAssinatura(ID, LEAD, banco.linha, io), recusa(409, /já está aguardando/));
  assert.equal(notificacoes, 0);

  concluir();
  const resposta = await enviando;
  assert.equal(resposta.status, 200);
  assert.equal(banco.linha.assinatura_token, TOKEN_INCERTO);
  assert.ok(banco.linha.assinatura_enviada_em);
  assert.equal(notificacoes, 1);
  mock.restoreAll();
});

test("falha ao guardar token antes da notificação interrompe o envio e desfaz a reserva segura", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  let notificacoes = 0;
  const provedor = provedorFalso({
    nome: "assinafy",
    enviar: async (p) => {
      const resultado = resultadoIncerto(p);
      await p.antesDeNotificar?.(resultado);
      notificacoes++;
      return resultado;
    },
  });
  const io = ioCom(banco, provedor);
  io.salvar = async (id, patch, condicao) => {
    if (patch.assinatura_token) throw new Error("Banco indisponível.");
    return banco.io.salvar(id, patch, condicao);
  };

  await assert.rejects(enviarParaAssinatura(ID, LEAD, banco.linha, io), /Banco indisponível/);
  assert.equal(notificacoes, 0);
  assert.equal(banco.linha.status, "pdf_gerado");
  assert.equal(banco.linha.assinatura_token, null);
  mock.restoreAll();
});

test("cancelamento de outra aba antes do hook impede a notificação sem sobrescrever o estado", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  let notificacoes = 0;
  const provedor = provedorFalso({
    nome: "assinafy",
    enviar: async (p) => {
      banco.deFora({ status: "pdf_gerado", assinatura_status: "cancelado" });
      const resultado = resultadoIncerto(p);
      await p.antesDeNotificar?.(resultado);
      notificacoes++;
      return resultado;
    },
  });

  await assert.rejects(enviarParaAssinatura(ID, LEAD, banco.linha, ioCom(banco, provedor)), recusa(409, /mudou antes do envio/));
  assert.equal(notificacoes, 0);
  assert.equal(banco.linha.status, "pdf_gerado");
  assert.equal(banco.linha.assinatura_status, "cancelado");
  assert.equal(banco.linha.assinatura_token, null);
  mock.restoreAll();
});

test("rejeição segura da notificação desfaz apenas a reserva com o token preparado", async () => {
  capturarLogs();
  const banco = contratoPjComPdf();
  const provedor = provedorFalso({
    nome: "assinafy",
    enviar: async (p) => {
      await p.antesDeNotificar?.(resultadoIncerto(p));
      throw new AssinaturaError("A plataforma recusou os convites.", { codigo: "pedido_invalido", etapa: "assignment", status: 422 });
    },
  });
  const io = ioCom(banco, provedor);
  let guardaRollback: Parameters<IoAssinatura["salvar"]>[2];
  io.salvar = async (id, patch, condicao) => {
    if (patch.status === "pdf_gerado") guardaRollback = condicao;
    return banco.io.salvar(id, patch, condicao);
  };

  await assert.rejects(enviarParaAssinatura(ID, LEAD, banco.linha, io), recusa(422, /recusou os convites/));
  assert.deepEqual(guardaRollback, { status: ["enviado"], token: TOKEN_INCERTO });
  assert.equal(banco.linha.status, "pdf_gerado");
  assert.equal(banco.linha.assinatura_token, null);
  mock.restoreAll();
});

for (const status of ["enviado", "concluido"] as const) {
  test(`consulta válida confirma data de envio pendente quando o pedido está ${status}`, async () => {
    capturarLogs();
    const banco = envioAberto(TOKEN_INCERTO);
    banco.deFora({ assinatura_provedor: "assinafy", assinatura_enviada_em: null });
    const provedor = provedorFalso({
      nome: "assinafy",
      consultar: async () => ({ status, signatarios: [], concluidoEm: status === "concluido" ? "2026-10-20T20:00:00.000Z" : null }),
      baixarAssinado: async () => new TextEncoder().encode("%PDF-1.7 contrato fictício assinado"),
      baixarTrilha: async () => new TextEncoder().encode("%PDF-1.7 certificado fictício"),
    });

    const registro = await sincronizar(ID, banco.linha, ioCom(banco, provedor));
    assert.ok(registro?.assinatura_enviada_em, "a consulta confirma o envio que antes era incerto");
    assert.equal(banco.linha.assinatura_enviada_em, registro?.assinatura_enviada_em);
    assert.equal(banco.linha.assinatura_enviada_em, banco.linha.assinatura_atualizada_em);
    assert.equal(banco.linha.status, status === "concluido" ? "assinado" : "enviado");
    mock.restoreAll();
  });
}

for (const status of ["cancelado", "recusado", "expirado"] as const) {
  test(`consulta ${status} não transforma preparação em envio confirmado`, async () => {
    capturarLogs();
    const banco = envioAberto(TOKEN_INCERTO);
    const provedor = provedorFalso({
      nome: "assinafy",
      consultar: async () => ({ status, signatarios: [], concluidoEm: null }),
    });

    await sincronizar(ID, banco.linha, ioCom(banco, provedor));
    assert.equal(banco.linha.assinatura_enviada_em, null);
    assert.equal(banco.linha.status, "pdf_gerado");
    mock.restoreAll();
  });
}

test("consulta preserva a data de um envio já confirmado", async () => {
  capturarLogs();
  const banco = envioAberto(TOKEN_INCERTO);
  const enviadaEm = "2026-10-19T13:00:00.000Z";
  banco.deFora({ assinatura_enviada_em: enviadaEm });
  await sincronizar(ID, banco.linha, ioCom(banco, provedorFalso({ nome: "assinafy" })));
  assert.equal(banco.linha.assinatura_enviada_em, enviadaEm);
  mock.restoreAll();
});

test("consulta sem confirmação dos convites mantém a data de envio pendente", async () => {
  capturarLogs();
  const banco = envioAberto(TOKEN_INCERTO);
  const provedor = provedorFalso({
    nome: "assinafy",
    consultar: async () => { throw new AssinaturaError("A plataforma ainda não confirmou os convites.", { codigo: "resposta_invalida", etapa: "assignment" }); },
  });
  await assert.rejects(sincronizar(ID, banco.linha, ioCom(banco, provedor)), recusa(502, /não confirmou os convites/));
  assert.equal(banco.linha.status, "enviado");
  assert.equal(banco.linha.assinatura_enviada_em, null);
  mock.restoreAll();
});
