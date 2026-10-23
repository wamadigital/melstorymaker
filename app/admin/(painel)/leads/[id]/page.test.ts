import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { carregarDetalhe } from "@/lib/admin/detalhe";
import { normalizarFiltrosNavegacao, type BuscaNavegacao, type FiltrosNavegacao } from "@/lib/admin/navegacao";
import type { Lead } from "@/lib/form/types";
import type { RegistroContrato } from "@/lib/contrato/tipos";

type Elemento = { type: string; key: string | null; props: { children?: unknown; [key: string]: unknown } };
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const agora = Date.parse("2026-10-23T18:00:00Z");
const fonte = ts.transpileModule(readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function montar({ leadId = id(1), busca = {}, erroLead = false, ausente = false, erroContrato = false, erroNavegacao = false }: {
  leadId?: string; busca?: BuscaNavegacao; erroLead?: boolean; ausente?: boolean; erroContrato?: boolean; erroNavegacao?: boolean;
} = {}) {
  const contrato = { lead_id: leadId, status: "pdf_gerado", documento: { marcador: "texto revisado manualmente" } } as unknown as RegistroContrato;
  const lead = { id: leadId, nome_display: "Fixture", status: "esfriou", categoria: "casamento", respostas: {} } as Lead;
  const chamadas: { tipo: string; argumentos?: unknown[] }[] = [];
  const navegacao = { anterior: { id: id(10), nome: "Anterior", status: "enviado" },
    proximo: { id: id(11), nome: "Próximo", status: "esfriou" }, atualIncluido: true,
    erro: erroNavegacao ? "Sequência indisponível." : null };
  const mod: { exports: { default?: (p: { params: Promise<{ id: string }>; searchParams: Promise<BuscaNavegacao> }) => Promise<Elemento> } } = { exports: {} };
  const jsx = (type: string, props: Elemento["props"], key?: string) => ({ type, props, key: key ?? null });
  runInNewContext(fonte, {
    exports: mod.exports, Date: { now: () => agora }, console: { error() {} },
    require(nome: string) {
      if (nome === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (nome === "zod") return { z };
      if (nome === "next/navigation") return { notFound() { throw new Error("NOT_FOUND"); } };
      if (nome === "@/lib/admin/navegacao") return { normalizarFiltrosNavegacao };
      if (nome === "@/lib/admin/detalhe") return { carregarDetalhe };
      if (nome === "@/lib/supabase/consulta") return { lerComRetentativa: (_rotulo: string, executar: () => unknown) => executar() };
      if (nome === "@/lib/supabase/admin") return { supabaseAdmin: () => ({ from(tabela: string) {
        assert.equal(tabela, "leads");
        return { select(colunas: string) {
          assert.equal(colunas, "*");
          return { eq(campo: string, valor: string) {
            assert.equal(campo, "id"); assert.equal(valor, leadId);
            return { async maybeSingle() {
              chamadas.push({ tipo: "lead" });
              return { data: ausente ? null : lead, error: erroLead ? new Error("falha de leitura") : null };
            } };
          } };
        } };
      } }) };
      if (nome === "@/lib/supabase/contratos") return { async lerRegistro(valor: string) {
        chamadas.push({ tipo: "contrato", argumentos: [valor] });
        if (erroContrato) throw new Error("contrato indisponível");
        return contrato;
      } };
      if (nome === "@/lib/supabase/navegacao-leads") return { async lerNavegacaoLead(...argumentos: [string, FiltrosNavegacao, number]) {
        chamadas.push({ tipo: "navegacao", argumentos });
        return navegacao;
      } };
      if (nome === "@/lib/contrato/ia") return { iaDisponivel: () => false };
      if (nome === "@/lib/assinatura/adapter") return { assinaturaConfigurada: () => true };
      if (nome === "@/lib/contrato/regras") return { hojeEmSaoPaulo(valor: number) {
        assert.equal(valor, agora); return "2026-10-23";
      } };
      if (nome === "@/lib/env") return { env: { ASSINATURA_DRY_RUN: true } };
      if (nome === "@/components/admin/DetalheLead") return { DetalheLead: "DetalheLead" };
      if (nome === "@/components/admin/FalhaCarregamentoLead") return { FalhaCarregamentoLead: "FalhaCarregamentoLead" };
      throw new Error(`Importação inesperada no teste: ${nome}`);
    },
  });
  return { chamadas, contrato, lead, navegacao, render: () => mod.exports.default!({ params: Promise.resolve({ id: leadId }), searchParams: Promise.resolve(busca) }) };
}

function editor(arvore: Elemento): Elemento {
  const filho = arvore.props.children as Elemento;
  assert.equal(filho.type, "DetalheLead");
  return filho;
}

test("página usa filtros normalizados, um relógio e key do lead para remontar o editor sem trocar seu contrato", async () => {
  const tela = montar({ busca: { q: "  Ana & João  ", categoria: "casamento", periodo: "hoje" } });
  const detalhe = editor(await tela.render());
  assert.equal(detalhe.key, id(1));
  assert.equal(detalhe.props.lead, tela.lead);
  assert.equal(detalhe.props.registroContrato, tela.contrato);
  assert.equal(detalhe.props.falhaAoLerContrato, false);
  assert.equal(detalhe.props.assinaturaConfigurada, true);
  assert.equal(detalhe.props.assinaturaDryRun, true);
  assert.equal(detalhe.props.iaDisponivel, false);
  assert.equal(detalhe.props.hojeISO, "2026-10-23");
  const chamada = tela.chamadas.find(c => c.tipo === "navegacao")!;
  assert.deepEqual(chamada.argumentos, [id(1), { q: "Ana & João", categoria: "casamento", periodo: "hoje" }, agora]);
  const contexto = detalhe.props.navegacao as typeof tela.navegacao & { filtros: FiltrosNavegacao };
  assert.deepEqual(contexto.filtros, { q: "Ana & João", categoria: "casamento", periodo: "hoje" });
  assert.equal(contexto.proximo, tela.navegacao.proximo);
  const outra = montar({ leadId: id(2), busca: { q: ["Ana", "João"], periodo: "qualquer", categoria: "externo" } });
  const outroEditor = editor(await outra.render());
  assert.equal(outroEditor.key, id(2));
  assert.notEqual(outroEditor.key, detalhe.key);
  assert.equal(outroEditor.props.registroContrato, outra.contrato);
  assert.deepEqual((outroEditor.props.navegacao as { filtros: FiltrosNavegacao }).filtros, { q: "", categoria: undefined, periodo: "todo" });
});

test("falha de navegação mantém o lead e o contrato; falha de contrato mantém seu bloqueio", async () => {
  const tela = montar({ erroNavegacao: true });
  const detalhe = editor(await tela.render());
  assert.equal(detalhe.props.registroContrato, tela.contrato);
  assert.equal(detalhe.props.falhaAoLerContrato, false);
  assert.equal((detalhe.props.navegacao as { erro: string }).erro, "Sequência indisponível.");
  const contratoFalhou = montar({ erroContrato: true });
  const detalheSemContrato = editor(await contratoFalhou.render());
  assert.equal(detalheSemContrato.props.lead, contratoFalhou.lead);
  assert.equal(detalheSemContrato.props.registroContrato, null);
  assert.equal(detalheSemContrato.props.falhaAoLerContrato, true);
  assert.equal(detalheSemContrato.key, id(1));
});

test("falha de leitura não vira editor vazio nem 404; ausência e id inválido são 404", async () => {
  const falha = await montar({ erroLead: true }).render();
  assert.equal(falha.type, "FalhaCarregamentoLead");
  await assert.rejects(montar({ ausente: true }).render, /NOT_FOUND/);
  const invalido = montar({ leadId: "../../outro" });
  await assert.rejects(invalido.render, /NOT_FOUND/);
  assert.deepEqual(invalido.chamadas, []);
});
