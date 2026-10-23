import { useEffect, useState, useSyncExternalStore } from "react";
import type { FiltrosNavegacao } from "@/lib/admin/navegacao";
import { TAMANHO_LOTE_KANBAN, type ColunaKanbanDados } from "@/lib/admin/paginacao-kanban";
import { STATUS, type Status } from "@/lib/form/types";

type Colunas = Record<Status, ColunaKanbanDados>;
export type EstadoColunasPaginadas = {
  colunas: Colunas;
  carregando: Partial<Record<Status, boolean>>;
  errosCarga: Partial<Record<Status, string>>;
  agoraMs: number;
};
type Props = { colunas: Colunas; filtros: FiltrosNavegacao; agoraMs: number; pausado: boolean };
type RespostaColuna = { coluna: ColunaKanbanDados; agoraMs: number };
type Buscar = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;
const ERRO_CARGA = "Não consegui carregar os próximos leads. Tente novamente.";
const PRAZO_CARGA_MS = 30_000;

const chaveFiltros = (filtros: FiltrosNavegacao) =>
  JSON.stringify([filtros.q, filtros.categoria ?? null, filtros.periodo]);

function copiarColunas(colunas: Colunas): Colunas {
  const ids = new Set<string>();
  return Object.fromEntries(STATUS.map(status => [status, {
    ...colunas[status],
    cartoes: colunas[status].cartoes.filter(cartao => {
      if (cartao.status !== status || ids.has(cartao.id)) return false;
      ids.add(cartao.id);
      return true;
    }),
  }])) as Colunas;
}

function respostaValida(valor: unknown, status: Status): valor is RespostaColuna {
  if (!valor || typeof valor !== "object") return false;
  const resposta = valor as Partial<RespostaColuna>;
  const coluna = resposta.coluna;
  return typeof resposta.agoraMs === "number" && Number.isFinite(resposta.agoraMs)
    && !!coluna && Array.isArray(coluna.cartoes)
    && Number.isSafeInteger(coluna.total) && coluna.total >= coluna.cartoes.length
    && (coluna.erro === null || typeof coluna.erro === "string")
    && coluna.cartoes.every(cartao => cartao && typeof cartao.id === "string" && cartao.status === status);
}

/**
 * Cada chamada relê o prefixo inteiro da coluna. Não anexamos páginas antigas:
 * uma inserção no topo entre 50 e 100, ou uma mudança de prioridade em Esfriou,
 * precisa aparecer uma única vez na posição atual. O controlador também torna
 * essas corridas testáveis sem sessão, banco ou relógio do navegador.
 */
export function criarControleColunasPaginadas(inicial: Props, buscar: Buscar = fetch) {
  let estado: EstadoColunasPaginadas = {
    colunas: copiarColunas(inicial.colunas), carregando: {}, errosCarga: {}, agoraMs: inicial.agoraMs,
  };
  let filtros = inicial.filtros;
  let chave = chaveFiltros(filtros);
  let ultimoSnapshot = inicial.colunas;
  let ultimoRelogio = inicial.agoraMs;
  let pausado = inicial.pausado;
  let ativo = true;
  let geracao = 0;
  let snapshotPendente: Props | null = null;
  const ouvintes = new Set<() => void>();
  const limites = new Map<Status, number>(STATUS.map(status => [status,
    Math.max(TAMANHO_LOTE_KANBAN,
      Math.ceil(inicial.colunas[status].cartoes.length / TAMANHO_LOTE_KANBAN) * TAMANHO_LOTE_KANBAN),
  ]));
  const retomar = new Map<Status, number>();
  const emCurso = new Map<Status, {
    controle: AbortController; limite: number; geracao: number; prazo?: ReturnType<typeof setTimeout>;
  }>();
  // Um prefixo recente de outra coluna prevalece sobre uma resposta concorrente
  // mais antiga que ainda traz o lead antes do movimento.
  const localizacoes = new Map<string, { status: Status; agoraMs: number }>();
  for (const status of STATUS) {
    for (const cartao of estado.colunas[status].cartoes) localizacoes.set(cartao.id, { status, agoraMs: inicial.agoraMs });
  }

  const publicar = (proximo: EstadoColunasPaginadas) => {
    estado = proximo;
    if (ativo) for (const ouvinte of ouvintes) ouvinte();
  };
  const cancelar = () => {
    geracao++;
    for (const [status, pedido] of emCurso) {
      retomar.set(status, pedido.limite);
      clearTimeout(pedido.prazo);
      pedido.controle.abort();
    }
    emCurso.clear();
  };

  const requisitar = (status: Status, limite: number) => {
    if (!ativo || pausado || emCurso.has(status)) return;
    limites.set(status, limite);
    retomar.delete(status);
    const pedido: { controle: AbortController; limite: number; geracao: number; prazo?: ReturnType<typeof setTimeout> } = {
      controle: new AbortController(), limite, geracao,
    };
    emCurso.set(status, pedido);
    pedido.prazo = setTimeout(() => {
      if (!ativo || pausado || geracao !== pedido.geracao || emCurso.get(status) !== pedido) return;
      pedido.controle.abort();
      emCurso.delete(status);
      publicar({ ...estado, carregando: { ...estado.carregando, [status]: false },
        errosCarga: { ...estado.errosCarga, [status]: ERRO_CARGA } });
    }, PRAZO_CARGA_MS);
    publicar({ ...estado, carregando: { ...estado.carregando, [status]: true },
      errosCarga: { ...estado.errosCarga, [status]: undefined } });
    const params = new URLSearchParams({ status, quantidade: String(limite) });
    if (filtros.q) params.set("q", filtros.q);
    if (filtros.categoria) params.set("categoria", filtros.categoria);
    if (filtros.periodo !== "todo") params.set("periodo", filtros.periodo);
    void (async () => {
      try {
        const resposta = await buscar(`/api/admin/leads/coluna?${params}`, {
          signal: pedido.controle.signal, cache: "no-store", credentials: "same-origin",
        });
        if (!resposta.ok) throw new Error(ERRO_CARGA);
        const dados: unknown = await resposta.json();
        if (!respostaValida(dados, status) || dados.coluna.erro) throw new Error(ERRO_CARGA);
        if (!ativo || pausado || geracao !== pedido.geracao || emCurso.get(status) !== pedido) return;
        const ids = new Set<string>();
        const cartoes = dados.coluna.cartoes.filter(cartao => {
          const localizacao = localizacoes.get(cartao.id);
          if (ids.has(cartao.id) || (localizacao && localizacao.status !== status && localizacao.agoraMs > dados.agoraMs)) return false;
          ids.add(cartao.id);
          localizacoes.set(cartao.id, { status, agoraMs: dados.agoraMs });
          return true;
        });
        const colunas = Object.fromEntries(STATUS.map(coluna => [coluna, coluna === status
          ? { ...dados.coluna, cartoes }
          : { ...estado.colunas[coluna], cartoes: estado.colunas[coluna].cartoes.filter(cartao => !ids.has(cartao.id)) },
        ])) as Colunas;
        emCurso.delete(status);
        publicar({ ...estado, colunas, agoraMs: Math.max(estado.agoraMs, dados.agoraMs),
          carregando: { ...estado.carregando, [status]: false },
          errosCarga: { ...estado.errosCarga, [status]: undefined } });
      } catch {
        if (!ativo || pausado || geracao !== pedido.geracao || emCurso.get(status) !== pedido) return;
        emCurso.delete(status);
        publicar({ ...estado, carregando: { ...estado.carregando, [status]: false },
          errosCarga: { ...estado.errosCarga, [status]: ERRO_CARGA } });
      } finally {
        clearTimeout(pedido.prazo);
      }
    })();
  };

  const aplicarSnapshot = (props: Props) => {
    const novaChave = chaveFiltros(props.filtros);
    const trocouFiltro = novaChave !== chave;
    const novos = copiarColunas(props.colunas);
    filtros = props.filtros;
    chave = novaChave;
    const revalidar = new Map<Status, number>();
    const errosCarga: EstadoColunasPaginadas["errosCarga"] = {};
    if (trocouFiltro) {
      localizacoes.clear();
      retomar.clear();
      for (const status of STATUS) limites.set(status, TAMANHO_LOTE_KANBAN);
    }
    const idsNovos = new Set(STATUS.flatMap(status => novos[status].cartoes.map(cartao => cartao.id)));
    for (const status of STATUS) {
      for (const cartao of novos[status].cartoes) localizacoes.set(cartao.id, { status, agoraMs: props.agoraMs });
    }
    const colunas = Object.fromEntries(STATUS.map(status => {
      const limite = limites.get(status)!;
      const novo = novos[status];
      if (!trocouFiltro && novo.erro) {
        errosCarga[status] = ERRO_CARGA;
        revalidar.set(status, limite);
        return [status, { ...estado.colunas[status], cartoes: estado.colunas[status].cartoes
          .filter(cartao => !idsNovos.has(cartao.id) || localizacoes.get(cartao.id)?.status === status) }];
      }
      if (!trocouFiltro && limite > TAMANHO_LOTE_KANBAN) {
        // Mantém a profundidade visível durante a releitura. IDs que o SSR já
        // colocou em outra coluna saem daqui imediatamente.
        const cauda = estado.colunas[status].cartoes.filter(cartao => !idsNovos.has(cartao.id));
        revalidar.set(status, limite);
        return [status, { ...novo, cartoes: [...novo.cartoes, ...cauda].slice(0, Math.min(limite, novo.total)) }];
      }
      return [status, novo];
    })) as Colunas;
    for (const [status, limite] of retomar) if (!trocouFiltro) revalidar.set(status, limite);
    retomar.clear();
    publicar({ colunas: copiarColunas(colunas), carregando: {}, errosCarga,
      agoraMs: trocouFiltro ? props.agoraMs : Math.max(estado.agoraMs, props.agoraMs) });
    for (const [status, limite] of revalidar) requisitar(status, limite);
  };

  return {
    ler: () => estado,
    assinar: (ouvinte: () => void) => { ouvintes.add(ouvinte); return () => { ouvintes.delete(ouvinte); }; },
    carregarMais: (status: Status) => {
      if (!ativo || pausado || emCurso.has(status)) return;
      const coluna = estado.colunas[status];
      const repetir = !!estado.errosCarga[status] || retomar.has(status);
      if (!repetir && coluna.cartoes.length >= coluna.total) return;
      requisitar(status, repetir ? (retomar.get(status) ?? limites.get(status)!)
        : limites.get(status)! + TAMANHO_LOTE_KANBAN);
    },
    atualizar: (props: Props) => {
      const mudouPausa = pausado !== props.pausado;
      if (props.pausado && mudouPausa) {
        pausado = true;
        cancelar();
        publicar({ ...estado, carregando: {} });
      } else pausado = props.pausado;
      const mudouSnapshot = props.colunas !== ultimoSnapshot || props.agoraMs !== ultimoRelogio
        || chaveFiltros(props.filtros) !== chave;
      ultimoSnapshot = props.colunas;
      ultimoRelogio = props.agoraMs;
      // Uma navegação iniciada antes de um prefixo já aceito não recoloca o
      // snapshot antigo por cima dele. A troca de filtro continua autoritativa.
      if (mudouSnapshot && (chaveFiltros(props.filtros) !== chave || props.agoraMs >= estado.agoraMs)) {
        cancelar();
        snapshotPendente = props;
      }
      if (!ativo || pausado) return;
      if (snapshotPendente) {
        const pendente = snapshotPendente;
        snapshotPendente = null;
        aplicarSnapshot(pendente);
      } else if (mudouPausa) {
        for (const [status, limite] of [...retomar]) requisitar(status, limite);
      }
    },
    montar: () => {
      ativo = true;
      if (!pausado) for (const [status, limite] of [...retomar]) requisitar(status, limite);
    },
    desmontar: () => {
      ativo = false;
      cancelar();
      estado = { ...estado, carregando: {} };
    },
  };
}

export function useColunasPaginadas({ colunas, filtros, agoraMs, pausado }: Props) {
  const [controle] = useState(() => criarControleColunasPaginadas({ colunas, filtros, agoraMs, pausado }));
  const estado = useSyncExternalStore(controle.assinar, controle.ler, controle.ler);
  useEffect(() => {
    controle.montar();
    return controle.desmontar;
  }, [controle]);
  useEffect(() => { controle.atualizar({ colunas, filtros, agoraMs, pausado }); }, [controle, colunas, filtros, agoraMs, pausado]);
  return { ...estado, carregarMais: controle.carregarMais };
}
