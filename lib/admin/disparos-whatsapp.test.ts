import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { STATUS } from "@/lib/form/types";
import { historicoWhatsApp } from "./disparos-whatsapp";
import type { DisparoWhatsApp, LeadCartao } from "./tipos";
import { lerDisparosWhatsApp } from "@/lib/supabase/disparos-whatsapp";

const ID = "10000000-0000-4000-8000-000000000001";
const OUTRO = "10000000-0000-4000-8000-000000000002";
const ANTIGO = "2026-10-01T12:00:00Z";
const RECENTE = "2026-10-15T12:00:00Z";
const semContato = () => ({ lembrete_7_em: null, lembrete_30_em: null, chamado_whatsapp_em: null });

test("telefone, e-mail, PDF e proposta enviada não inventam contato no WhatsApp", () => {
  const lead = {
    ...semContato(), whatsapp: "19900000000", email: "ficticio@example.invalid",
    pdf_url: "https://example.invalid/proposta.pdf", enviado_em: RECENTE, lembrete_email_em: RECENTE,
  };
  assert.deepEqual(historicoWhatsApp(lead), []);
  assert.deepEqual(historicoWhatsApp({ ...lead, disparos_whatsapp: [] }), []);
});

test("distingue os dois envios automáticos e os três contatos declarados pela Mel", () => {
  const historico = historicoWhatsApp({
    lembrete_7_em: "2026-10-08T12:00:00Z", lembrete_30_em: RECENTE,
    chamado_whatsapp_em: "2026-09-29T12:00:00Z",
    disparos_whatsapp: [
      { tipo: "confirmacao_recebimento", enviado_em: ANTIGO },
      { tipo: "lembrete_formulario_24h", enviado_em: "2026-09-30T12:00:00Z" },
    ],
  });
  assert.deepEqual(historico.map(({ rotulo, origem }) => [rotulo, origem]), [
    ["Lembrete após 30 dias", "manual"], ["Lembrete após 7 dias", "manual"],
    ["Confirmação de recebimento", "automatico"], ["Finalize o formulário", "automatico"],
    ["Contato inicial", "manual"],
  ]);
});

test("mudar de coluna ou reenviar a proposta conserva todos os contatos anteriores", () => {
  const contatos = {
    ...semContato(), lembrete_7_em: ANTIGO,
    disparos_whatsapp: [{ tipo: "lembrete_formulario_24h", enviado_em: ANTIGO }] satisfies DisparoWhatsApp[],
  };
  const esperado = historicoWhatsApp(contatos);
  for (const status of STATUS) {
    const lead = { ...contatos, status, enviado_em: RECENTE };
    assert.deepEqual(historicoWhatsApp(lead), esperado, status);
  }
});

test("envios das propostas só entram no histórico pelo ACK, sem duplicar o carimbo do mesmo envio", () => {
  const historico = historicoWhatsApp({
    ...semContato(),
    lembrete_7_em: "2026-10-15T09:00:00-03:00",
    lembrete_30_em: RECENTE,
    disparos_whatsapp: [
      { tipo: "lembrete_proposta_7d", enviado_em: RECENTE },
      { tipo: "lembrete_proposta_30d", enviado_em: RECENTE },
    ],
  });
  assert.deepEqual(historico.map(({ rotulo, origem }) => [rotulo, origem]), [
    ["Lembrete após 30 dias", "sistema"], ["Lembrete após 7 dias", "sistema"],
  ]);
});

test("um envio MCP posterior conserva uma marcação manual histórica distinta", () => {
  const historico = historicoWhatsApp({
    ...semContato(), lembrete_7_em: ANTIGO,
    disparos_whatsapp: [{ tipo: "lembrete_proposta_7d", enviado_em: RECENTE }],
  });
  assert.deepEqual(historico.map(({ origem, enviadoEm }) => [origem, enviadoEm]), [
    ["sistema", RECENTE], ["manual", ANTIGO],
  ]);
});

test("ignora carimbos inválidos e tipos de automação desconhecidos", () => {
  const tortos = [null, "", "não é data", "123", "2026-10-15", "2026-02-30T12:00:00Z", "2026-10-15T12:00:00"];
  for (const carimbo of tortos) {
    const lead = {
      lembrete_7_em: carimbo, lembrete_30_em: carimbo, chamado_whatsapp_em: carimbo,
      disparos_whatsapp: [{ tipo: "confirmacao_recebimento", enviado_em: carimbo },
        { tipo: "tipo_futuro", enviado_em: RECENTE }],
    } as unknown as LeadCartao;
    assert.deepEqual(historicoWhatsApp(lead), [], String(carimbo));
  }
});

test("ordena pelo instante real, desempata pelo tipo e não muda os dados recebidos", () => {
  const disparos: DisparoWhatsApp[] = [
    { tipo: "lembrete_formulario_24h", enviado_em: "2026-10-15T09:00:00-03:00" },
    { tipo: "confirmacao_recebimento", enviado_em: RECENTE },
  ];
  const lead = { ...semContato(), disparos_whatsapp: disparos, chamado_whatsapp_em: "2026-10-15T11:59:59Z" };
  const antes = JSON.stringify(lead);
  assert.deepEqual(historicoWhatsApp(lead).map(({ tipo }) => tipo), [
    "confirmacao_recebimento", "lembrete_formulario_24h", "contato_inicial",
  ]);
  assert.deepEqual(historicoWhatsApp({ ...lead, disparos_whatsapp: [...disparos].reverse() }), historicoWhatsApp(lead));
  assert.equal(JSON.stringify(lead), antes);
});

test("dados duplicados conservam somente o envio mais recente de cada tipo", () => {
  const disparos: DisparoWhatsApp[] = [
    { tipo: "confirmacao_recebimento", enviado_em: ANTIGO },
    { tipo: "confirmacao_recebimento", enviado_em: RECENTE },
    { tipo: "confirmacao_recebimento", enviado_em: "2026-10-15T09:00:00-03:00" },
  ];
  const historico = historicoWhatsApp({ ...semContato(), disparos_whatsapp: disparos });
  assert.equal(historico.length, 1);
  assert.equal(Date.parse(historico[0].enviadoEm), Date.parse(RECENTE));
  assert.deepEqual(historicoWhatsApp({ ...semContato(), disparos_whatsapp: [...disparos].reverse() }), historico);
});

function bancoFicticio(responder: (tentativa: number) => Response | Promise<Response>) {
  const pedidos: { url: URL; metodo: string }[] = [];
  const db = createClient("https://database.example.invalid", "chave-ficticia", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      pedidos.push({ url: new URL(String(input)), metodo: init?.method ?? "GET" });
      return responder(pedidos.length);
    } },
  });
  return { db, pedidos };
}
const json = (dados: unknown) => new Response(JSON.stringify(dados), { headers: { "Content-Type": "application/json" } });

test("lê somente metadados dos envios confirmados em uma consulta para todos os cartões", async () => {
  const { db, pedidos } = bancoFicticio(() => json([
    { lead_id: ID, tipo: "confirmacao_recebimento", enviado_em: ANTIGO, estado: "enviado", proposta_enviado_em: ANTIGO },
    { lead_id: ID, tipo: "lembrete_formulario_24h", enviado_em: RECENTE, estado: "enviado" },
    { lead_id: ID, tipo: "lembrete_proposta_7d", enviado_em: RECENTE, estado: "enviado", proposta_enviado_em: ANTIGO },
    { lead_id: ID, tipo: "lembrete_proposta_30d", enviado_em: RECENTE, estado: "enviado", proposta_enviado_em: ANTIGO },
    { lead_id: OUTRO, tipo: "confirmacao_recebimento", enviado_em: RECENTE, estado: "enviado" },
  ]));
  const resultado = await lerDisparosWhatsApp([ID, OUTRO, ID], db);
  assert.equal(resultado.erro, false);
  assert.equal(pedidos.length, 1, "nenhuma consulta por cartão");
  const { url, metodo } = pedidos[0];
  assert.equal(metodo, "GET");
  assert.equal(url.pathname, "/rest/v1/whatsapp_outbox");
  assert.equal(url.searchParams.get("select"), "lead_id,tipo,enviado_em,estado,ocorrido_em,proposta_enviado_em,ultimo_codigo,iniciado_em,historico_verificado_em,historico_cobertura_inicio_em,ultima_interacao_em");
  assert.equal(url.searchParams.get("estado"), "in.(pendente,reservado,enviando,enviado,indeterminado,expirado,cancelado)");
  assert.equal(url.searchParams.get("lead_id"), `in.(${ID},${OUTRO})`);
  assert.equal(url.searchParams.get("tipo"), "in.(confirmacao_recebimento,lembrete_formulario_24h,lembrete_proposta_7d,lembrete_proposta_30d,proposta_inicial_15m)");
  assert.deepEqual(resultado.porLead.get(ID), [
    { tipo: "confirmacao_recebimento", enviado_em: ANTIGO },
    { tipo: "lembrete_formulario_24h", enviado_em: RECENTE },
    { tipo: "lembrete_proposta_7d", enviado_em: RECENTE, proposta_enviado_em: ANTIGO },
    { tipo: "lembrete_proposta_30d", enviado_em: RECENTE, proposta_enviado_em: ANTIGO },
  ]);
  assert.deepEqual(resultado.porLead.get(OUTRO), [{ tipo: "confirmacao_recebimento", enviado_em: RECENTE }]);
});

test("resposta auxiliar não publica conteúdo nem registros de outros leads ou tipos", async () => {
  const { db } = bancoFicticio(() => json([
    { lead_id: ID, tipo: "confirmacao_recebimento", enviado_em: RECENTE, estado: "enviado", mensagem: "conteúdo privado", lease_token: "segredo" },
    { lead_id: OUTRO, tipo: "confirmacao_recebimento", enviado_em: RECENTE },
    { lead_id: ID, tipo: "automacao_desconhecida", enviado_em: RECENTE },
    { lead_id: ID, tipo: "lembrete_formulario_24h", enviado_em: null },
    { lead_id: ID, tipo: "lembrete_formulario_24h", enviado_em: "2026-02-30T12:00:00Z" },
  ]));
  const resultado = await lerDisparosWhatsApp([ID], db);
  assert.equal(resultado.erro, false);
  assert.deepEqual([...resultado.porLead], [[ID, [{ tipo: "confirmacao_recebimento", enviado_em: RECENTE }]]]);
});

test("status da solicitação não inventa envio e só publica motivo de lista fixa", async () => {
  const base = { lead_id: ID, tipo: "lembrete_proposta_7d", enviado_em: null,
    ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO, iniciado_em: null };
  const { db, pedidos } = bancoFicticio(() => json([
    { ...base, estado: "pendente", ultimo_codigo: null, mensagem: "privado", destinatario: "privado" },
    { ...base, tipo: "lembrete_proposta_30d", estado: "cancelado", ultimo_codigo: "inactivity_recent" },
    { ...base, estado: "indeterminado", ultimo_codigo: "erro bruto privado" },
    { ...base, estado: "estado_desconhecido", ultimo_codigo: "inactivity_recent" },
    { ...base, lead_id: OUTRO, estado: "pendente" },
  ]));
  const resultado = await lerDisparosWhatsApp([ID], db);
  assert.equal(pedidos.length, 1);
  assert.equal(resultado.porLead.size, 0, "fila e cancelamento não são histórico de envio");
  assert.deepEqual(resultado.solicitacoesPorLead.get(ID), [
    { tipo: "lembrete_proposta_7d", estado: "pendente", ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO,
      motivo: null, reenvioPermitido: false },
    { tipo: "lembrete_proposta_30d", estado: "cancelado", ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO,
      motivo: "Houve interação recente com este contato no WhatsApp.", reenvioPermitido: true },
    { tipo: "lembrete_proposta_7d", estado: "indeterminado", ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO,
      motivo: null, reenvioPermitido: false },
  ]);
  assert.ok(!JSON.stringify([...resultado.solicitacoesPorLead]).includes("privado"));
});

test("nova tentativa só é liberada para cancelamentos seguros antes do início", async () => {
  const codigosPermitidos = ["inactivity_recent", "inactivity_unverified", "proposta_condicao_alterada",
    "historico_em_sincronizacao", "historico_incompleto", "historico_indisponivel", "identidade_nao_confirmada"];
  const casos = ["pendente", "reservado", "enviando", "enviado", "indeterminado", "expirado", "cancelado"]
    .flatMap((estado) => [...codigosPermitidos, "teste_owner_expirado", "codigo-privado", null]
      .flatMap((ultimo_codigo) => [null, RECENTE, undefined].map((iniciado_em) => ({ estado, ultimo_codigo, iniciado_em }))));
  const { db } = bancoFicticio(() => json(casos.map((caso) => ({
    lead_id: ID, tipo: "lembrete_proposta_7d", enviado_em: null,
    ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO, ...caso,
  }))));
  const resultado = await lerDisparosWhatsApp([ID], db);
  assert.equal(resultado.erro, false);
  const solicitacoes = resultado.solicitacoesPorLead.get(ID)!;
  assert.equal(solicitacoes.length, casos.length);
  casos.forEach((caso, indice) => {
    assert.equal(solicitacoes[indice].reenvioPermitido,
      caso.estado === "cancelado" && caso.iniciado_em === null &&
      caso.ultimo_codigo !== null && codigosPermitidos.includes(caso.ultimo_codigo), JSON.stringify(caso));
    assert.equal(Object.hasOwn(solicitacoes[indice], "iniciado_em"), false);
    assert.equal(Object.hasOwn(solicitacoes[indice], "ultimo_codigo"), false);
  });
  assert.ok(!JSON.stringify([...resultado.solicitacoesPorLead]).includes("codigo-privado"));
});

test("distingue sincronização, cobertura incompleta, indisponibilidade e identidade sem publicar dados privados", async () => {
  const codigos = ["historico_em_sincronizacao", "historico_incompleto", "historico_indisponivel",
    "identidade_nao_confirmada", "inactivity_unverified", "inactivity_recent"];
  const { db } = bancoFicticio(() => json(codigos.map((ultimo_codigo) => ({
    lead_id: ID, tipo: "lembrete_proposta_7d", estado: "cancelado", iniciado_em: null,
    ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO, ultimo_codigo,
    mensagem: "conteúdo privado", destinatario: "telefone privado",
  }))));
  const resultado = await lerDisparosWhatsApp([ID], db);
  const solicitacoes = resultado.solicitacoesPorLead.get(ID)!;
  assert.deepEqual(solicitacoes.map(({ motivo }) => motivo), [
    "O WhatsApp ainda está sincronizando o histórico. Tente novamente após a sincronização.",
    "Histórico em validação. Ainda falta completar o período mínimo de observação.",
    "A verificação do histórico do WhatsApp está indisponível. O envio foi bloqueado por segurança.",
    "Ainda não foi possível confirmar a identidade deste contato no WhatsApp.",
    "O histórico do WhatsApp não pôde ser verificado. Isso não confirma uma interação recente.",
    "Houve interação recente com este contato no WhatsApp.",
  ]);
  assert.equal(resultado.porLead.size, 0);
  assert.ok(solicitacoes.every(({ reenvioPermitido }) => reenvioPermitido));
  assert.ok(!JSON.stringify(solicitacoes).includes("privado"));
});

test("cobertura incompleta prevê cinco ou quinze dias no fuso de São Paulo sem prometer envio", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-16T12:00:00Z"));
  const { db } = bancoFicticio(() => json(["lembrete_proposta_7d", "lembrete_proposta_30d"].map((tipo) => ({
    lead_id: ID, tipo, estado: "cancelado", iniciado_em: null,
    ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO, ultimo_codigo: "historico_incompleto",
    historico_verificado_em: "2026-10-16T11:59:00Z", historico_cobertura_inicio_em: "2026-10-15T02:45:00Z",
    ultima_interacao_em: null,
  }))));
  const resultado = await lerDisparosWhatsApp([ID], db);
  const solicitacoes = resultado.solicitacoesPorLead.get(ID)!;
  assert.deepEqual(solicitacoes.map(({ motivo }) => motivo), [
    "Histórico em validação. Período mínimo previsto para 19.10 às 23h45, enquanto a verificação continuar válida.",
    "Histórico em validação. Período mínimo previsto para 29.10 às 23h45, enquanto a verificação continuar válida.",
  ]);
  assert.ok(solicitacoes.every((solicitacao) => !Object.hasOwn(solicitacao, "ultima_interacao_em") &&
    !Object.hasOwn(solicitacao, "historico_cobertura_inicio_em") && !Object.hasOwn(solicitacao, "historico_verificado_em")));
});

test("datas ausentes, inválidas, futuras ou incoerentes não inventam previsão para o histórico", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-16T12:00:00Z"));
  const base = {
    lead_id: ID, tipo: "lembrete_proposta_7d", estado: "cancelado", iniciado_em: null,
    ocorrido_em: RECENTE, proposta_enviado_em: ANTIGO, ultimo_codigo: "historico_incompleto",
    historico_verificado_em: "2026-10-16T11:59:00Z", historico_cobertura_inicio_em: "2026-10-15T02:45:00Z",
    ultima_interacao_em: null,
  };
  const casos = [
    { historico_verificado_em: undefined }, { historico_verificado_em: "invalid" },
    { historico_verificado_em: "2026-10-16T12:00:06Z" },
    { historico_cobertura_inicio_em: null }, { historico_cobertura_inicio_em: "Infinity" },
    { historico_cobertura_inicio_em: "2026-02-30T00:00:00Z" },
    { historico_cobertura_inicio_em: "1970-01-01T00:00:00Z" },
    { historico_cobertura_inicio_em: "2026-10-16T12:00:00Z" },
    { historico_cobertura_inicio_em: "2026-10-01T00:00:00Z" },
    { ultima_interacao_em: undefined }, { ultima_interacao_em: "NaN" },
    { ultima_interacao_em: "2026-10-16T11:59:01Z" }, { ultima_interacao_em: "1970-01-01T00:00:00Z" },
  ];
  const { db } = bancoFicticio(() => json(casos.map((caso) => ({ ...base, ...caso }))));
  const resultado = await lerDisparosWhatsApp([ID], db);
  assert.ok(resultado.solicitacoesPorLead.get(ID)!.every(({ motivo }) =>
    motivo === "Histórico em validação. Ainda falta completar o período mínimo de observação."));
});

test("quadro sem cartões não consulta a fila", async () => {
  const { db, pedidos } = bancoFicticio(() => { throw new Error("não consultar"); });
  assert.deepEqual(await lerDisparosWhatsApp([], db), { porLead: new Map(), solicitacoesPorLead: new Map(), erro: false });
  assert.equal(pedidos.length, 0);
});

test("falha transitória retenta somente a leitura e recupera o histórico", async () => {
  const { db, pedidos } = bancoFicticio((n) => n === 1
    ? new Response(JSON.stringify({ message: "JWT issued at future fictício" }), { status: 401 })
    : json([{ lead_id: ID, tipo: "confirmacao_recebimento", enviado_em: RECENTE, estado: "enviado" }]));
  const resultado = await lerDisparosWhatsApp([ID], db);
  assert.equal(pedidos.length, 2);
  assert.equal(resultado.erro, false);
  assert.equal(resultado.porLead.get(ID)?.length, 1);
});

test("falha definitiva é distinguida de histórico vazio sem derrubar o quadro", async () => {
  const { db, pedidos } = bancoFicticio(() => new Response(JSON.stringify({ message: "erro de leitura fictício" }), { status: 400 }));
  const resultado = await lerDisparosWhatsApp([ID], db);
  assert.equal(pedidos.length, 3);
  assert.equal(resultado.erro, true);
  assert.equal(resultado.porLead.size, 0);
  const vazio = bancoFicticio(() => json([]));
  assert.equal((await lerDisparosWhatsApp([ID], vazio.db)).erro, false);
});
