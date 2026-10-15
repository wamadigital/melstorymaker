import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const fonte = ts.transpileModule(readFileSync(new URL("./useQuadroAoVivo.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Props = { pausado: boolean; atualizar: () => void; atrasoMs?: number | null };
type Efeito = { deps: readonly unknown[] | undefined; limpar?: () => void };

/** Hooks, eventos e relógio locais; não cria conexão, sessão ou timer real. */
function montar(inicial: Partial<Omit<Props, "atualizar">> = {}) {
  const slots: unknown[] = [];
  const efeitos = new Map<number, Efeito>();
  const pendentes: { indice: number; efeito: () => void | (() => void); deps: readonly unknown[] | undefined }[] = [];
  const timers = new Map<number, { em: number; executar: () => void }>();
  const listeners = new Map<string, () => void>();
  let indice = 0;
  let numeroTimer = 0;
  let agora = 0;
  let atualizacoes = 0;
  const documento = { visibilityState: "visible",
    addEventListener: (nome: string, acao: () => void) => listeners.set(nome, acao),
    removeEventListener: (nome: string) => listeners.delete(nome) };
  let props: Props = { pausado: false, atualizar: () => { atualizacoes++; }, ...inicial };
  const mod: { exports: { useQuadroAoVivo?: (p: Props) => void } } = { exports: {} };
  runInNewContext(fonte, {
    exports: mod.exports, document: documento, Date: { now: () => agora }, console,
    setTimeout(executar: () => void, atraso: number) {
      const id = ++numeroTimer;
      timers.set(id, { em: agora + atraso, executar });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    require(nome: string) {
      if (nome === "react") return {
        useRef<T>(valor: T) {
          const posicao = indice++;
          if (!(posicao in slots)) slots[posicao] = { current: valor };
          return slots[posicao];
        },
        useEffect(efeito: () => void | (() => void), deps?: readonly unknown[]) {
          const posicao = indice++;
          const anterior = efeitos.get(posicao);
          if (!anterior || !deps || !anterior.deps || deps.some((item, i) => !Object.is(item, anterior.deps![i]))) {
            pendentes.push({ indice: posicao, efeito, deps });
          }
        },
      };
      if (nome === "@/lib/admin/tempo-real") return {
        AUSENCIA_MAX_MS: 60_000, EVENTO_QUADRO: "mudou", JANELA_AVISO_MS: 1000, TOPICO_QUADRO: "quadro-leads",
      };
      if (nome === "@/lib/supabase/client") return {
        criarClienteNavegador: () => ({
          // Aguardado para sempre: o teste verifica apenas prazo/visibilidade.
          realtime: { setAuth: () => new Promise(() => undefined) },
        }),
      };
      throw new Error(`Importação inesperada: ${nome}`);
    },
  });
  const render = (alteracoes: Partial<Props> = {}) => {
    props = { ...props, ...alteracoes };
    indice = 0;
    mod.exports.useQuadroAoVivo!(props);
    for (const proximo of pendentes.splice(0)) {
      efeitos.get(proximo.indice)?.limpar?.();
      efeitos.set(proximo.indice, { deps: proximo.deps, limpar: proximo.efeito() || undefined });
    }
  };
  render();
  return {
    render,
    get atualizacoes() { return atualizacoes; },
    get proximosAtrasos() { return [...timers.values()].map((timer) => timer.em - agora); },
    avancar(ms: number) {
      const alvo = agora + ms;
      while (true) {
        const proximo = [...timers.entries()].filter(([, timer]) => timer.em <= alvo)
          .sort((a, b) => a[1].em - b[1].em)[0];
        if (!proximo) break;
        agora = proximo[1].em;
        timers.delete(proximo[0]);
        proximo[1].executar();
      }
      agora = alvo;
    },
    visibilidade(estado: "hidden" | "visible") {
      documento.visibilityState = estado;
      listeners.get("visibilitychange")?.();
    },
    desmontar() { for (const efeito of efeitos.values()) efeito.limpar?.(); },
  };
}

test("prazo faz uma releitura só e nenhum polling depois, usando callback recente", () => {
  const quadro = montar({ atrasoMs: 5000 });
  quadro.avancar(4999);
  assert.equal(quadro.atualizacoes, 0);
  let novoCallback = 0;
  quadro.render({ atualizar: () => { novoCallback++; } });
  quadro.avancar(1);
  assert.equal(novoCallback, 1);
  quadro.avancar(86_400_000);
  assert.equal(novoCallback, 1);
  assert.deepEqual(quadro.proximosAtrasos, []);
});

test("vencimento durante arraste espera o fim; aba escondida espera ficar visível", () => {
  const quadro = montar({ atrasoMs: 5000, pausado: true });
  quadro.avancar(5000);
  assert.equal(quadro.atualizacoes, 0);
  quadro.visibilidade("hidden");
  quadro.render({ pausado: false });
  assert.equal(quadro.atualizacoes, 0, "soltar cartão não atualiza uma aba ainda escondida");
  quadro.visibilidade("visible");
  assert.equal(quadro.atualizacoes, 1);
  quadro.render({ atrasoMs: 2000 });
  quadro.visibilidade("hidden");
  quadro.avancar(2000);
  assert.equal(quadro.atualizacoes, 1);
  quadro.visibilidade("visible");
  assert.equal(quadro.atualizacoes, 2);
});

test("visibilidade não libera atualização enquanto o arraste estiver em curso", () => {
  const quadro = montar({ atrasoMs: 1, pausado: true });
  quadro.visibilidade("hidden");
  quadro.avancar(1);
  quadro.visibilidade("visible");
  assert.equal(quadro.atualizacoes, 0);
  quadro.render({ pausado: false });
  assert.equal(quadro.atualizacoes, 1);
});

test("novo snapshot cancela o prazo anterior, null e unmount limpam timers", () => {
  const quadro = montar({ atrasoMs: 5000 });
  quadro.avancar(1000);
  quadro.render({ atrasoMs: 10_000 });
  quadro.avancar(4000);
  assert.equal(quadro.atualizacoes, 0);
  quadro.render({ atrasoMs: null });
  assert.deepEqual(quadro.proximosAtrasos, []);
  quadro.avancar(10_000);
  assert.equal(quadro.atualizacoes, 0);
  quadro.render({ atrasoMs: 2000 });
  quadro.desmontar();
  quadro.avancar(2000);
  assert.equal(quadro.atualizacoes, 0);
});

test("prazos maiores que o limite nativo aguardam segmentos sem refresh intermediário", () => {
  const limite = 2_147_483_647;
  const quadro = montar({ atrasoMs: limite + 5000 });
  assert.deepEqual(quadro.proximosAtrasos, [limite]);
  quadro.avancar(limite);
  assert.equal(quadro.atualizacoes, 0);
  assert.deepEqual(quadro.proximosAtrasos, [5000]);
  quadro.avancar(5000);
  assert.equal(quadro.atualizacoes, 1);
});
