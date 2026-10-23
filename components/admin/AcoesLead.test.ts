import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ComponentProps } from "react";
import { validarTelefoneBr } from "@/lib/form/validacao";
import type { AcoesLead } from "./AcoesLead";

type Props = ComponentProps<typeof AcoesLead>;
type Elemento = { type: string; props: { children?: unknown; onClick?: () => Promise<void>; [key: string]: unknown } };
type Resposta = { ok: boolean; status: number; json(): Promise<unknown> };

// Os cliques reais do menu, com React e fetch isolados. Nenhuma rede, lead
// real ou comunicação externa participa destes testes.
const fonte = ts.transpileModule(readFileSync(new URL("./AcoesLead.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function montar(inicial: Partial<Props> = {}) {
  const slots: unknown[] = [];
  let indice = 0;
  let props: Props = {
    id: "00000000-0000-4000-8000-00000000f004", nome: "Cliente fictício",
    pdfUrl: null, whatsapp: "(19) 99999-8888", temEmail: false, qualificadoEm: null,
    onQualificacaoAlterada(marca) { marcas.push(marca); props = { ...props, qualificadoEm: marca }; },
    ...inicial,
  };
  const chamadas: { url: string; method: string; body: string }[] = [];
  const marcas: (string | null)[] = [];
  const avisos: { tipo: string; texto: string }[] = [];
  const navegacoes: string[] = [];
  let atualizacoes = 0;
  let responder: (resposta: Resposta) => void;
  const mod: { exports: { AcoesLead?: (p: Props) => Elemento } } = { exports: {} };
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
      if (nome === "next/navigation") return { useRouter: () => ({
        refresh() { atualizacoes++; }, push(url: string) { navegacoes.push(url); },
      }) };
      if (nome === "lucide-react") return Object.fromEntries(
        ["Check", "Loader2", "Mail", "MessageCircle", "MoreVertical", "Pencil", "Trash2"].map((icone) => [icone, icone]),
      );
      if (nome === "sonner") return { toast: Object.fromEntries(["success", "error"].map((tipo) => [
        tipo, (texto: string) => avisos.push({ tipo, texto }),
      ])) };
      if (nome === "@/components/ui/dropdown-menu") return Object.fromEntries([
        "DropdownMenu", "DropdownMenuContent", "DropdownMenuGroup", "DropdownMenuGroupLabel", "DropdownMenuItem",
        "DropdownMenuSeparator", "DropdownMenuTrigger",
      ].map((componente) => [componente, componente]));
      if (nome === "@/lib/form/validacao") return { validarTelefoneBr };
      if (nome === "@/lib/form/types") return { STATUS: [] };
      if (nome === "@/lib/admin/rotulos") return { ROTULO_STATUS: {}, TEMA_COLUNA: {} };
      if (nome === "@/lib/admin/status") return { recusarMovimento() {} };
      if (nome === "@/lib/admin/acoes") return { avisoPropostaEnviada() {}, textoExclusao() {} };
      if (nome === "@/lib/whatsapp") return { linkPropostaWhatsApp() {} };
      if (nome === "@/lib/utils") return { cn: (...classes: unknown[]) => classes.filter(Boolean).join(" ") };
      throw new Error(`Importação inesperada no teste: ${nome}`);
    },
    fetch(url: string, opcoes: { method: string; body: string }) {
      chamadas.push({ url, method: opcoes.method, body: opcoes.body });
      return new Promise<Resposta>((resolve) => { responder = resolve; });
    },
  });
  return {
    chamadas, marcas, avisos, navegacoes,
    get atualizacoes() { return atualizacoes; },
    render(alteracoes: Partial<Props> = {}) {
      props = { ...props, ...alteracoes };
      indice = 0;
      return mod.exports.AcoesLead!(props);
    },
    responder(json: unknown, status = 200) {
      responder({ ok: status >= 200 && status < 300, status, json: async () => json });
    },
  };
}

function texto(elemento: unknown): string {
  if (typeof elemento === "string") return elemento;
  if (Array.isArray(elemento)) return elemento.map(texto).join("");
  if (elemento && typeof elemento === "object" && "props" in elemento) return texto((elemento as Elemento).props.children);
  return "";
}

function itens(elemento: unknown): Elemento[] {
  if (Array.isArray(elemento)) return elemento.flatMap(itens);
  if (!elemento || typeof elemento !== "object" || !("props" in elemento)) return [];
  const e = elemento as Elemento;
  return [...(e.type === "DropdownMenuItem" ? [e] : []), ...itens(e.props.children)];
}

function qualificacao(elemento: Elemento) {
  const item = itens(elemento).find((item) => texto(item).includes("qualificado"));
  assert.ok(item, "o menu deve oferecer a marcação explícita");
  return item;
}

test("renderizar o menu não qualifica nem envia comunicações", () => {
  const tela = montar();
  const acao = qualificacao(tela.render());
  assert.equal(texto(acao), "Marcar como lead qualificado");
  assert.equal(acao.props.disabled, false);
  assert.deepEqual(tela.chamadas, []);
  assert.deepEqual(tela.marcas, []);
});

test("qualificação usa PATCH com base confirmada, não duplica clique e atualiza a marca", async () => {
  const tela = montar();
  const acao = qualificacao(tela.render()).props.onClick!;
  const envio = acao();
  await acao();
  assert.equal(tela.chamadas.length, 1);
  assert.equal(qualificacao(tela.render()).props.disabled, true);
  assert.equal(tela.chamadas[0].method, "PATCH");
  assert.match(tela.chamadas[0].url, /\/qualificacao$/);
  assert.deepEqual(JSON.parse(tela.chamadas[0].body), { qualificado: true, base_qualificado_em: null });
  const marca = "2026-10-23T12:00:00.000Z";
  tela.responder({ ok: true, qualificado_em: marca });
  await envio;
  assert.deepEqual(tela.marcas, [marca]);
  assert.equal(texto(qualificacao(tela.render())), "Desmarcar lead qualificado");
  assert.equal(tela.atualizacoes, 1);
  assert.equal(tela.avisos.at(-1)?.tipo, "success");
});

test("conflito sincroniza a marca real e a próxima tentativa usa essa nova base", async () => {
  const tela = montar();
  const envio = qualificacao(tela.render()).props.onClick!();
  const marca = "2026-10-23T12:00:00.000Z";
  tela.responder({ erro: "A qualificação mudou em outra tela.", qualificado_em: marca }, 409);
  await envio;
  assert.deepEqual(tela.marcas, [marca]);
  assert.equal(tela.avisos.at(-1)?.tipo, "error");
  const retirada = qualificacao(tela.render()).props.onClick!();
  assert.deepEqual(JSON.parse(tela.chamadas[1].body), { qualificado: false, base_qualificado_em: marca });
  tela.responder({ ok: true, qualificado_em: null });
  await retirada;
  assert.deepEqual(tela.marcas, [marca, null]);
  assert.equal(tela.atualizacoes, 2);
});

test("sem WhatsApp válido não oferece marcação ativa; retirar marca continua permitido", async () => {
  for (const whatsapp of [null, "", "123", "00999998888"]) {
    const tela = montar({ whatsapp });
    const acao = qualificacao(tela.render());
    assert.equal(acao.props.disabled, true, String(whatsapp));
    await acao.props.onClick!();
    assert.equal(tela.chamadas.length, 0);
  }
  const marca = "2026-10-23T12:00:00.000Z";
  const tela = montar({ whatsapp: null, qualificadoEm: marca });
  const acao = qualificacao(tela.render());
  assert.equal(acao.props.disabled, false);
  const retirada = acao.props.onClick!();
  assert.deepEqual(JSON.parse(tela.chamadas[0].body), { qualificado: false, base_qualificado_em: marca });
  tela.responder({ ok: true, qualificado_em: null });
  await retirada;
});

test("erro de validação e retorno inválido não inventam qualificação e permitem nova ação", async () => {
  const tela = montar();
  const envio = qualificacao(tela.render()).props.onClick!();
  tela.responder({ erro: "Salve um WhatsApp válido antes de qualificar o lead." }, 422);
  await envio;
  assert.deepEqual(tela.marcas, []);
  assert.equal(tela.avisos.at(-1)?.tipo, "error");
  const repeticao = qualificacao(tela.render()).props.onClick!();
  tela.responder({ ok: true });
  await repeticao;
  assert.deepEqual(tela.marcas, []);
  assert.equal(tela.atualizacoes, 2);
});

test("Editar preserva o contexto da sequência do Kanban", async () => {
  const href = "/admin/leads/00000000-0000-4000-8000-00000000f004?q=Cliente&categoria=casamento";
  const tela = montar({ hrefDetalhe: href });
  const editar = itens(tela.render()).find((item) => texto(item) === "Editar");
  assert.ok(editar);
  await editar.props.onClick!();
  assert.deepEqual(tela.navegacoes, [href]);
  assert.equal(tela.chamadas.length, 0);
});
