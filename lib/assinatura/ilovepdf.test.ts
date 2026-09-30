import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  ASSUNTO_ASSINATURA,
  AssinaturaError,
  MENSAGEM_ASSINATURA,
  type PedidoAssinatura,
} from "./adapter";
import {
  ILoveApi,
  dataDaApiParaIso,
  extrairPdfDeZip,
  lerToken,
  montarToken,
  normalizarStatus,
  normalizarStatusSignatario,
  posicaoIlove,
} from "./ilovepdf";

// Nenhum teste aqui fala com a iLoveAPI de verdade: o `fetch` e injetado no
// construtor. Dados todos FICTICIOS (dominios example.*, reservados pela RFC 2606).

// ---------------------------------------------------------------- fixtures --

const API = "https://api.ilovepdf.com/v1";
const SERVER = "api84.ilovepdf.com";
const PDF = new TextEncoder().encode("%PDF-1.7\n% contrato de teste\n%%EOF\n");
const PDF_ASSINADO = new TextEncoder().encode("%PDF-1.7\n% assinado\n%%EOF\n");
const PDF_TRILHA = new TextEncoder().encode("%PDF-1.7\n% trilha de auditoria\n%%EOF\n");

function pedido(extra: Partial<PedidoAssinatura> = {}): PedidoAssinatura {
  return {
    pdf: PDF,
    nomeArquivo: "Contrato - Maria Eduarda.pdf",
    signatarios: [
      { papel: "contratante", nome: "Joana Exemplo da Silva", email: "Joana.Exemplo@example.com" },
      { papel: "contratada", nome: "Storymaker Fictícia", email: "contratada@example.org" },
      { papel: "anuente", nome: "Pedro Exemplo", email: "pedro@example.net" },
    ],
    posicoes: [
      { papel: "contratante", pagina: 4, x: 64, yTopo: 612.345, largura: 200, altura: 40 },
      { papel: "contratada", pagina: 4, x: 331.28, yTopo: 612.345, largura: 200, altura: 40 },
      { papel: "anuente", pagina: 5, x: 64, yTopo: 100, largura: 200, altura: 40 },
    ],
    assunto: ASSUNTO_ASSINATURA,
    mensagem: MENSAGEM_ASSINATURA,
    diasValidade: 30,
    ...extra,
  };
}

// O cache do token e por chave publica e vive no modulo: cada teste usa a sua
// para um nao herdar o token do outro.
let contadorChaves = 0;
const novaChave = () => `project_public_teste_${++contadorChaves}`;

type Chamada = {
  metodo: string;
  url: string;
  headers: Headers;
  corpo: BodyInit | null | undefined;
  signal: AbortSignal | null | undefined;
};
type Rota = (c: Chamada) => Response | Promise<Response>;

/** `fetch` falso roteado por "METODO url". Rota ausente = falha explicita. */
function fetchFalso(rotas: Record<string, Rota>) {
  const chamadas: Chamada[] = [];
  const f = async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const c: Chamada = {
      metodo: (init.method ?? "GET").toUpperCase(),
      url: String(entrada),
      headers: new Headers(init.headers),
      corpo: init.body,
      signal: init.signal,
    };
    chamadas.push(c);
    const rota = rotas[`${c.metodo} ${c.url}`];
    if (!rota) throw new Error(`rota não mockada: ${c.metodo} ${c.url}`);
    return rota(c);
  };
  return { fetch: f as typeof fetch, chamadas, rotuladas: () => chamadas.map((c) => `${c.metodo} ${c.url}`) };
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const rotaAuth = (token = "jwt-1"): Record<string, Rota> => ({
  [`POST ${API}/auth`]: () => json({ token }),
});

/** As quatro rotas de um envio que da certo. */
function rotasDeEnvio(): Record<string, Rota> {
  return {
    ...rotaAuth(),
    [`GET ${API}/start/sign`]: () => json({ server: SERVER, task: "tarefa-123", remaining_credits: 10 }),
    [`POST https://${SERVER}/v1/upload`]: () => json({ server_filename: "arquivo-no-servidor.pdf" }),
    [`POST https://${SERVER}/v1/signature`]: () =>
      json({
        token_requester: "tr-abc",
        status: "draft",
        signers: [
          // A plataforma devolve o e-mail em caixa baixa: o casamento com o
          // papel tem de ignorar caixa.
          { name: "Joana Exemplo da Silva", email: "joana.exemplo@example.com", status: "waiting" },
          { name: "Storymaker Fictícia", email: "contratada@example.org", status: "waiting" },
          { name: "Pedro Exemplo", email: "pedro@example.net", status: "sent" },
        ],
      }),
  };
}

/** Silencia e captura o console.error/warn do teste (as linhas `[assinatura] ...`). */
function capturarLogs() {
  const linhas: string[] = [];
  const guardar = (...args: unknown[]) => {
    linhas.push(args.map(String).join(" "));
  };
  mock.method(console, "error", guardar);
  mock.method(console, "warn", guardar);
  return linhas;
}

function erroDeAssinatura(e: unknown): AssinaturaError {
  assert.ok(e instanceof AssinaturaError, `esperava AssinaturaError, veio ${String(e)}`);
  return e;
}

// ------------------------------------------------------------------- envio --

test("o envio autentica, abre a tarefa, sobe o PDF e cria o pedido, nessa ordem", async () => {
  const falso = fetchFalso(rotasDeEnvio());
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch });

  const r = await api.enviar(pedido());

  assert.deepEqual(falso.rotuladas(), [
    `POST ${API}/auth`,
    `GET ${API}/start/sign`,
    `POST https://${SERVER}/v1/upload`,
    `POST https://${SERVER}/v1/signature`,
  ]);

  // O /auth leva a chave publica no corpo e nenhum Bearer; o resto leva o token.
  const [auth, ...autenticadas] = falso.chamadas;
  assert.equal(auth.headers.get("authorization"), null);
  assert.ok(String(auth.corpo).includes('"public_key":"project_public_teste_'));
  for (const c of autenticadas) assert.equal(c.headers.get("authorization"), "Bearer jwt-1");

  // O server vai junto no token: e dele que os downloads dependem.
  assert.equal(r.token, `${SERVER}|tr-abc`);
  assert.equal(r.status, "enviado", "'draft' e o instante em que os e-mails estao saindo");
  assert.deepEqual(r.signatarios, [
    { papel: "contratante", nome: "Joana Exemplo da Silva", email: "Joana.Exemplo@example.com", status: "pendente", assinadoEm: null },
    { papel: "contratada", nome: "Storymaker Fictícia", email: "contratada@example.org", status: "pendente", assinadoEm: null },
    { papel: "anuente", nome: "Pedro Exemplo", email: "pedro@example.net", status: "pendente", assinadoEm: null },
  ]);
});

test("o upload manda a tarefa e o PDF como multipart, sem Content-Type fixo", async () => {
  const falso = fetchFalso(rotasDeEnvio());
  await new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido());

  const upload = falso.chamadas.find((c) => c.url.endsWith("/v1/upload"));
  assert.ok(upload);
  assert.ok(upload.corpo instanceof FormData, "o upload tem de ser form-data");
  // Content-Type fixo apagaria o boundary que o fetch gera para o multipart.
  assert.equal(upload.headers.get("content-type"), null);

  assert.equal(upload.corpo.get("task"), "tarefa-123");
  const arquivo = upload.corpo.get("file");
  assert.ok(arquivo instanceof File, "o campo file tem de ser um arquivo");
  assert.equal(arquivo.name, "Contrato - Maria Eduarda.pdf");
  assert.equal(arquivo.type, "application/pdf");
  assert.deepEqual(new Uint8Array(await arquivo.arrayBuffer()), PDF);
});

test("o corpo do /signature leva cada signatário com o campo só no lugar do próprio papel", async () => {
  const falso = fetchFalso(rotasDeEnvio());
  await new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido());

  const criacao = falso.chamadas.find((c) => c.url.endsWith("/v1/signature"));
  assert.ok(criacao);
  assert.equal(criacao.headers.get("content-type"), "application/json");
  const corpo = JSON.parse(String(criacao.corpo));

  assert.deepEqual(corpo, {
    task: "tarefa-123",
    files: [{ server_filename: "arquivo-no-servidor.pdf", filename: "Contrato - Maria Eduarda.pdf" }],
    signers: [
      {
        name: "Joana Exemplo da Silva",
        email: "Joana.Exemplo@example.com",
        type: "signer",
        files: [
          {
            server_filename: "arquivo-no-servidor.pdf",
            // Origem no canto SUPERIOR esquerdo: y negativo, arredondado a 2 casas.
            elements: [{ type: "signature", position: "64 -612.35", pages: "4", size: 40 }],
          },
        ],
      },
      {
        name: "Storymaker Fictícia",
        email: "contratada@example.org",
        type: "signer",
        files: [
          {
            server_filename: "arquivo-no-servidor.pdf",
            elements: [{ type: "signature", position: "331.28 -612.35", pages: "4", size: 40 }],
          },
        ],
      },
      {
        name: "Pedro Exemplo",
        email: "pedro@example.net",
        type: "signer",
        files: [
          {
            server_filename: "arquivo-no-servidor.pdf",
            elements: [{ type: "signature", position: "64 -100", pages: "5", size: 40 }],
          },
        ],
      },
    ],
    language: "pt",
    lock_order: false,
    expiration_days: 30,
    signer_reminders: true,
    signer_reminder_days_cycle: 3,
    uuid_visible: true,
    verify_enabled: true,
    subject_signer: "Contrato de prestação de serviços | Mel Simão Storymaker",
    message_signer:
      "Olá! Segue o contrato de prestação de serviços de storymaker para sua assinatura eletrônica. Qualquer dúvida, é só falar com a Mel.",
  });
});

test("pedido inválido é recusado antes de qualquer chamada à plataforma", async () => {
  const falso = fetchFalso(rotasDeEnvio());
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch });
  const [contratante, contratada] = pedido().signatarios;

  await assert.rejects(
    api.enviar(pedido({ signatarios: [contratante, { ...contratada, email: "JOANA.exemplo@example.com" }] })),
    (e) => erroDeAssinatura(e).codigo === "pedido_invalido",
  );
  // Nem /auth: pedido errado nao pode gastar tarefa nem credito.
  assert.equal(falso.chamadas.length, 0);
});

test("/start/sign sem crédito de assinatura explica que falta crédito e para ali", async () => {
  const logs = capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    // Corpo real medido em 29/09/2026 com a conta sem credito de assinatura.
    [`GET ${API}/start/sign`]: () =>
      json(
        {
          error: {
            type: "StartError",
            message: "The task can't be initialized, check why in the params",
            code: 400,
            param: { task: ["You don\\t have enough signatures to start a request."] },
          },
        },
        400,
      ),
  });

  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido()),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "sem_creditos");
      assert.equal(erro.etapa, "start");
      assert.match(erro.message, /sem créditos de assinatura/);
      return true;
    },
  );
  assert.equal(falso.chamadas.length, 2, "nao pode seguir para o upload");
  assert.deepEqual(logs, ["[assinatura] start 400 sem créditos"]);
  mock.restoreAll();
});

test("start que aponta para servidor fora da iLoveAPI é recusado: o Bearer não sai para outro host", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET ${API}/start/sign`]: () => json({ server: "api1.example.com", task: "t" }),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido()),
    (e) => erroDeAssinatura(e).codigo === "resposta_invalida",
  );
  assert.equal(falso.chamadas.length, 2);
  mock.restoreAll();
});

test("resposta 2xx em formato inesperado vira AssinaturaError", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET ${API}/start/sign`]: () => new Response("<html>manutenção</html>", { status: 200 }),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido()),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "resposta_invalida");
      assert.equal(erro.etapa, "start");
      return true;
    },
  );
  mock.restoreAll();
});

// -------------------------------------------------------------------- token --

test("o token de acesso é reaproveitado por 50 minutos e renovado depois", async () => {
  let agora = 1_000_000;
  let emitidos = 0;
  const falso = fetchFalso({
    [`POST ${API}/auth`]: () => json({ token: `jwt-${++emitidos}` }),
    [`GET ${API}/signature/requesterview/tr-abc`]: () => json({ status: "sent", signers: [] }),
  });
  const chave = novaChave();
  const api = new ILoveApi({ publicKey: chave, fetch: falso.fetch, agora: () => agora });
  const token = montarToken(SERVER, "tr-abc");

  await api.consultar(token);
  agora += 49 * 60_000;
  await api.consultar(token);
  // Outra instancia (a rota cria uma por request) aproveita o mesmo token.
  await new ILoveApi({ publicKey: chave, fetch: falso.fetch, agora: () => agora }).consultar(token);
  assert.equal(emitidos, 1, "dentro dos 50 minutos o /auth nao pode ser chamado de novo");

  agora += 2 * 60_000; // 51 minutos depois do primeiro
  await api.consultar(token);
  assert.equal(emitidos, 2, "passado o prazo, o token e renovado");

  const bearers = falso.chamadas.filter((c) => c.url.includes("requesterview")).map((c) => c.headers.get("authorization"));
  assert.deepEqual(bearers, ["Bearer jwt-1", "Bearer jwt-1", "Bearer jwt-1", "Bearer jwt-2"]);
});

test("401 com token do cache renova o token e tenta de novo, uma vez só", async () => {
  capturarLogs();
  let emitidos = 0;
  const falso = fetchFalso({
    [`POST ${API}/auth`]: () => json({ token: `jwt-${++emitidos}` }),
    [`GET ${API}/signature/requesterview/tr-abc`]: (c) =>
      emitidos === 1 && c.headers.get("authorization") === "Bearer jwt-1" && falso.chamadas.length > 2
        ? json({ name: "Unauthorized", message: "Expired token", code: 0, status: 401 }, 401)
        : json({ status: "sent", signers: [] }),
  });
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch });
  const token = montarToken(SERVER, "tr-abc");

  await api.consultar(token); // emite jwt-1 e guarda
  const r = await api.consultar(token); // jwt-1 do cache -> 401 -> jwt-2 -> ok

  assert.equal(r.status, "enviado");
  assert.equal(emitidos, 2);
  assert.deepEqual(falso.rotuladas(), [
    `POST ${API}/auth`,
    `GET ${API}/signature/requesterview/tr-abc`,
    `GET ${API}/signature/requesterview/tr-abc`,
    `POST ${API}/auth`,
    `GET ${API}/signature/requesterview/tr-abc`,
  ]);
  mock.restoreAll();
});

test("401 com token recém-emitido é chave errada: não repete e explica", async () => {
  const logs = capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET ${API}/signature/requesterview/tr-abc`]: () =>
      json({ name: "Unauthorized", message: "Key may not be empty", code: 0, status: 401 }, 401),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).consultar(montarToken(SERVER, "tr-abc")),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.status, 401);
      assert.match(erro.message, /chave de acesso/);
      return true;
    },
  );
  assert.equal(falso.chamadas.length, 2);
  assert.deepEqual(logs, ["[assinatura] consultar 401"]);
  mock.restoreAll();
});

test("o token guardado é server|token_requester e só aceita servidor da iLoveAPI", () => {
  assert.deepEqual(lerToken(`${SERVER}|tr-abc`), { server: SERVER, tokenRequester: "tr-abc" });
  for (const ruim of ["", "tr-abc", "|tr-abc", `${SERVER}|`, "evil.example.com|tr-abc", `${SERVER}|a/b`]) {
    assert.throws(() => lerToken(ruim), (e) => erroDeAssinatura(e).codigo === "token_ilegivel", ruim);
  }
  // Token do dry run nao e ilegivel: e de OUTRO provedor.
  assert.throws(
    () => lerToken("dry-7f1c"),
    (e) => erroDeAssinatura(e).codigo === "token_invalido" && /modo de teste/.test(erroDeAssinatura(e).message),
  );
});

test("token ilegível aponta a saída pelo “Cancelar envio” do painel", () => {
  assert.throws(
    () => lerToken("registro-corrompido"),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "token_ilegivel");
      assert.match(erro.message, /Use “Cancelar envio” para destravar o contrato/);
      return true;
    },
  );
});

test("token do dry run ou corrompido é recusado sem chamar a plataforma", async () => {
  const falso = fetchFalso(rotaAuth());
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch });
  await assert.rejects(api.consultar("dry-123"), (e) => erroDeAssinatura(e).codigo === "token_invalido");
  await assert.rejects(api.baixarAssinado("evil.example.com|x"), (e) => erroDeAssinatura(e).codigo === "token_ilegivel");
  await assert.rejects(api.cancelar("sem-barra"), (e) => erroDeAssinatura(e).codigo === "token_ilegivel");
  assert.equal(falso.chamadas.length, 0);
});

// ---------------------------------------------------------------- consulta --

function consultarCom(resposta: unknown) {
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET ${API}/signature/requesterview/tr-abc`]: () => json(resposta),
  });
  return new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch });
}

test("cada status do pedido na plataforma vira o status do sistema", async () => {
  const logs = capturarLogs();
  const casos: Array<[string, boolean, string]> = [
    ["draft", false, "enviado"],
    ["sent", false, "enviado"],
    ["delivered", false, "enviado"],
    ["waiting", false, "enviado"],
    ["completed", false, "concluido"],
    ["declined", false, "recusado"],
    ["expired", false, "expirado"],
    ["void", false, "cancelado"],
    ["deleted", false, "cancelado"],
    // `expired: true` vence o texto do status.
    ["sent", true, "expirado"],
    // Status novo: fica "enviado", o unico que nao mexe no banco.
    ["on_hold", false, "enviado"],
  ];
  for (const [status, expired, esperado] of casos) {
    const r = await consultarCom({ status, expired, signers: [] }).consultar(montarToken(SERVER, "tr-abc"));
    assert.equal(r.status, esperado, `${status} (expired=${expired})`);
  }
  assert.deepEqual(logs, ["[assinatura] consultar status desconhecido: on_hold"]);
  mock.restoreAll();
});

test("cada status de signatário vira assinou, recusou ou pendente", () => {
  assert.equal(normalizarStatusSignatario("signed"), "assinou");
  assert.equal(normalizarStatusSignatario("SIGNED"), "assinou");
  for (const s of ["declined", "rejected", "nonvalidated"]) assert.equal(normalizarStatusSignatario(s), "recusou", s);
  for (const s of ["waiting", "sent", "viewed", "error", "", null, undefined]) {
    assert.equal(normalizarStatusSignatario(s), "pendente", String(s));
  }
  assert.equal(normalizarStatus(" Completed "), "concluido");
});

test("a consulta recupera o papel de cada um pelo e-mail, ignorando caixa", async () => {
  const api = consultarCom({
    status: "completed",
    completed_on: "2026-10-02 18:30:00",
    signers: [
      { name: "Joana Exemplo da Silva", email: "joana.exemplo@example.com", status: "signed" },
      { name: "Storymaker Fictícia", email: "contratada@example.org", status: "signed" },
      { name: "Pedro Exemplo", email: "pedro@example.net", status: "declined" },
      { name: "Alguém de Fora", email: "fora@example.com", status: "viewed" },
    ],
  });
  const conhecidos = pedido().signatarios;

  const r = await api.consultar(montarToken(SERVER, "tr-abc"), conhecidos);

  assert.equal(r.status, "concluido");
  // Sem fuso na resposta: lido como UTC (o painel da conta agrupa por hora UTC).
  assert.equal(r.concluidoEm, "2026-10-02T18:30:00.000Z");
  assert.deepEqual(
    r.signatarios.map((s) => [s.papel, s.email, s.status, s.assinadoEm]),
    [
      ["contratante", "joana.exemplo@example.com", "assinou", null],
      ["contratada", "contratada@example.org", "assinou", null],
      ["anuente", "pedro@example.net", "recusou", null],
      [null, "fora@example.com", "pendente", null],
    ],
  );
});

test("sem a lista de conhecidos, a consulta devolve papel nulo em vez de adivinhar", async () => {
  const r = await consultarCom({
    status: "sent",
    signers: [{ name: "Joana Exemplo da Silva", email: "joana.exemplo@example.com", status: "viewed" }],
  }).consultar(montarToken(SERVER, "tr-abc"));
  assert.equal(r.signatarios[0].papel, null);
  assert.equal(r.concluidoEm, null, "so pedido concluido tem data de conclusao");
});

test("resposta sem signatários mantém os conhecidos como pendentes", async () => {
  const conhecidos = pedido().signatarios;
  const r = await consultarCom({ status: "sent" }).consultar(montarToken(SERVER, "tr-abc"), conhecidos);
  assert.deepEqual(
    r.signatarios.map((s) => [s.papel, s.status]),
    [
      ["contratante", "pendente"],
      ["contratada", "pendente"],
      ["anuente", "pendente"],
    ],
  );
});

test("datas da plataforma viram ISO; formato estranho vira nulo", () => {
  assert.equal(dataDaApiParaIso("2026-10-02 18:30:00"), "2026-10-02T18:30:00.000Z");
  assert.equal(dataDaApiParaIso("2026-10-02T18:30"), "2026-10-02T18:30:00.000Z");
  assert.equal(dataDaApiParaIso("2026-10-02T18:30:00-03:00"), "2026-10-02T21:30:00.000Z");
  assert.equal(dataDaApiParaIso("02/10/2026"), null);
  assert.equal(dataDaApiParaIso(null), null);
});

test("a posição sai como 'X -Y' com no máximo duas casas", () => {
  const base = { papel: "contratante" as const, pagina: 1, largura: 200, altura: 40 };
  assert.equal(posicaoIlove({ ...base, x: 64, yTopo: 700.4567 }), "64 -700.46");
  assert.equal(posicaoIlove({ ...base, x: 33.21, yTopo: 0 }), "33.21 0");
});

// --------------------------------------------------------------- downloads --

test("contrato assinado e trilha são baixados do servidor do envio, sem abrir tarefa nova", async () => {
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET https://${SERVER}/v1/signature/tr-abc/download-signed`]: () => new Response(PDF_ASSINADO),
    [`GET https://${SERVER}/v1/signature/tr-abc/download-audit`]: () => new Response(PDF_TRILHA),
  });
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch });
  const token = montarToken(SERVER, "tr-abc");

  assert.deepEqual(await api.baixarAssinado(token), PDF_ASSINADO);
  assert.deepEqual(await api.baixarTrilha(token), PDF_TRILHA);

  // Chamar /start/sign de novo (como faz a biblioteca oficial) falharia com a
  // conta sem credito -- e o contrato ja assinado nao poderia ser baixado.
  assert.ok(!falso.chamadas.some((c) => c.url.includes("/start/")));
  for (const c of falso.chamadas.slice(1)) assert.equal(c.headers.get("authorization"), "Bearer jwt-1");
});

/** ZIP minimo (um arquivo, deflate), montado a mao como o de qualquer gerador. */
function zipCom(nome: string, conteudo: Uint8Array): Uint8Array<ArrayBuffer> {
  const nomeBytes = Buffer.from(nome, "utf8");
  const dados = deflateRawSync(conteudo);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(dados.length, 18);
  local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(nomeBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(dados.length, 20);
  central.writeUInt32LE(conteudo.length, 24);
  central.writeUInt16LE(nomeBytes.length, 28);
  central.writeUInt32LE(0, 42); // offset do cabecalho local

  const inicioCentral = local.length + nomeBytes.length + dados.length;
  const tamanhoCentral = central.length + nomeBytes.length;
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 8);
  fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(inicioCentral, 16);

  return new Uint8Array(Buffer.concat([local, nomeBytes, dados, central, nomeBytes, fim]));
}

test("download que chega como ZIP tem o PDF extraído", async () => {
  const zip = zipCom("Contrato - Maria Eduarda.pdf", PDF_ASSINADO);
  assert.deepEqual(extrairPdfDeZip(zip), PDF_ASSINADO);
  assert.equal(extrairPdfDeZip(zipCom("leia-me.txt", PDF_ASSINADO)), null);
  assert.equal(extrairPdfDeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), null);

  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET https://${SERVER}/v1/signature/tr-abc/download-signed`]: () => new Response(zip),
  });
  const bytes = await new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).baixarAssinado(
    montarToken(SERVER, "tr-abc"),
  );
  assert.deepEqual(bytes, PDF_ASSINADO);
});

test("download que não é PDF nem ZIP vira AssinaturaError", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET https://${SERVER}/v1/signature/tr-abc/download-audit`]: () => new Response("<html>erro</html>"),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).baixarTrilha(montarToken(SERVER, "tr-abc")),
    (e) => erroDeAssinatura(e).codigo === "resposta_invalida",
  );
  mock.restoreAll();
});

test("download antes de todos assinarem (400) diz que falta assinatura", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET https://${SERVER}/v1/signature/tr-abc/download-signed`]: () => json({ error: { code: 400 } }, 400),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).baixarAssinado(montarToken(SERVER, "tr-abc")),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "sem_arquivo");
      assert.equal(erro.message, "O contrato ainda não foi assinado por todas as partes.");
      return true;
    },
  );
  mock.restoreAll();
});

// ------------------------------------------------------------- cancelamento --

test("cancelar anula o pedido com PUT /signature/void", async () => {
  const falso = fetchFalso({
    ...rotaAuth(),
    [`PUT ${API}/signature/void/tr-abc`]: () => json({ status: "void", signers: [] }),
  });
  await new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).cancelar(montarToken(SERVER, "tr-abc"));
  assert.deepEqual(falso.rotuladas(), [`POST ${API}/auth`, `PUT ${API}/signature/void/tr-abc`]);
});

test("cancelar o que já terminou por outro caminho não é erro", async () => {
  capturarLogs();
  for (const status of ["void", "expired", "declined"]) {
    const falso = fetchFalso({
      ...rotaAuth(),
      [`PUT ${API}/signature/void/tr-abc`]: () => json({ error: { code: 400 } }, 400),
      [`GET ${API}/signature/requesterview/tr-abc`]: () => json({ status, signers: [] }),
    });
    await new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).cancelar(montarToken(SERVER, "tr-abc"));
  }
  mock.restoreAll();
});

test("cancelar o que todos já assinaram é recusado com texto próprio", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`PUT ${API}/signature/void/tr-abc`]: () => json({ error: { code: 400 } }, 400),
    [`GET ${API}/signature/requesterview/tr-abc`]: () => json({ status: "completed", signers: [] }),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).cancelar(montarToken(SERVER, "tr-abc")),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "ja_concluido");
      assert.match(erro.message, /Todas as partes já assinaram/);
      return true;
    },
  );
  mock.restoreAll();
});

// O pedido apagado pelo painel da iLovePDF responde 404 no void E na consulta.
// Antes, o 404 saia como erro "http" generico, a rota respondia 502 e o
// contrato ficava preso em "enviado" para sempre.
const naoEncontrado = () => json({ error: { code: 404, message: "Signature not found" } }, 404);

test("consulta de pedido que sumiu da plataforma (404) diz que ele não existe mais", async () => {
  const logs = capturarLogs();
  const falso = fetchFalso({ ...rotaAuth(), [`GET ${API}/signature/requesterview/tr-abc`]: naoEncontrado });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).consultar(montarToken(SERVER, "tr-abc")),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "inexistente");
      assert.equal(erro.status, 404);
      assert.match(erro.message, /não foi encontrado na plataforma de assinatura/);
      return true;
    },
  );
  assert.deepEqual(logs, ["[assinatura] consultar 404"]);
  mock.restoreAll();
});

test("download de pedido que sumiu (404) também é inexistente; 404 na criação não", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET https://${SERVER}/v1/signature/tr-abc/download-signed`]: naoEncontrado,
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).baixarAssinado(montarToken(SERVER, "tr-abc")),
    (e) => erroDeAssinatura(e).codigo === "inexistente",
  );

  // Na CRIACAO o 404 nao quer dizer "o pedido sumiu": nao ha pedido ainda.
  const rotas = rotasDeEnvio();
  rotas[`POST https://${SERVER}/v1/signature`] = naoEncontrado;
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: fetchFalso(rotas).fetch }).enviar(pedido()),
    (e) => erroDeAssinatura(e).codigo === "http",
  );
  mock.restoreAll();
});

test("cancelar pedido com 404 no void e na consulta: o pedido não existe mais", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`PUT ${API}/signature/void/tr-abc`]: naoEncontrado,
    [`GET ${API}/signature/requesterview/tr-abc`]: naoEncontrado,
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).cancelar(montarToken(SERVER, "tr-abc")),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "inexistente");
      assert.equal(erro.status, 404);
      return true;
    },
  );
  // Confirmou pela consulta antes de dar o pedido como inexistente.
  assert.deepEqual(falso.rotuladas(), [
    `POST ${API}/auth`,
    `PUT ${API}/signature/void/tr-abc`,
    `GET ${API}/signature/requesterview/tr-abc`,
  ]);
  mock.restoreAll();
});

test("404 no void com o pedido ainda aberto na consulta NÃO é inexistente", async () => {
  capturarLogs();
  for (const consulta of [
    () => json({ status: "waiting", signers: [] }),
    // Consulta fora do ar: nao ha como confirmar que o pedido sumiu.
    () => new Response("", { status: 503 }),
  ]) {
    const falso = fetchFalso({
      ...rotaAuth(),
      [`PUT ${API}/signature/void/tr-abc`]: naoEncontrado,
      [`GET ${API}/signature/requesterview/tr-abc`]: consulta,
    });
    await assert.rejects(
      new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).cancelar(montarToken(SERVER, "tr-abc")),
      (e) => {
        const erro = erroDeAssinatura(e);
        assert.equal(erro.codigo, "http");
        assert.match(erro.message, /não confirmou que ele foi encerrado/);
        return true;
      },
    );
  }
  mock.restoreAll();
});

test("404 no void de pedido já encerrado ou já assinado segue o caminho de sempre", async () => {
  capturarLogs();
  const com = (status: string) =>
    new ILoveApi({
      publicKey: novaChave(),
      fetch: fetchFalso({
        ...rotaAuth(),
        [`PUT ${API}/signature/void/tr-abc`]: naoEncontrado,
        [`GET ${API}/signature/requesterview/tr-abc`]: () => json({ status, signers: [] }),
      }).fetch,
    }).cancelar(montarToken(SERVER, "tr-abc"));

  await com("void");
  await com("deleted");
  await assert.rejects(com("completed"), (e) => erroDeAssinatura(e).codigo === "ja_concluido");
  mock.restoreAll();
});

test("cancelar com a plataforma fora do ar propaga o erro sem consultar", async () => {
  capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`PUT ${API}/signature/void/tr-abc`]: () => new Response("", { status: 503 }),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).cancelar(montarToken(SERVER, "tr-abc")),
    (e) => erroDeAssinatura(e).status === 503,
  );
  assert.equal(falso.chamadas.length, 2);
  mock.restoreAll();
});

// -------------------------------------------------------------------- erros --

test("erro HTTP vira AssinaturaError com texto humano, sem vazar o corpo na mensagem nem no log", async () => {
  const logs = capturarLogs();
  const rotas = rotasDeEnvio();
  // O erro de validacao da iLoveAPI ecoa o pedido: e-mail e nome de cliente.
  rotas[`POST https://${SERVER}/v1/signature`] = () =>
    json(
      {
        error: {
          type: "ProcessingError",
          message: "Invalid signer",
          param: { signers: ["joana.exemplo@example.com is not valid", "Joana Exemplo da Silva"] },
        },
      },
      400,
    );
  const falso = fetchFalso(rotas);

  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido()),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.codigo, "http");
      assert.equal(erro.etapa, "signature");
      assert.equal(erro.status, 400);
      assert.equal(
        erro.message,
        "A plataforma de assinatura recusou o pedido (criação do pedido de assinatura, HTTP 400). Tente de novo; se continuar, confira o painel da iLoveAPI.",
      );
      assert.doesNotMatch(erro.message, /example|Joana|Invalid signer/i);
      return true;
    },
  );
  assert.deepEqual(logs, ["[assinatura] signature 400"]);
  mock.restoreAll();
});

test("plataforma fora do ar (5xx) e excesso de pedidos (429) têm texto próprio", async () => {
  capturarLogs();
  for (const [status, trecho] of [
    [502, /instável agora/],
    [429, /pedidos demais/],
  ] as const) {
    const falso = fetchFalso({
      ...rotaAuth(),
      [`GET ${API}/signature/requesterview/tr-abc`]: () => new Response("", { status }),
    });
    await assert.rejects(
      new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).consultar(montarToken(SERVER, "tr-abc")),
      (e) => trecho.test(erroDeAssinatura(e).message),
    );
  }
  mock.restoreAll();
});

/** Resposta que nunca chega; so termina quando o AbortSignal dispara. */
const pendurada: Rota = (c) =>
  new Promise<Response>((_resolver, rejeitar) => {
    c.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError")));
  });

test("timeout vira AssinaturaError", async () => {
  const logs = capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET ${API}/signature/requesterview/tr-abc`]: pendurada,
  });
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch, timeoutMs: 20 });

  await assert.rejects(api.consultar(montarToken(SERVER, "tr-abc")), (e) => {
    const erro = erroDeAssinatura(e);
    assert.equal(erro.codigo, "timeout");
    assert.equal(erro.etapa, "consultar");
    assert.match(erro.message, /demorou demais/);
    return true;
  });
  assert.deepEqual(logs, ["[assinatura] consultar timeout (20 ms)"]);
  mock.restoreAll();
});

test("timeout na criação do pedido manda conferir o painel antes de reenviar", async () => {
  capturarLogs();
  const rotas = rotasDeEnvio();
  rotas[`POST https://${SERVER}/v1/signature`] = pendurada;
  const falso = fetchFalso(rotas);
  const api = new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch, timeoutLongoMs: 30 });

  await assert.rejects(api.enviar(pedido()), (e) => {
    const erro = erroDeAssinatura(e);
    assert.equal(erro.codigo, "timeout");
    assert.equal(erro.etapa, "signature");
    // Sem resposta nao quer dizer nao criado: os e-mails podem ter saido.
    assert.match(erro.message, /confira no painel da iLoveAPI se o pedido não foi criado/);
    return true;
  });
  mock.restoreAll();
});

test("falha de rede vira AssinaturaError sem detalhe de PII no log", async () => {
  const logs = capturarLogs();
  const falso = fetchFalso({
    ...rotaAuth(),
    [`GET ${API}/start/sign`]: () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    },
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).enviar(pedido()),
    (e) => erroDeAssinatura(e).codigo === "rede",
  );
  assert.deepEqual(logs, ["[assinatura] start falha de rede (ECONNRESET)"]);
  mock.restoreAll();
});

test("/auth recusado vira texto de chave errada", async () => {
  capturarLogs();
  const falso = fetchFalso({
    [`POST ${API}/auth`]: () => json({ name: "Unauthorized", message: "Wrong key", status: 401 }, 401),
  });
  await assert.rejects(
    new ILoveApi({ publicKey: novaChave(), fetch: falso.fetch }).consultar(montarToken(SERVER, "tr-abc")),
    (e) => {
      const erro = erroDeAssinatura(e);
      assert.equal(erro.etapa, "auth");
      assert.match(erro.message, /recusou a chave de acesso/);
      return true;
    },
  );
  mock.restoreAll();
});
