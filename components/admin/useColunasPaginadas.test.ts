import assert from "node:assert/strict";
import { test } from "node:test";
import type { FiltrosNavegacao } from "@/lib/admin/navegacao";
import type { ColunaKanbanDados } from "@/lib/admin/paginacao-kanban";
import type { LeadCartao } from "@/lib/admin/tipos";
import { STATUS, type Status } from "@/lib/form/types";
import { criarControleColunasPaginadas } from "./useColunasPaginadas";

const filtros: FiltrosNavegacao = { q: "", periodo: "todo" };
const cartao = (id: string, status: Status = "incompleto"): LeadCartao => ({
  id, status, created_at: "2026-10-23T12:00:00Z", categoria: "casamento", nome_display: id,
  data_evento: "2027-01-10", passo_atual: "nome", enviado_em: null, lembrete_7_em: null,
  lembrete_30_em: null, lembrete_email_em: null, chamado_whatsapp_em: null, qualificado_em: null,
  pdf_url: null, whatsapp: "19999999999", email: null,
});
const coluna = (status: Status, quantidade = 50, total = 170): ColunaKanbanDados => ({
  cartoes: Array.from({ length: quantidade }, (_, i) => cartao(`${status}-${i}`, status)), total, erro: null,
});
const colunas = () => Object.fromEntries(STATUS.map(status => [status, coluna(status)])) as Record<Status, ColunaKanbanDados>;
type Props = Parameters<typeof criarControleColunasPaginadas>[0];
type Resposta = { ok: boolean; json: () => Promise<unknown> };
type Pedido = { params: URLSearchParams; sinal: AbortSignal; resolver: (valor: Resposta) => void; rejeitar: (erro: unknown) => void };

function montar(alteracoes: Partial<Props> = {}) {
  let props: Props = { colunas: colunas(), filtros, agoraMs: 100, pausado: false, ...alteracoes };
  const pedidos: Pedido[] = [];
  const controle = criarControleColunasPaginadas(props, (url, init) => new Promise((resolver, rejeitar) => {
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    pedidos.push({ params: new URL(url, "https://teste.invalid").searchParams, sinal: init.signal as AbortSignal, resolver, rejeitar });
  }));
  let mudancas = 0;
  controle.assinar(() => { mudancas++; });
  const esperar = () => new Promise<void>(resolver => setImmediate(resolver));
  return {
    controle, pedidos,
    get estado() { return controle.ler(); },
    get mudancas() { return mudancas; },
    atualizar(alteracoes: Partial<Props>) { props = { ...props, ...alteracoes }; controle.atualizar(props); },
    async responder(indice: number, dados: unknown, ok = true) {
      pedidos[indice].resolver({ ok, json: async () => dados });
      await esperar();
    },
    async concluir(indice: number, dados: ColunaKanbanDados, agoraMs = 200) {
      pedidos[indice].resolver({ ok: true, json: async () => ({ coluna: dados, agoraMs }) });
      await esperar();
    },
    async falhar(indice: number) { pedidos[indice].rejeitar(new Error("segredo do servidor")); await esperar(); },
  };
}

test("inicia com 50 por coluna e carrega colunas independentes, sem repetir observer e clique", async () => {
  const quadro = montar();
  assert.equal(quadro.pedidos.length, 0);
  assert.equal(quadro.estado.agoraMs, 100, "hidratação mantém o instante exato do servidor");
  for (const status of STATUS) assert.equal(quadro.estado.colunas[status].cartoes.length, 50);
  quadro.controle.carregarMais("incompleto");
  quadro.controle.carregarMais("incompleto");
  quadro.controle.carregarMais("esfriou");
  assert.equal(quadro.pedidos.length, 2);
  for (const pedido of quadro.pedidos) assert.equal(pedido.params.get("quantidade"), "100");
  assert.equal(quadro.estado.carregando.incompleto, true);
  assert.equal(quadro.estado.carregando.esfriou, true);
  await quadro.concluir(0, coluna("incompleto", 100));
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 100);
  assert.equal(quadro.estado.carregando.incompleto, false);
  assert.equal(quadro.estado.carregando.esfriou, true);
  await quadro.concluir(1, coluna("esfriou", 100), 300);
  assert.equal(quadro.estado.agoraMs, 300);
  assert.equal(quadro.estado.colunas.esfriou.cartoes.length, 100);
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos[2].params.get("quantidade"), "150");
  quadro.controle.desmontar();
});

test("inserção no topo substitui o prefixo inteiro sem anexar ou duplicar o limite anterior", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  const resposta = coluna("incompleto", 99, 171);
  resposta.cartoes.unshift(cartao("novo-topo"));
  resposta.cartoes.push(resposta.cartoes[1]);
  await quadro.concluir(0, resposta);
  const ids = quadro.estado.colunas.incompleto.cartoes.map(item => item.id);
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100);
  assert.equal(ids[0], "novo-topo");
  assert.equal(ids.at(-1), "incompleto-98");
});

test("erro mantém cards e relógio; tentar novamente pede o mesmo limite e esconde erro bruto", async () => {
  const quadro = montar();
  const anterior = quadro.estado.colunas.incompleto;
  quadro.controle.carregarMais("incompleto");
  await quadro.falhar(0);
  assert.equal(quadro.estado.colunas.incompleto, anterior);
  assert.equal(quadro.estado.agoraMs, 100);
  assert.equal(quadro.estado.carregando.incompleto, false);
  assert.match(quadro.estado.errosCarga.incompleto!, /Tente novamente/);
  assert.doesNotMatch(quadro.estado.errosCarga.incompleto!, /segredo/);
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  await quadro.concluir(1, coluna("incompleto", 100));
  assert.equal(quadro.estado.errosCarga.incompleto, undefined);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 100);
});

test("HTTP sem sucesso, payload inválido ou erro parcial não removem o prefixo que a Mel já abriu", async () => {
  const respostas = [
    { valor: { coluna: coluna("incompleto", 100), agoraMs: 200 }, ok: false },
    { valor: { coluna: { ...coluna("incompleto", 100), erro: "consulta falhou" }, agoraMs: 200 }, ok: true },
    { valor: { coluna: { ...coluna("incompleto", 100), total: 1 }, agoraMs: 200 }, ok: true },
    { valor: { coluna: coluna("enviado", 100), agoraMs: 200 }, ok: true },
    { valor: { coluna: coluna("incompleto", 100), agoraMs: null }, ok: true },
  ];
  for (const resposta of respostas) {
    const quadro = montar();
    quadro.controle.carregarMais("incompleto");
    await quadro.responder(0, resposta.valor, resposta.ok);
    assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 50);
    assert.equal(quadro.estado.agoraMs, 100);
    assert.ok(quadro.estado.errosCarga.incompleto);
  }
});

test("último lote menor encerra a carga; aumento posterior do total mantém os passos de 50", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  await quadro.concluir(0, coluna("incompleto", 80, 80));
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos.length, 1);
  const novo = colunas();
  novo.incompleto.total = 120;
  quadro.atualizar({ colunas: novo, agoraMs: 300 });
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 80);
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  await quadro.concluir(1, coluna("incompleto", 100, 120), 400);
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos[2].params.get("quantidade"), "150");
  quadro.controle.desmontar();
});

test("realtime preserva a profundidade aberta e revalida o prefixo com a nova ordem do servidor", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("esfriou");
  await quadro.concluir(0, coluna("esfriou", 100));
  quadro.controle.carregarMais("esfriou");
  await quadro.concluir(1, coluna("esfriou", 150), 300);
  const novo = colunas();
  novo.esfriou.cartoes = [cartao("prioridade-vermelha", "esfriou"), ...novo.esfriou.cartoes.slice(0, 49)];
  novo.esfriou.total++;
  quadro.atualizar({ colunas: novo, agoraMs: 400 });
  assert.equal(quadro.estado.colunas.esfriou.cartoes.length, 150, "não reduz a lista para 50 durante o refresh");
  assert.equal(quadro.estado.colunas.esfriou.cartoes[0].id, "prioridade-vermelha");
  assert.equal(quadro.pedidos[2].params.get("status"), "esfriou");
  assert.equal(quadro.pedidos[2].params.get("quantidade"), "150");
  const reordenada = coluna("esfriou", 150, 171);
  reordenada.cartoes.reverse();
  await quadro.concluir(2, reordenada, 500);
  assert.equal(quadro.estado.colunas.esfriou.cartoes[0].id, "esfriou-149");
  assert.equal(quadro.estado.colunas.esfriou.cartoes.length, 150);
});

test("troca de filtros aborta a carga antiga, volta a 50 e rejeita resposta atrasada mesmo se fetch ignorar abort", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  const novos = colunas();
  novos.incompleto.cartoes[0] = cartao("resultado-da-busca");
  quadro.atualizar({ colunas: novos, filtros: { q: "Mel & João", categoria: "casamento", periodo: "mes" }, agoraMs: 110 });
  assert.equal(quadro.pedidos[0].sinal.aborted, true);
  await quadro.concluir(0, coluna("incompleto", 100), 900);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 50);
  assert.equal(quadro.estado.colunas.incompleto.cartoes[0].id, "resultado-da-busca");
  assert.equal(quadro.estado.agoraMs, 110);
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos[1].params.get("q"), "Mel & João");
  assert.equal(quadro.pedidos[1].params.get("categoria"), "casamento");
  assert.equal(quadro.pedidos[1].params.get("periodo"), "mes");
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  quadro.controle.desmontar();
});

test("SSR antigo do mesmo filtro não sobrescreve o prefixo mais recente nem atrasa o relógio", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  const recente = coluna("incompleto", 100);
  recente.cartoes[0] = cartao("dado-recente");
  await quadro.concluir(0, recente, 400);
  quadro.atualizar({ colunas: colunas(), agoraMs: 300 });
  assert.equal(quadro.estado.colunas.incompleto.cartoes[0].id, "dado-recente");
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 100);
  assert.equal(quadro.estado.agoraMs, 400);
  assert.equal(quadro.pedidos.length, 1);
});

test("movimento identificado pelo SSR remove o card da cauda antiga antes da revalidação", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  await quadro.concluir(0, coluna("incompleto", 100));
  const novos = colunas();
  novos.incompleto.total--;
  novos.enviado.cartoes[0] = cartao("incompleto-75", "enviado");
  novos.enviado.total++;
  quadro.atualizar({ colunas: novos, agoraMs: 300 });
  assert.equal(quadro.estado.colunas.incompleto.cartoes.some(item => item.id === "incompleto-75"), false);
  assert.equal(quadro.estado.colunas.enviado.cartoes[0].id, "incompleto-75");
  assert.equal(STATUS.flatMap(status => quadro.estado.colunas[status].cartoes).filter(item => item.id === "incompleto-75").length, 1);
  quadro.controle.desmontar();
});

test("respostas concorrentes de colunas diferentes respeitam o movimento mais recente sem duplicar card", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  quadro.controle.carregarMais("enviado");
  const enviado = coluna("enviado", 100);
  enviado.cartoes[0] = cartao("incompleto-75", "enviado");
  await quadro.concluir(1, enviado, 400);
  await quadro.concluir(0, coluna("incompleto", 100), 300);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.some(item => item.id === "incompleto-75"), false);
  assert.equal(quadro.estado.colunas.enviado.cartoes[0].id, "incompleto-75");
  assert.equal(quadro.estado.agoraMs, 400);
});

test("arrastar pausa carga, lista e relógio; retoma o mesmo limite com o último SSR depois de soltar", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  const antes = quadro.estado.colunas;
  quadro.atualizar({ pausado: true });
  assert.equal(quadro.pedidos[0].sinal.aborted, true);
  quadro.controle.carregarMais("esfriou");
  await quadro.concluir(0, coluna("incompleto", 100), 900);
  const novos = colunas();
  novos.incompleto.cartoes[0] = cartao("chegou-durante-arraste");
  quadro.atualizar({ colunas: novos, agoraMs: 300 });
  assert.equal(quadro.estado.colunas, antes);
  assert.equal(quadro.estado.agoraMs, 100);
  assert.equal(quadro.pedidos.length, 1);
  quadro.atualizar({ pausado: false });
  assert.equal(quadro.estado.colunas.incompleto.cartoes[0].id, "chegou-durante-arraste");
  assert.equal(quadro.estado.agoraMs, 300);
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  await quadro.concluir(1, coluna("incompleto", 100), 400);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 100);
  assert.equal(quadro.estado.agoraMs, 400);
});

test("fim da pausa sem SSR repete a carga interrompida, sem exigir novo clique e sem mostrar erro", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("esfriou");
  quadro.atualizar({ pausado: true });
  await quadro.falhar(0);
  assert.equal(quadro.estado.errosCarga.esfriou, undefined);
  quadro.atualizar({ pausado: false });
  assert.equal(quadro.pedidos.length, 2);
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  await quadro.concluir(1, coluna("esfriou", 100));
  assert.equal(quadro.estado.colunas.esfriou.cartoes.length, 100);
});

test("desmontar aborta e descarta resposta sem notificar; remontagem StrictMode revalida a carga interrompida", async () => {
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  quadro.controle.desmontar();
  const mudancas = quadro.mudancas;
  assert.equal(quadro.pedidos[0].sinal.aborted, true);
  await quadro.concluir(0, coluna("incompleto", 100), 900);
  assert.equal(quadro.mudancas, mudancas);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 50);
  assert.equal(quadro.estado.agoraMs, 100);
  quadro.controle.carregarMais("esfriou");
  assert.equal(quadro.pedidos.length, 1);
  quadro.controle.montar();
  assert.equal(quadro.pedidos.length, 2);
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  await quadro.concluir(1, coluna("incompleto", 100), 300);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 100);
});

test("SSR com falha numa coluna preserva cards disponíveis e não duplica o lead movido para outra", async () => {
  const quadro = montar();
  const novos = colunas();
  novos.incompleto = { cartoes: [], total: 0, erro: "falhou" };
  novos.enviado.cartoes[0] = cartao("incompleto-2", "enviado");
  quadro.atualizar({ colunas: novos, agoraMs: 200 });
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 49);
  assert.equal(quadro.estado.colunas.enviado.cartoes[0].id, "incompleto-2");
  assert.equal(quadro.pedidos[0].params.get("quantidade"), "50");
  await quadro.falhar(0);
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "50");
  quadro.controle.desmontar();
});

test("filtro trocado durante a pausa só publica o último contexto e começa com 50 ao retomar", async () => {
  const quadro = montar({ pausado: true });
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos.length, 0);
  const primeiro = colunas();
  primeiro.incompleto.cartoes[0] = cartao("filtro-intermediario");
  quadro.atualizar({ colunas: primeiro, filtros: { q: "intermediario", periodo: "todo" }, agoraMs: 200 });
  const ultimo = colunas();
  ultimo.incompleto.cartoes[0] = cartao("filtro-final");
  quadro.atualizar({ colunas: ultimo, filtros: { q: "final", periodo: "todo" }, agoraMs: 300 });
  assert.equal(quadro.estado.colunas.incompleto.cartoes[0].id, "incompleto-0");
  quadro.atualizar({ pausado: false });
  assert.equal(quadro.estado.colunas.incompleto.cartoes[0].id, "filtro-final");
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 50);
  assert.equal(quadro.estado.agoraMs, 300);
  assert.equal(quadro.pedidos.length, 0);
});

test("rede sem resposta expira em 30s, libera retry do mesmo prefixo e descarta a resposta tardia", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const quadro = montar();
  quadro.controle.carregarMais("incompleto");
  t.mock.timers.tick(29_999);
  assert.equal(quadro.estado.carregando.incompleto, true);
  t.mock.timers.tick(1);
  assert.equal(quadro.pedidos[0].sinal.aborted, true);
  assert.equal(quadro.estado.carregando.incompleto, false);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 50);
  assert.equal(quadro.estado.agoraMs, 100);
  assert.ok(quadro.estado.errosCarga.incompleto);
  quadro.controle.carregarMais("incompleto");
  assert.equal(quadro.pedidos[1].params.get("quantidade"), "100");
  await quadro.concluir(0, coluna("incompleto", 100), 900);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 50);
  await quadro.concluir(1, coluna("incompleto", 100), 300);
  assert.equal(quadro.estado.colunas.incompleto.cartoes.length, 100);
  assert.equal(quadro.estado.agoraMs, 300);
  assert.equal(quadro.estado.errosCarga.incompleto, undefined);
});
