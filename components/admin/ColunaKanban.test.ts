import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ComponentProps } from "react";
import type { ColunaKanban } from "./ColunaKanban";

type Props = ComponentProps<typeof ColunaKanban>;
type Elemento = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
type Efeito = { deps?: readonly unknown[]; limpar?: () => void };
type Observador = {
  callback: (entradas: { isIntersecting: boolean }[]) => void;
  opcoes: IntersectionObserverInit;
  elementos: unknown[];
  desconectado: boolean;
};
const fonte = ts.transpileModule(readFileSync(new URL("./ColunaKanban.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function elementos(arvore: unknown): Elemento[] {
  if (Array.isArray(arvore)) return arvore.flatMap(elementos);
  if (!arvore || typeof arvore !== "object" || !("props" in arvore)) return [];
  const elemento = arvore as Elemento;
  return [elemento, ...elementos(elemento.props.children)];
}

function texto(arvore: unknown): string {
  if (typeof arvore === "string" || typeof arvore === "number") return String(arvore);
  if (Array.isArray(arvore)) return arvore.map(texto).join("");
  if (arvore && typeof arvore === "object" && "props" in arvore) return texto((arvore as Elemento).props.children);
  return "";
}

/** Simula commits, refs e cleanup do React; nunca abre navegador nem busca dados. */
function montar(iniciais: Partial<Props> = {}, comObservador = true) {
  const slots: unknown[] = [];
  const efeitos = new Map<number, Efeito>();
  const pendentes: { indice: number; efeito: () => void | (() => void); deps?: readonly unknown[] }[] = [];
  const observadores: Observador[] = [];
  let indice = 0;
  let cargas = 0;
  const sentinela = { id: "rodape-ficticio" };
  let props: Props = {
    status: "perdido", total: 125, mostrando: 50, aberta: true,
    onAlternar() {}, onCarregarMais: () => { cargas++; }, children: "Cards fictícios", ...iniciais,
  };
  const mod: { exports: { ColunaKanban?: (p: Props) => Elemento } } = { exports: {} };
  const jsx = (type: unknown, p: Elemento["props"]) => ({ type, props: p });
  runInNewContext(fonte, {
    exports: mod.exports,
    IntersectionObserver: comObservador ? class {
      registro: Observador;
      constructor(callback: Observador["callback"], opcoes: IntersectionObserverInit) {
        this.registro = { callback, opcoes, elementos: [], desconectado: false };
        observadores.push(this.registro);
      }
      observe(elemento: unknown) { this.registro.elementos.push(elemento); }
      disconnect() { this.registro.desconectado = true; }
    } : undefined,
    require(nome: string) {
      if (nome === "react") return {
        useRef<T>(inicial: T) {
          const posicao = indice++;
          if (!(posicao in slots)) slots[posicao] = { current: inicial };
          return slots[posicao];
        },
        useEffect(efeito: () => void | (() => void), deps?: readonly unknown[]) {
          const posicao = indice++;
          const anterior = efeitos.get(posicao);
          if (!anterior || !deps || !anterior.deps || deps.some((valor, i) => !Object.is(valor, anterior.deps![i]))) {
            pendentes.push({ indice: posicao, efeito, deps });
          }
        },
      };
      if (nome === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (nome === "lucide-react") return { ChevronDown: "ChevronDown", LoaderCircle: "LoaderCircle" };
      if (nome === "@/lib/admin/rotulos") return {
        TEMA_COLUNA: { perdido: {} }, ROTULO_STATUS: { perdido: "Lead perdido" },
      };
      if (nome === "@/lib/admin/paginacao-kanban") return { TAMANHO_LOTE_KANBAN: 50 };
      if (nome === "@/lib/utils") return { cn: (...classes: unknown[]) => classes.filter(Boolean).join(" ") };
      throw new Error(`Importação inesperada: ${nome}`);
    },
  });
  function render(alteracoes: Partial<Props> = {}) {
    props = { ...props, ...alteracoes };
    indice = 0;
    const arvore = mod.exports.ColunaKanban!(props);
    for (const elemento of elementos(arvore)) {
      const ref = elemento.props.ref;
      if (ref && typeof ref === "object" && "current" in ref) ref.current = sentinela;
    }
    for (const proximo of pendentes.splice(0)) {
      efeitos.get(proximo.indice)?.limpar?.();
      efeitos.set(proximo.indice, { deps: proximo.deps, limpar: proximo.efeito() || undefined });
    }
    return arvore;
  }
  return { render, observadores, get cargas() { return cargas; },
    desmontar() { for (const efeito of efeitos.values()) efeito.limpar?.(); },
  };
}

test("sentinela observa o rodapé, carrega ao entrar na viewport e usa o callback recente", () => {
  const tela = montar();
  tela.render();
  const observador = tela.observadores[0];
  assert.equal(observador.opcoes.root, null);
  assert.equal(observador.elementos.length, 1);
  assert.match(observador.opcoes.rootMargin!, /120px/);
  observador.callback([{ isIntersecting: false }]);
  assert.equal(tela.cargas, 0);
  observador.callback([{ isIntersecting: false }, { isIntersecting: true }]);
  assert.equal(tela.cargas, 1);
  let cargasNovas = 0;
  tela.render({ onCarregarMais: () => { cargasNovas++; } });
  assert.equal(tela.observadores.length, 1, "trocar o callback não precisa refazer o observador");
  observador.callback([{ isIntersecting: true }]);
  assert.equal(cargasNovas, 1);
  assert.equal(tela.cargas, 1);
});

test("carga, erro, pausa e fim da lista desligam o observador e invalidam callbacks antigos", () => {
  const tela = montar();
  tela.render();
  let anterior = tela.observadores.at(-1)!;
  for (const bloqueio of [
    { carregando: true }, { erroCarga: "Falha fictícia" }, { cargaPausada: true },
    { mostrando: 125 }, { onCarregarMais: undefined },
  ]) {
    const quantidade = tela.observadores.length;
    tela.render(bloqueio);
    assert.equal(anterior.desconectado, true);
    anterior.callback([{ isIntersecting: true }]);
    assert.equal(tela.cargas, 0, "callback enfileirado antes do cleanup não carrega outra página");
    assert.equal(tela.observadores.length, quantidade);
    tela.render({ carregando: false, erroCarga: undefined, cargaPausada: false, mostrando: 50, onCarregarMais() {} });
    anterior = tela.observadores.at(-1)!;
    assert.equal(anterior.desconectado, false);
  }
  tela.desmontar();
  assert.equal(anterior.desconectado, true);
  anterior.callback([{ isIntersecting: true }]);
  assert.equal(tela.cargas, 0);
});

test("accordion fechado conserva a coluna visível por CSS no desktop e a paginação ativa", () => {
  const tela = montar({ aberta: false });
  const arvore = tela.render();
  const corpo = elementos(arvore).find((elemento) => elemento.props.id === "coluna-perdido");
  assert.match(String(corpo?.props.className), /hidden sm:block/);
  assert.equal(tela.observadores.length, 1, "aberta=false só deve ocultar o corpo no celular");
  tela.observadores[0].callback([{ isIntersecting: true }]);
  assert.equal(tela.cargas, 1);
  tela.render({ aberta: true });
  assert.equal(tela.observadores[0].desconectado, true);
  assert.equal(tela.observadores.length, 2);
});

test("sem IntersectionObserver há botão acessível; erro permite tentar novamente e carga anuncia o estado", () => {
  const tela = montar({}, false);
  const arvore = tela.render();
  const botao = elementos(arvore).find((elemento) => elemento.type === "button" && elemento.props["aria-label"]);
  assert.equal(botao?.props["aria-label"], "Carregar mais cards de Lead perdido");
  (botao?.props.onClick as () => void)();
  assert.equal(tela.cargas, 1);
  const comErro = tela.render({ erroCarga: "Não consegui carregar os próximos cards." });
  assert.equal(elementos(comErro).find((elemento) => elemento.props.role === "alert")?.props.children,
    "Não consegui carregar os próximos cards.");
  const tentar = elementos(comErro).find((elemento) => elemento.props["aria-label"] === "Tentar novamente em Lead perdido");
  assert.ok(tentar);
  (tentar.props.onClick as () => void)();
  assert.equal(tela.cargas, 2);
  const pausada = tela.render({ erroCarga: undefined, cargaPausada: true });
  assert.equal(elementos(pausada).find((elemento) => elemento.props["aria-label"])?.props.disabled, true);
  const carregando = tela.render({ cargaPausada: false, carregando: true });
  assert.match(texto(elementos(carregando).find((elemento) => elemento.props.role === "status")), /Carregando mais cards/);
  assert.equal(elementos(carregando).some((elemento) => elemento.type === "button" && elemento.props["aria-label"]), false);
  assert.equal(elementos(carregando).find((elemento) => elemento.props.id === "coluna-perdido")?.props["aria-busy"], true);
});

test("lista totalmente carregada informa total sem repetir botão ou observador", () => {
  const tela = montar({ total: 73, mostrando: 73 });
  const arvore = tela.render();
  assert.match(texto(arvore), /Mostrando 73 de 73/);
  assert.equal(tela.observadores.length, 0);
  assert.equal(elementos(arvore).some((elemento) => elemento.type === "button" && elemento.props["aria-label"]), false);
});
