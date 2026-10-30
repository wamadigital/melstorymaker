import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { pacoteDoCatalogo, precoPacote } from "@/lib/contrato/catalogo";
import * as montagem from "@/lib/contrato/montar";
import * as pagamento from "@/lib/contrato/pagamento";
import * as negociacao from "@/lib/contrato/negociacao-casamento";
import { dadosContratoSchema, type DadosContrato, type RegistroContrato } from "@/lib/contrato/tipos";
import type { Categoria } from "@/lib/form/types";
import type { CondicaoEscrita, PatchContrato } from "@/lib/supabase/contratos";
import {
  MUDOU_NO_MEIO, Recusa, STATUS_EDITAVEIS, contextoDeMontagem, recusarSeTravado, type LeadDoContrato,
} from "./_comum";

// As rotas reais são executadas com I/O fechado na VM. Nenhum banco, sessão,
// chave de ambiente, IA, Storage ou assinatura é acessado por esta suíte.
const ID = "00000000-0000-4000-8000-000000000051";
const transpilar = (arquivo: string) => ts.transpileModule(readFileSync(new URL(arquivo, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fontes = {
  salvar: transpilar("./route.ts"),
  redigir: transpilar("./redigir/route.ts"),
  negociacao: transpilar("./_negociacao.ts"),
};

function dadosOriginais(): DadosContrato {
  const pacote = pacoteDoCatalogo("casamento", "Pacote Principal");
  assert.ok(pacote);
  return dadosContratoSchema.parse({
    contratante: { tipo: "pf", pf: {
      nome: "Clara Fictícia Teste", genero: "feminino", cpf: "12345678909", email: "clara@exemplo.com.br",
      endereco: { logradouro: "Rua Fictícia", numero: "10", bairro: "Vila Teste", cidade: "Campinas", uf: "SP" },
    } },
    evento: { data: "2099-08-14", horarioInicio: "17:00", homenageado: "Clara e Davi", locais: [
      { rotulo: "Local da cerimônia e recepção", endereco: "Espaço Fictício, Rua do Teste, 10, Campinas/SP" },
    ] },
    servico: { tabela: "2027", pacote: pacote.nome, valorPacote: precoPacote("casamento", "2027", pacote.nome), escopo: pacote.escopo },
    pagamento: pagamento.pagamentoDoPreset("30/70"),
  });
}

function dadosPersonalizados(opcao: negociacao.OpcaoCasamento = "opcao1"): DadosContrato {
  const selecionados = negociacao.selecionarOpcaoCasamento(dadosOriginais(), opcao);
  const editados = negociacao.editarServicoCasamento(selecionados, {
    ...selecionados.servico, valorPacote: opcao === "opcao1" ? 123400 : 245600,
    escopo: { ...selecionados.servico.escopo, minutosCobertura: opcao === "opcao1" ? 240 : 420,
      extras: ["Entrega de vídeo vertical negociado para teste"] },
  });
  return negociacao.editarCondicoesCasamento(editados, `Condição fictícia exclusiva da ${opcao}.`);
}

function registro(dados = dadosOriginais(), status: RegistroContrato["status"] = "rascunho"): RegistroContrato {
  return {
    lead_id: ID, created_at: "2026-10-29T12:00:00Z", updated_at: "2026-10-29T12:00:00.000001Z", status, dados,
    documento: null, avisos: [], redigido_em: null, revisado_em: null, pdf_gerado_em: null, pdf_sha256: null,
    assinatura_provedor: null, assinatura_status: null, assinatura_signatarios: null, assinatura_enviada_em: null,
    assinatura_atualizada_em: null, assinado_em: null,
  };
}

function montarRota(etapa: "salvar" | "redigir", {
  categoria = "casamento", atual = null, recusarEscrita = false,
}: { categoria?: Categoria; atual?: RegistroContrato | null; recusarEscrita?: boolean } = {}) {
  const lead: LeadDoContrato = { id: ID, categoria, respostas: {}, nome_display: "Lead Fictício" };
  const escritas: { id: string; patch: PatchContrato; condicao?: CondicaoEscrita }[] = [];
  const montados: DadosContrato[] = [];
  let textoGravado: Parameters<typeof import("./_escrita").gravarTextoRedigido>[2] | null = null;
  let linha = atual;
  let chamadasIa = 0;
  const comum = {
    MUDOU_NO_MEIO, Recusa, STATUS_EDITAVEIS, contextoDeMontagem, recusarSeTravado,
    carregarLead: async () => lead,
    lerCorpo: async (req: Request, schema: z.ZodType) => {
      const parsed = schema.safeParse(await req.json());
      if (!parsed.success) throw new Recusa(400, "Payload inválido.");
      return parsed.data;
    },
    responder: (body: unknown) => Response.json(body),
    avisoNaoIncorporado: (texto: string) => ({ origem: "ia", gravidade: "atencao", texto }),
    rotaDoContrato: (_etapa: string, fn: (req: Request, id: string) => Promise<Response>) => async (req: Request) => {
      try { return await fn(req, ID); }
      catch (erro) {
        if (erro instanceof Recusa) return Response.json({ erro: erro.message, ...erro.extra }, { status: erro.status });
        throw erro;
      }
    },
  };
  const dependencias: Record<string, unknown> = {
    zod: { z },
    "@/lib/contrato/tipos": { dadosContratoSchema },
    "@/lib/contrato/negociacao-casamento": negociacao,
    "@/lib/contrato/pagamento": pagamento,
    "@/lib/contrato/montar": { ...montagem, montarContrato: (dados: DadosContrato, ctx: montagem.ContextoMontagem, especiais?: string[]) => {
      montados.push(dados); return montagem.montarContrato(dados, ctx, especiais);
    } },
    "@/lib/assinatura/adapter": { assinaturaEmDryRun: () => true },
    "@/lib/contrato/ia": {
      iaDisponivel: () => false, IaError: class extends Error {}, IaIndisponivelError: class extends Error {},
      criarRedator: () => { chamadasIa++; throw new Error("A IA não deve ser acessada por estes testes."); },
    },
    "@/lib/contrato/anonimizar": {},
    "@/lib/contrato/extenso": {},
    "@/lib/pdf/formatadores": {},
    "@/lib/supabase/contratos": {
      lerRegistro: async () => linha,
      salvarRegistro: async (id: string, patch: PatchContrato, condicao?: CondicaoEscrita) => {
        escritas.push({ id, patch, condicao });
        if (recusarEscrita) return null;
        linha = { ...(linha ?? registro(patch.dados)), ...patch, updated_at: "2026-10-29T12:00:00.000002Z" };
        return linha;
      },
    },
    "./_comum": comum, "../_comum": comum,
    "../_escrita": {
      gravarTextoRedigido: async (_id: string, salvo: RegistroContrato, texto: NonNullable<typeof textoGravado>) => {
        textoGravado = texto;
        return { ...salvo, ...texto, status: "redigido" };
      },
    },
  };
  function carregar(fonte: string): Record<string, (req: Request) => Promise<Response>> {
    const mod = { exports: {} };
    runInNewContext(fonte, {
      exports: mod.exports, console: { log() {}, warn() {}, error() {} },
      require(nome: string) {
        if (!(nome in dependencias)) throw new Error(`Importação não autorizada no teste: ${nome}`);
        return dependencias[nome];
      },
    });
    return mod.exports;
  }
  const helper = carregar(fontes.negociacao);
  dependencias["./_negociacao"] = helper;
  dependencias["../_negociacao"] = helper;
  const rota = carregar(fontes[etapa]);
  return {
    escritas, montados, chamadasIa: () => chamadasIa, textoGravado: () => textoGravado,
    executar: (dados: unknown) => rota[etapa === "salvar" ? "PUT" : "POST"](new Request("https://mel.example.invalid/contrato", {
      method: etapa === "salvar" ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dados }),
    })),
  };
}

for (const etapa of ["salvar", "redigir"] as const) {
  test(`${etapa}: negociação não habilita casamento pelo payload em lead de outra categoria`, async () => {
    for (const categoria of ["corporativo", "debutante", "aniversario"] as const) {
      const rota = montarRota(etapa, { categoria });
      const resposta = await rota.executar(dadosPersonalizados());
      assert.equal(resposta.status, 422, categoria);
      assert.equal(rota.escritas.length, 0);
      assert.equal(rota.montados.length, 0);
      assert.equal(rota.chamadasIa(), 0);
    }
  });

  test(`${etapa}: serviço divergente da opção selecionada é rejeitado antes de qualquer escrita`, async () => {
    const dados = dadosPersonalizados();
    dados.servico.valorPacote++;
    const rota = montarRota(etapa, { atual: registro() });
    const resposta = await rota.executar(dados);
    assert.equal(resposta.status, 422);
    assert.match((await resposta.json()).erro, /diverge da opção/);
    assert.equal(rota.escritas.length, 0);
    assert.equal(rota.montados.length, 0);
  });

  test(`${etapa}: nome de pacote inválido no draft inativo também é rejeitado sem escrever`, async () => {
    const dados = dadosPersonalizados();
    dados.negociacaoCasamento!.opcao2.servico.pacote = "Pacote de outra categoria";
    const rota = montarRota(etapa);
    assert.equal((await rota.executar(dados)).status, 422);
    assert.equal(rota.escritas.length, 0);
  });

  test(`${etapa}: duas opções independentes persistem no JSONB e a selecionada alimenta o contrato`, async () => {
    for (const opcao of ["opcao1", "opcao2"] as const) {
      const outra = opcao === "opcao1" ? "opcao2" : "opcao1";
      const anteriores = dadosPersonalizados(outra);
      const selecionados = negociacao.selecionarOpcaoCasamento(anteriores, opcao);
      const dados = negociacao.editarCondicoesCasamento(
        negociacao.editarServicoCasamento(selecionados, dadosPersonalizados(opcao).servico),
        `Termo negociado ativo da ${opcao}.`,
      );
      const rota = montarRota(etapa, { atual: registro() });
      const resposta = await rota.executar(dados);
      assert.equal(resposta.status, 200);
      assert.equal(rota.escritas.length, 1);
      assert.deepEqual(rota.escritas[0].patch.dados, dados);
      assert.deepEqual(JSON.parse(JSON.stringify(rota.escritas[0].condicao)), { status: STATUS_EDITAVEIS });
      assert.equal(rota.chamadasIa(), 0);
      if (etapa === "redigir") {
        assert.ok(rota.montados.length > 0);
        assert.deepEqual(rota.montados[0], dados);
        const texto = JSON.stringify(rota.textoGravado()?.documento);
        assert.match(texto, /vídeo vertical negociado/);
        assert.match(texto, opcao === "opcao1" ? /1\.234,00/ : /2\.456,00/);
        assert.ok(texto.includes(`Termo negociado ativo da ${opcao}.`));
        assert.ok(!texto.includes(`Condição fictícia exclusiva da ${outra}.`));
      } else {
        assert.deepEqual(Object.keys(rota.escritas[0].patch), ["dados"]);
      }
    }
  });

  test(`${etapa}: contratos enviados e assinados mantêm a trava antes da negociação e da escrita`, async () => {
    for (const status of ["enviado", "assinado"] as const) {
      const rota = montarRota(etapa, { atual: registro(dadosOriginais(), status) });
      const resposta = await rota.executar(dadosPersonalizados());
      assert.equal(resposta.status, 409);
      assert.equal(rota.escritas.length, 0);
      assert.equal(rota.montados.length, 0);
    }
  });

  test(`${etapa}: negociação mantém somente a interpretação de pagamento conhecida pelo servidor`, async () => {
    const textoLivre = "Pagamento integral na assinatura do contrato.";
    const recebidos = dadosPersonalizados();
    recebidos.pagamento = {
      ...recebidos.pagamento, modo: "personalizado", textoLivre,
      interpretacao: { textoFonte: textoLivre, grupos: [], pendencias: ["Interpretação enviada pelo navegador"] },
    };
    const salvos = dadosPersonalizados();
    salvos.pagamento = {
      ...recebidos.pagamento,
      interpretacao: { textoFonte: textoLivre, grupos: [
        { quantidade: 1, valorCentavos: null, percentual: 100, vencimento: "na assinatura deste contrato", sinal: true, determinavel: true },
      ], pendencias: [] },
    };
    for (const atual of [null, registro(salvos)]) {
      const rota = montarRota(etapa, { atual });
      const resposta = await rota.executar(recebidos);
      assert.equal(resposta.status, 200);
      assert.deepEqual(rota.escritas[0].patch.dados?.pagamento.interpretacao, atual?.dados.pagamento.interpretacao ?? null);
      assert.equal(rota.chamadasIa(), 0);
    }
  });

  test(`${etapa}: perda da guarda de status retorna 409 sem montar ou gravar texto`, async () => {
    const rota = montarRota(etapa, { atual: registro(), recusarEscrita: true });
    const resposta = await rota.executar(dadosPersonalizados());
    assert.equal(resposta.status, 409);
    assert.equal(rota.montados.length, 0);
    assert.equal(rota.textoGravado(), null);
  });
}

test("salvar: contrato legado de aniversário sem idade conserva o salvamento de rascunho", async () => {
  const dados = dadosContratoSchema.parse({ servico: { tabela: "2027", pacote: "Rascunho Fictício" } });
  const rota = montarRota("salvar", { categoria: "aniversario" });
  assert.equal((await rota.executar(dados)).status, 200);
  assert.equal(rota.escritas.length, 1);
  assert.equal(rota.escritas[0].patch.status, "rascunho");
  assert.deepEqual(rota.escritas[0].patch.dados, dados);
});

test("redigir: dados incompletos legados são salvos antes do 422, sem perder o texto manual", async () => {
  const dados = dadosContratoSchema.parse({ servico: { tabela: "2027", pacote: "Pacote Principal" } });
  const rota = montarRota("redigir", { atual: registro() });
  const resposta = await rota.executar(dados);
  assert.equal(resposta.status, 422);
  assert.match((await resposta.json()).erro, /Faltam dados/);
  assert.equal(rota.escritas.length, 1);
  assert.deepEqual(Object.keys(rota.escritas[0].patch), ["dados"]);
  assert.equal(rota.textoGravado(), null);
});
