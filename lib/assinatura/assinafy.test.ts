import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  AssinaturaError,
  ASSUNTO_ASSINATURA,
  MENSAGEM_ASSINATURA,
  type PedidoAssinatura,
  type ResultadoEnvio,
} from "./adapter";
import { Assinafy, lerTokenAssinafy, montarTokenAssinafy } from "./assinafy";
import { EnvioAssinaturaIncertoError } from "./envio-incerto";

// Fetch sempre injetado; contas, nomes, chave e e-mails sao ficticios. Os
// arquivos sao PDFs validos gerados em memoria, sem dados ou efeitos externos.
const CONTA = "conta-ficticia";
const DOCUMENTO = "documento-ficticio";
const BASE = "https://sandbox.assinafy.com.br/v1";
const AGORA = Date.parse("2026-10-20T12:00:00Z");
const TOKEN = montarTokenAssinafy({ ambiente: "sandbox", accountId: CONTA, documentId: DOCUMENTO });
const PESSOAS = [
  { id: "pessoa-1", full_name: "Joana Exemplo", email: "joana@example.com" },
  { id: "pessoa-2", full_name: "Mel Fictícia", email: "mel@example.org" },
];
const CONHECIDOS = [
  { papel: "contratante" as const, nome: PESSOAS[0].full_name, email: PESSOAS[0].email },
  { papel: "contratada" as const, nome: PESSOAS[1].full_name, email: PESSOAS[1].email },
];

async function pdf(titulo: string) {
  const d = await PDFDocument.create();
  d.setTitle(titulo);
  d.addPage();
  return d.save();
}
const ARQUIVOS = Promise.all([pdf("Contrato ficticio"), pdf("Contrato certificado ficticio"), pdf("Trilha ficticia")]);

async function pedido(extra: Partial<PedidoAssinatura> = {}): Promise<PedidoAssinatura> {
  return {
    pdf: (await ARQUIVOS)[0], nomeArquivo: "Contrato - Exemplo.pdf",
    signatarios: CONHECIDOS,
    posicoes: CONHECIDOS.map((s, i) => ({ papel: s.papel, pagina: 1, x: 60 + i * 240, yTopo: 600, largura: 200, altura: 40 })),
    assunto: ASSUNTO_ASSINATURA, mensagem: MENSAGEM_ASSINATURA, diasValidade: 30,
    antesDeNotificar: async () => {},
    ...extra,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ status, data }), { status, headers: { "Content-Type": "application/json" } });
}

function documento(extra: Record<string, unknown> = {}) {
  return { id: DOCUMENTO, account_id: CONTA, status: "metadata_ready", assignment: null, ...extra };
}
function assignment(extra: Record<string, unknown> = {}) {
  return { id: "assignment-ficticio", signers: PESSOAS, ...extra };
}

type Chamada = { metodo: string; url: URL; init: RequestInit };
type Rota = (c: Chamada) => Response | Promise<Response>;
type Rotas = Record<string, Rota>;
function fake(rotas: Rotas = {}) {
  const catalogo = [
    { code: "metadata_ready", deletable: true },
    { code: "pending_signature", deletable: true },
    { code: "pending_identity_review", deletable: true },
    { code: "failed", deletable: true },
    { code: "certificating", deletable: false },
  ];
  rotas = { "GET /v1/documents/statuses": () => json(catalogo), ...rotas };
  const chamadas: Chamada[] = [];
  const f: typeof fetch = async (entrada, init = {}) => {
    const c = { metodo: (init.method ?? "GET").toUpperCase(), url: new URL(String(entrada)), init };
    chamadas.push(c);
    const rota = rotas[`${c.metodo} ${c.url.pathname}${c.url.search}`] ?? rotas[`${c.metodo} ${c.url.pathname}`];
    assert.ok(rota, `rota nao mockada: ${c.metodo} ${c.url}`);
    return rota(c);
  };
  const api = new Assinafy({ apiKey: "chave-ficticia-nao-enviada", accountId: CONTA, ambiente: "sandbox", fetch: f, agora: () => AGORA });
  return { api, chamadas, rotas, fetch: f };
}

const ROTA_UPLOAD = `/v1/accounts/${CONTA}/documents`;
const ROTA_DOC = `/v1/documents/${DOCUMENTO}`;
const ROTA_ESTIMATIVA = `${ROTA_DOC}/assignments/estimate-cost`;
const ROTA_ASSIGNMENT = `${ROTA_DOC}/assignments`;
const ROTA_SIGNERS = `/v1/accounts/${CONTA}/signers`;
const CUSTO = { has_sufficient_resources: true, needs_extra_document: false, total_credits: 0, documents: 1 };

function envio(rotas: Rotas = {}) {
  return fake({
    [`POST ${ROTA_UPLOAD}`]: () => json(documento()),
    [`POST ${ROTA_ESTIMATIVA}`]: () => json(CUSTO),
    [`GET ${ROTA_SIGNERS}`]: (c) => json(c.url.searchParams.get("search") === PESSOAS[0].email ? [PESSOAS[0]] : []),
    [`POST ${ROTA_SIGNERS}`]: () => json(PESSOAS[1]),
    [`POST ${ROTA_ASSIGNMENT}`]: () => json(assignment()),
    [`GET ${ROTA_DOC}`]: () => json(documento()),
    [`DELETE ${ROTA_DOC}`]: () => json([]),
    ...rotas,
  });
}

function corpo(c: Chamada) {
  assert.equal(typeof c.init.body, "string");
  return JSON.parse(c.init.body as string) as Record<string, unknown>;
}
function erro(codigo: AssinaturaError["codigo"], status?: number) {
  return (e: unknown) => {
    assert.ok(e instanceof AssinaturaError);
    assert.equal(e.codigo, codigo);
    if (status !== undefined) assert.equal(e.status, status);
    return true;
  };
}
const convites = (m: ReturnType<typeof fake>) => m.chamadas.filter((c) => c.metodo === "POST" && c.url.pathname === ROTA_ASSIGNMENT);

test("envio sobe o PDF conferido, prepara pessoas, estima sem extras e persiste token antes dos convites por Email", async () => {
  let persistido: ResultadoEnvio | undefined;
  const m = envio({ [`POST ${ROTA_ASSIGNMENT}`]: () => {
    assert.ok(persistido, "identificacao persistida antes de notificar");
    return json(assignment());
  } });
  const p = await pedido({ antesDeNotificar: async (r) => {
    assert.equal(m.chamadas.at(-1)?.url.pathname, ROTA_ESTIMATIVA);
    persistido = r;
  } });
  const r = await m.api.enviar(p);
  assert.deepEqual(r, persistido);
  assert.deepEqual(lerTokenAssinafy(r.token), { ambiente: "sandbox", accountId: CONTA, documentId: DOCUMENTO });
  assert.deepEqual(m.chamadas.map((c) => `${c.metodo} ${c.url.pathname}`), [
    `POST ${ROTA_UPLOAD}`, `GET ${ROTA_SIGNERS}`, `GET ${ROTA_SIGNERS}`,
    `POST ${ROTA_SIGNERS}`, `POST ${ROTA_ESTIMATIVA}`, `POST ${ROTA_ASSIGNMENT}`,
  ]);
  const upload = m.chamadas[0];
  assert.ok(upload.init.body instanceof FormData);
  const arquivo = upload.init.body.get("file");
  assert.ok(arquivo instanceof Blob);
  assert.deepEqual(new Uint8Array(await arquivo.arrayBuffer()), p.pdf);
  assert.equal(new Headers(upload.init.headers).has("Content-Type"), false);
  const estimativas = m.chamadas.filter((c) => c.url.pathname === ROTA_ESTIMATIVA);
  assert.equal(estimativas.length, 1);
  assert.deepEqual(corpo(estimativas[0]), { method: "virtual", signers: CONHECIDOS.map(() => ({ verification_method: "Email", notification_methods: ["Email"] })) });
  const enviado = corpo(convites(m)[0]);
  assert.equal(enviado.method, "virtual");
  assert.equal(enviado.message, MENSAGEM_ASSINATURA);
  assert.equal(enviado.expires_at, "2026-11-19T12:00:00.000Z");
  assert.deepEqual(enviado.signers, PESSOAS.map((s) => ({ id: s.id, verification_method: "Email", notification_methods: ["Email"] })));
  for (const c of m.chamadas) {
    assert.equal(c.url.origin, new URL(BASE).origin);
    assert.equal(c.init.redirect, "error");
    assert.equal(c.init.cache, "no-store");
    assert.equal(new Headers(c.init.headers).get("X-Api-Key"), "chave-ficticia-nao-enviada");
  }
});

test("pedido ou hook ausente para antes de qualquer chamada", async () => {
  for (const extra of [{ antesDeNotificar: undefined }, { pdf: new Uint8Array() }]) {
    const m = envio();
    await assert.rejects(m.api.enviar(await pedido(extra)), erro("pedido_invalido"));
    assert.equal(m.chamadas.length, 0);
  }
});

test("falha no hook impede todos os convites", async () => {
  const m = envio();
  const falha = new Error("banco indisponivel");
  await assert.rejects(m.api.enviar(await pedido({ antesDeNotificar: async () => { throw falha; } })), (e) => e === falha);
  assert.equal(convites(m).length, 0);
  assert.deepEqual(m.chamadas.slice(-2).map((c) => `${c.metodo} ${c.url.pathname}`), [`GET ${ROTA_DOC}`, `DELETE ${ROTA_DOC}`]);
});

test("limpeza apos hook falhar nao exclui documento processando nem com assignment existente", async () => {
  for (const extra of [{ status: "metadata_processing" }, { assignment: assignment() }]) {
    const m = envio({ [`GET ${ROTA_DOC}`]: () => json(documento(extra)) });
    await assert.rejects(m.api.enviar(await pedido({ antesDeNotificar: async () => { throw new Error("banco indisponivel"); } })));
    assert.equal(convites(m).length, 0);
    assert.equal(m.chamadas.some((c) => c.metodo === "DELETE"), false);
  }
});

test("estimativa bloqueia limite esgotado, documento extra, creditos pagos e quantidade divergente", async () => {
  for (const extra of [{ has_sufficient_resources: false }, { needs_extra_document: true }, { total_credits: 0.45 }, { documents: 2 }]) {
    let persistencias = 0;
    const m = envio({ [`POST ${ROTA_ESTIMATIVA}`]: () => json({ ...CUSTO, ...extra }) });
    await assert.rejects(m.api.enviar(await pedido({ antesDeNotificar: async () => { persistencias++; } })), erro("sem_creditos"));
    assert.equal(convites(m).length, 0);
    assert.equal(persistencias, 0);
    assert.equal(m.chamadas.filter((c) => c.url.pathname === ROTA_ESTIMATIVA).length, 1);
  }
});

test("e-mail duplicado na criacao so e reutilizado apos busca confirmar nome e email", async () => {
  let buscasMel = 0;
  const m = envio({
    [`GET ${ROTA_SIGNERS}`]: (c) => {
      const email = c.url.searchParams.get("search");
      if (email === PESSOAS[0].email) return json([PESSOAS[0]]);
      return json(++buscasMel === 1 ? [] : [PESSOAS[1]]);
    },
    [`POST ${ROTA_SIGNERS}`]: () => json({ email: "PII privada" }, 400),
  });
  await m.api.enviar(await pedido());
  assert.equal(buscasMel, 2);
  assert.equal(convites(m).length, 1);
});

test("mesmo email com nome diferente bloqueia o envio sem alterar cadastro alheio", async () => {
  const m = envio({ [`GET ${ROTA_SIGNERS}`]: () => json([{ ...PESSOAS[0], full_name: "Outra Pessoa" }]) });
  await assert.rejects(m.api.enviar(await pedido()), erro("pedido_invalido"));
  assert.equal(convites(m).length, 0);
  assert.equal(m.chamadas.some((c) => c.metodo === "PUT"), false);
});

test("busca paginada exige email exato e pode reutilizar nome com acentuacao ou espacos equivalentes", async () => {
  const falsos = Array.from({ length: 50 }, (_, i) => ({ id: `outro-${i}`, full_name: "Outra Pessoa", email: `outro-${i}@example.net` }));
  const paginas: string[] = [];
  const m = envio({ [`GET ${ROTA_SIGNERS}`]: (c) => {
    const busca = c.url.searchParams.get("search");
    const pagina = c.url.searchParams.get("page") ?? "";
    paginas.push(`${busca}:${pagina}`);
    if (busca === PESSOAS[0].email) return json(pagina === "1" ? falsos : [{ ...PESSOAS[0], full_name: "  JÓANA   EXEMPLO " }]);
    return json([PESSOAS[1]]);
  } });
  await m.api.enviar(await pedido());
  assert.deepEqual(paginas, ["joana@example.com:1", "joana@example.com:2", "mel@example.org:1"]);
  assert.equal(m.chamadas.some((c) => c.metodo === "POST" && c.url.pathname === ROTA_SIGNERS), false);
  assert.equal(convites(m).length, 1);
});

test("duplicado nao confirmado e busca acima de dez paginas impedem qualquer convite", async () => {
  const duplicado = envio({
    [`GET ${ROTA_SIGNERS}`]: () => json([]),
    [`POST ${ROTA_SIGNERS}`]: () => json({ email: "privado@example.com" }, 409),
  });
  await assert.rejects(duplicado.api.enviar(await pedido()), erro("http", 409));
  assert.equal(convites(duplicado).length, 0);
  const falsos = Array.from({ length: 50 }, (_, i) => ({ id: `outro-${i}`, full_name: "Outro Nome", email: `outro-${i}@example.net` }));
  const paginado = envio({ [`GET ${ROTA_SIGNERS}`]: () => json(falsos) });
  await assert.rejects(paginado.api.enviar(await pedido()), erro("resposta_invalida"));
  assert.equal(paginado.chamadas.filter((c) => c.url.pathname === ROTA_SIGNERS).length, 10);
  assert.equal(convites(paginado).length, 0);
});

test("upload ou estimativa malformados nao passam ate o envio nem expoem PII", async () => {
  for (const rota of [ROTA_UPLOAD, ROTA_ESTIMATIVA]) {
    const m = envio({ [`POST ${rota}`]: () => json({ nome: "Nome Privado", email: "privado@example.com" }) });
    await assert.rejects(m.api.enviar(await pedido()), (e) => {
      erro("resposta_invalida")(e);
      assert.doesNotMatch((e as Error).message, /Nome Privado|privado@example/);
      return true;
    });
    assert.equal(convites(m).length, 0);
  }
});

test("documento de outra conta na resposta de upload e recusado antes dos convites", async () => {
  const m = envio({ [`POST ${ROTA_UPLOAD}`]: () => json(documento({ account_id: "outra-conta" })) });
  await assert.rejects(m.api.enviar(await pedido()), erro("resposta_invalida"));
  assert.equal(convites(m).length, 0);
});

test("falha indeterminada no passo final conserva token e nunca repete convites", async () => {
  const respostas: Rota[] = [
    () => { throw new DOMException("privado@example.com", "TimeoutError"); },
    () => { throw new TypeError("privado@example.com"); },
    () => json({ private: "privado@example.com" }, 500),
    () => json({ private: "privado@example.com" }, 408),
    () => json({ private: "privado@example.com" }),
    () => new Response("nao-json privado@example.com", { status: 200 }),
    () => json(assignment({ signers: [PESSOAS[0]] })),
  ];
  for (const resposta of respostas) {
    let guardado: ResultadoEnvio | undefined;
    const m = envio({ [`POST ${ROTA_ASSIGNMENT}`]: resposta });
    await assert.rejects(m.api.enviar(await pedido({ antesDeNotificar: async (r) => { guardado = r; } })), (e) => {
      assert.ok(e instanceof EnvioAssinaturaIncertoError);
      assert.deepEqual(e.resultado, guardado);
      assert.equal(e.resultado.token, TOKEN);
      assert.doesNotMatch(e.message, /privado@example/);
      return true;
    });
    assert.equal(convites(m).length, 1);
    assert.equal(m.chamadas.some((c) => c.metodo === "DELETE"), false);
  }
});

test("4xx explicito na atribuicao e recusa segura sem retry e sem corpo privado", async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    const m = envio({ [`POST ${ROTA_ASSIGNMENT}`]: () => json({ email: "privado@example.com" }, status) });
    await assert.rejects(m.api.enviar(await pedido()), (e) => {
      erro("http", status)(e);
      assert.ok(!(e instanceof EnvioAssinaturaIncertoError));
      assert.doesNotMatch((e as Error).message, /privado@example/);
      return true;
    });
    assert.equal(convites(m).length, 1);
  }
});

test("token prende conta e ambiente; IDs com URL/path e formatos ilegais nao geram rede", async () => {
  const m = fake();
  for (const t of [
    montarTokenAssinafy({ ambiente: "production", accountId: CONTA, documentId: DOCUMENTO }),
    montarTokenAssinafy({ ambiente: "sandbox", accountId: "outra-conta", documentId: DOCUMENTO }),
  ]) await assert.rejects(m.api.consultar(t), erro("token_invalido"));
  for (const token of ["dry-123", "assinafy-v1|!!", "assinafy-v1|" + "a".repeat(1025),
    "assinafy-v1|" + Buffer.from(JSON.stringify({ ambiente: "sandbox", accountId: CONTA, documentId: "https://evil.example/documento" })).toString("base64url"),
    "assinafy-v1|" + Buffer.from(JSON.stringify({ ambiente: "https://evil.example", accountId: CONTA, documentId: DOCUMENTO })).toString("base64url"),
  ]) await assert.rejects(m.api.consultar(token), erro("token_ilegivel"));
  assert.equal(m.chamadas.length, 0);
});

test("consulta parcial conserva papeis; certificating continua enviado e so certificated conclui", async () => {
  for (const status of ["pending_signature", "certificating", "certificated"]) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status,
      assignment: assignment({ summary: { signers: [{ id: PESSOAS[0].id, completed: true }] } }),
      updated_at: "2026-10-21T15:00:00Z",
    })), [`GET ${ROTA_DOC}/activities`]: () => json([
      { event: "document_ready", created_at: "2026-10-20T13:00:00Z" },
      { event: "document_renamed", created_at: "2026-10-21T15:00:00Z" },
    ]) });
    const r = await m.api.consultar(TOKEN, CONHECIDOS);
    assert.equal(r.status, status === "certificated" ? "concluido" : "enviado");
    assert.equal(r.signatarios[0].papel, "contratante");
    assert.equal(r.signatarios[0].status, "assinou");
    assert.equal(r.signatarios[1].status, status === "certificated" ? "assinou" : "pendente");
    assert.equal(r.concluidoEm, status === "certificated" ? "2026-10-20T13:00:00.000Z" : null);
    assert.equal(m.chamadas.filter((c) => c.url.pathname.endsWith("/activities")).length, status === "certificated" ? 1 : 0);
  }
});

test("certificacao sem atividade document_ready com data valida bloqueia conclusao", async () => {
  for (const atividades of [[], [{ event: "document_renamed", created_at: "2026-10-20T13:00:00Z" }],
    [{ event: "document_ready", created_at: "data invalida" }],
    [{ event: "document_ready", created_at: null }],
  ]) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificated", assignment: assignment(), updated_at: "2026-10-21T15:00:00Z" })),
      [`GET ${ROTA_DOC}/activities`]: () => json(atividades),
    });
    await assert.rejects(m.api.consultar(TOKEN, CONHECIDOS), erro("resposta_invalida"));
    assert.equal(m.chamadas.every((c) => c.metodo === "GET"), true);
  }
});

test("data da certificacao usa document_ready e ignora payload e origin adicionais das atividades", async () => {
  const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificated", assignment: assignment(), updated_at: "2026-11-01T15:00:00Z" })),
    [`GET ${ROTA_DOC}/activities`]: () => json([
      { event: "document_ready", created_at: "2026-10-20T10:00:00Z", payload: { email: "privado@example.net" }, origin: "https://evil.example/privado" },
      { event: "document_ready", created_at: "2026-10-20T13:00:00Z", payload: "texto arbitrario", origin: { ip: "192.0.2.1" } },
      { event: "document_renamed", created_at: "2026-11-01T15:00:00Z", payload: null, origin: null },
    ]),
  });
  const r = await m.api.consultar(TOKEN, CONHECIDOS);
  assert.equal(r.status, "concluido");
  assert.equal(r.concluidoEm, "2026-10-20T13:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(r), /privado@example|evil\.example|192\.0\.2\.1|payload|origin/);
  assert.equal(m.chamadas.every((c) => c.url.origin === new URL(BASE).origin), true);
});

test("consulta mapeia recusado, cancelado e expirado sem concluir", async () => {
  const pares = [["rejected_by_signer", "recusado"], ["rejected_by_user", "cancelado"], ["expired", "expirado"]] as const;
  for (const [status, normalizado] of pares) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status, assignment: assignment(), declined_by: { id: PESSOAS[0].id } })) });
    const r = await m.api.consultar(TOKEN, CONHECIDOS);
    assert.equal(r.status, normalizado);
    assert.equal(r.concluidoEm, null);
    if (status === "rejected_by_signer") assert.equal(r.signatarios[0].status, "recusou");
  }
});

test("consulta recusa conta divergente, status desconhecido, participantes divergentes e pedido sem assignment", async () => {
  for (const extra of [{ account_id: "outra-conta" }, { status: "desconhecido" }, { assignment: assignment({ signers: [PESSOAS[0]] }) }]) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "pending_signature", assignment: assignment(), ...extra })) });
    await assert.rejects(m.api.consultar(TOKEN, CONHECIDOS), erro("resposta_invalida"));
  }
  const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento()) });
  await assert.rejects(m.api.consultar(TOKEN, CONHECIDOS), erro("http"));
});

test("consulta 404 confirma inexistente sem expor corpo upstream", async () => {
  const m = fake({ [`GET ${ROTA_DOC}`]: () => json({ email: "privado@example.com" }, 404) });
  await assert.rejects(m.api.consultar(TOKEN), erro("inexistente", 404));
});

test("baixa contrato certificado e certificado separado como PDFs validos sem nova solicitacao", async () => {
  const arquivos = await ARQUIVOS;
  const m = fake({
    [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificated" })),
    [`GET ${ROTA_DOC}/download/certificated`]: () => new Response(Buffer.from(arquivos[1])),
    [`GET ${ROTA_DOC}/download/certificate-page`]: () => new Response(Buffer.from(arquivos[2])),
  });
  const assinado = await m.api.baixarAssinado(TOKEN);
  const trilha = await m.api.baixarTrilha(TOKEN);
  assert.deepEqual(new Uint8Array(assinado), arquivos[1]);
  assert.deepEqual(new Uint8Array(trilha), arquivos[2]);
  assert.equal((await PDFDocument.load(assinado)).getTitle(), "Contrato certificado ficticio");
  assert.equal((await PDFDocument.load(trilha)).getTitle(), "Trilha ficticia");
  assert.equal(m.chamadas.every((c) => c.metodo === "GET"), true);
});

test("download durante certificacao ou 404 do artefato nao finge arquivo assinado", async () => {
  for (const [status, artefato] of [["certificating", 200], ["certificated", 404]] as const) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status })),
      [`GET ${ROTA_DOC}/download/certificated`]: () => json({}, artefato),
    });
    await assert.rejects(m.api.baixarAssinado(TOKEN), erro("sem_arquivo"));
    if (status === "certificating") assert.equal(m.chamadas.length, 1);
  }
  const trilha = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificated" })),
    [`GET ${ROTA_DOC}/download/certificate-page`]: () => json({}, 404),
  });
  await assert.rejects(trilha.api.baixarTrilha(TOKEN), erro("sem_arquivo"));
});

test("download recusa HTML/JSON, tamanho anunciado e stream acima de 10 MiB", async () => {
  const respostas: (() => Response)[] = [
    () => new Response("<html>privado@example.com</html>"),
    () => new Response("%PDF-1.7", { headers: { "Content-Length": String(11 * 1024 * 1024) } }),
    () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); controller.close();
    } })),
  ];
  for (const resposta of respostas) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificated" })), [`GET ${ROTA_DOC}/download/certificated`]: resposta });
    await assert.rejects(m.api.baixarAssinado(TOKEN), erro("resposta_invalida"));
  }
});

test("redirect no download e bloqueado sem seguir URL externa com credencial", async () => {
  const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificated" })),
    [`GET ${ROTA_DOC}/download/certificated`]: (c) => {
      assert.equal(c.init.redirect, "error");
      return new Response(null, { status: 302, headers: { Location: "https://evil.example/privado" } });
    },
  });
  await assert.rejects(m.api.baixarAssinado(TOKEN), erro("http", 302));
  assert.equal(m.chamadas.every((c) => c.url.origin === new URL(BASE).origin), true);
});

test("cancelamento verifica estado e catalogo atual, exclui e so confirma apos GET404", async () => {
  let leituras = 0;
  const m = fake({ [`GET ${ROTA_DOC}`]: () => ++leituras === 1 ? json(documento({ status: "pending_signature", assignment: assignment() })) : json({}, 404),
    [`DELETE ${ROTA_DOC}`]: () => json([]),
  });
  await m.api.cancelar(TOKEN);
  assert.deepEqual(m.chamadas.map((c) => `${c.metodo} ${c.url.pathname}`), [
    `GET ${ROTA_DOC}`, "GET /v1/documents/statuses", `DELETE ${ROTA_DOC}`, `GET ${ROTA_DOC}`,
  ]);
});

test("failed e pending_identity_review usam deletable atual do catalogo antes de cancelar", async () => {
  for (const status of ["failed", "pending_identity_review"]) {
    let leituras = 0;
    const m = fake({ [`GET ${ROTA_DOC}`]: () => ++leituras === 1 ? json(documento({ status })) : json({}, 404),
      [`DELETE ${ROTA_DOC}`]: () => json([]),
    });
    await m.api.cancelar(TOKEN);
    assert.deepEqual(m.chamadas.map((c) => c.metodo), ["GET", "GET", "DELETE", "GET"]);
  }
});

test("catalogo nao deletable, ausente, malformado ou indisponivel impede DELETE", async () => {
  for (const resposta of [
    () => json([{ code: "pending_signature", deletable: false }]),
    () => json([]),
    () => json([{ code: "pending_signature" }]),
    () => json({}, 500),
  ]) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "pending_signature" })),
      "GET /v1/documents/statuses": resposta,
    });
    await assert.rejects(m.api.cancelar(TOKEN), AssinaturaError);
    assert.equal(m.chamadas.some((c) => c.metodo === "DELETE"), false);
  }
});

test("contrato certificado nao e cancelado e estados encerrados nao recebem DELETE", async () => {
  for (const status of ["certificated", "expired", "rejected_by_signer", "rejected_by_user"]) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status })) });
    if (status === "certificated") await assert.rejects(m.api.cancelar(TOKEN), erro("ja_concluido"));
    else await m.api.cancelar(TOKEN);
    assert.equal(m.chamadas.length, 1);
  }
});

test("falha no DELETE ou cancelamento nao confirmado nunca retorna sucesso", async () => {
  for (const statusDelete of [500, 200, 404]) {
    const m = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "pending_signature", assignment: assignment() })),
      [`DELETE ${ROTA_DOC}`]: () => json([], statusDelete),
    });
    await assert.rejects(m.api.cancelar(TOKEN), erro("http", statusDelete === 200 ? undefined : statusDelete));
  }
});

test("404 inicial precisa de segunda consulta e documento processando nao permite DELETE", async () => {
  const ausente = fake({ [`GET ${ROTA_DOC}`]: () => json({}, 404) });
  await assert.rejects(ausente.api.cancelar(TOKEN), erro("inexistente", 404));
  assert.equal(ausente.chamadas.length, 2);
  const processando = fake({ [`GET ${ROTA_DOC}`]: () => json(documento({ status: "certificating" })) });
  await assert.rejects(processando.api.cancelar(TOKEN), erro("http"));
  assert.equal(processando.chamadas.length, 2);
  assert.equal(processando.chamadas.some((c) => c.metodo === "DELETE"), false);
});
