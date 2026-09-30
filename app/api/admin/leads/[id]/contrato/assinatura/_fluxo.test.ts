import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  AssinaturaError,
  type PedidoAssinatura,
  type ProvedorAssinatura,
  type ResultadoConsulta,
} from "@/lib/assinatura/adapter";
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

test("Cancelar envio com o token ilegível também destrava, e manda conferir o painel da iLoveAPI", async () => {
  capturarLogs();
  const banco = envioAberto("registro-corrompido");
  // Sem rota nenhuma: o token ilegivel e recusado antes de qualquer chamada.
  const resposta = await cancelarEnvio(ID, banco.linha, ioCom(banco, iloveApiCom({})));

  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.registro.status, "pdf_gerado");
  assert.equal(corpo.registro.assinatura_status, "cancelado");
  assert.match(corpo.aviso, /confira no painel da iLoveAPI/);
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
