import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ComponentProps } from "react";
import type { BotaoLembrete } from "./BotaoLembrete";

type Props = ComponentProps<typeof BotaoLembrete>;
type Elemento = { type: string; props: { children?: unknown; onClick?: () => Promise<void>; [key: string]: unknown } };

// Montagem rasa com hooks persistentes: exercita os cliques e as atualizações
// reais do componente, sem DOM, roteador, rede ou envio de WhatsApp.
const fonte = ts.transpileModule(readFileSync(new URL("./BotaoLembrete.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function montar(inicial: Partial<Props> = {}) {
  const slots: unknown[] = [];
  let indice = 0;
  let props: Props = {
    id: "lead-ficticio", nome: "Cliente fictício", marco: 7,
    propostaEnviadoEm: "2026-09-01T12:00:00.000001Z", ...inicial,
  };
  const chamadas: { url: string; body: string }[] = [];
  const avisos: { tipo: string; texto: string }[] = [];
  let atualizacoes = 0;
  let resposta: (valor: { ok: boolean; json(): Promise<unknown> }) => void;
  const mod: { exports: { BotaoLembrete?: (p: Props) => Elemento | null } } = { exports: {} };
  const jsx = (type: string, props: Elemento["props"]) => ({ type, props });
  runInNewContext(fonte, {
    exports: mod.exports,
    require(nome: string) {
      if (nome === "react") return {
        useState<T>(inicial: T) {
          const posicao = indice++;
          if (!(posicao in slots)) slots[posicao] = inicial;
          return [slots[posicao], (valor: T) => { slots[posicao] = valor; }];
        },
        useRef<T>(inicial: T) {
          const posicao = indice++;
          if (!(posicao in slots)) slots[posicao] = { current: inicial };
          return slots[posicao];
        },
      };
      if (nome === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (nome === "next/navigation") return { useRouter: () => ({ refresh: () => { atualizacoes++; } }) };
      if (nome === "lucide-react") return { MessageCircle: "icone" };
      if (nome === "sonner") return { toast: Object.fromEntries(["success", "info", "error"].map((tipo) => [
        tipo, (texto: string) => avisos.push({ tipo, texto }),
      ])) };
      if (nome === "@/lib/admin/lembretes") return { ROTULO_LEMBRETE: { 7: "Relembrar cliente", 30: "Última tentativa" } };
      if (nome === "@/lib/utils") return { cn: (...classes: unknown[]) => classes.filter(Boolean).join(" ") };
      throw new Error(`Importação inesperada no teste: ${nome}`);
    },
    fetch(url: string, opcoes: { body: string }) {
      chamadas.push({ url, body: opcoes.body });
      return new Promise((resolve) => { resposta = resolve; });
    },
  });
  return {
    chamadas, avisos,
    get atualizacoes() { return atualizacoes; },
    render(alteracoes: Partial<Props> = {}) {
      props = { ...props, ...alteracoes };
      indice = 0;
      return mod.exports.BotaoLembrete!(props);
    },
    responder(estado: string, ok = true) {
      resposta({ ok, json: async () => ({ ok, estado, erro: ok ? undefined : "Envio recusado." }) });
    },
  };
}

function botao(elemento: Elemento | null): Elemento {
  assert.ok(elemento, "a ação deve estar visível");
  const filhos = Array.isArray(elemento.props.children) ? elemento.props.children : [elemento.props.children];
  const encontrado = filhos.find((filho): filho is Elemento => !!filho && typeof filho === "object" && filho.type === "button");
  assert.ok(encontrado, "o rodapé deve ter um botão");
  return encontrado;
}

test("ação some no primeiro clique e clique simultâneo não duplica o POST", async () => {
  const tela = montar();
  const acao = botao(tela.render()).props.onClick!;
  const envio = acao();
  assert.equal(tela.render(), null);
  await acao();
  assert.equal(tela.chamadas.length, 1);
  assert.deepEqual(JSON.parse(tela.chamadas[0].body), { marco: 7 });
  tela.responder("pendente");
  await envio;
  assert.equal(tela.render(), null);
  assert.equal(tela.atualizacoes, 1);
});

for (const estado of ["pendente", "reservado", "enviando", "enviado", "indeterminado", "expirado", "cancelado"] as const) {
  test(`estado ${estado} não deixa botão, frase ou rodapé vazio`, () => {
    const tela = montar({ solicitacao: {
      tipo: "lembrete_proposta_7d", estado, ocorrido_em: "2026-10-15T12:00:00Z",
      proposta_enviado_em: "2026-09-01T12:00:00.000001Z", motivo: "Motivo que não deve aparecer.",
    } });
    assert.equal(tela.render(), null);
  });
}

test("ACK confirmado oculta a ação mesmo sem o resumo da fila", () => {
  assert.equal(montar({ confirmado: true }).render(), null);
});

test("recusa do POST devolve o botão e permite novo clique explícito", async () => {
  const tela = montar();
  const primeiro = botao(tela.render()).props.onClick!();
  tela.responder("cancelado", false);
  await primeiro;
  assert.equal(tela.avisos.at(-1)?.tipo, "error");
  const segundo = botao(tela.render()).props.onClick!();
  assert.equal(tela.chamadas.length, 2);
  tela.responder("pendente");
  await segundo;
});

test("cancelamento reativável após enfileirar libera novo clique", async () => {
  const tela = montar();
  const envio = botao(tela.render()).props.onClick!();
  tela.responder("pendente");
  await envio;
  assert.equal(tela.render(), null);
  const revisado = tela.render({ solicitacao: {
    tipo: "lembrete_proposta_7d", estado: "cancelado", ocorrido_em: "2026-10-15T12:00:00Z",
    proposta_enviado_em: "2026-09-01T12:00:00.000001Z", motivo: "Histórico insuficiente.", reenvioPermitido: true,
  } });
  const novaTentativa = botao(revisado).props.onClick!();
  assert.equal(tela.chamadas.length, 2);
  tela.responder("pendente");
  await novaTentativa;
});

test("cancelamento definitivo ou sem decisão explícita nunca oferece o botão", () => {
  for (const reenvioPermitido of [false, undefined]) {
    const tela = montar({ solicitacao: {
      tipo: "lembrete_proposta_7d", estado: "cancelado", ocorrido_em: "2026-10-15T12:00:00Z",
      proposta_enviado_em: "2026-09-01T12:00:00.000001Z", motivo: "Condição definitiva.", reenvioPermitido,
    } });
    assert.equal(tela.render(), null);
  }
});

test("expiração não aceita liberação de nova tentativa mesmo com booleano incompatível", () => {
  const tela = montar({ solicitacao: {
    tipo: "lembrete_proposta_7d", estado: "expirado", ocorrido_em: "2026-10-15T12:00:00Z",
    proposta_enviado_em: "2026-09-01T12:00:00.000001Z", motivo: null, reenvioPermitido: true,
  } });
  assert.equal(tela.render(), null);
});

test("trocar marco, lead ou revisão não herda a ocultação otimista anterior", async () => {
  for (const alteracoes of [
    { marco: 30 as const },
    { id: "outro-lead-ficticio" },
    // Mesmos milissegundos: a identidade conserva a revisão exata do banco.
    { propostaEnviadoEm: "2026-09-01T12:00:00.000002Z" },
  ]) {
    const tela = montar();
    const envio = botao(tela.render()).props.onClick!();
    tela.responder("enviado");
    await envio;
    assert.equal(tela.render(), null);
    assert.ok(botao(tela.render(alteracoes)));
  }
});

test("servidor que informa ACK de outra aba mantém a ação oculta", async () => {
  const tela = montar();
  const envio = botao(tela.render()).props.onClick!();
  tela.responder("enviado");
  await envio;
  assert.equal(tela.render(), null);
  assert.equal(tela.chamadas.length, 1);
});
