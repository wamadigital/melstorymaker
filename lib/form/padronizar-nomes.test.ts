import assert from "node:assert/strict";
import { test } from "node:test";
import { aceitarNome, padronizarNomes, requisicaoNomes, PadronizacaoNomesError, type ClienteNomes } from "./padronizar-nomes";
import { CATEGORIAS } from "./types";

const campo = (valor: string, confiavel = true) => ({ valor, confiavel });
const cliente = (json: unknown, stop_reason = "end_turn"): ClienteNomes => ({ messages: { async create() {
  return { stop_reason: stop_reason as "end_turn", content: [{ type: "text", text: JSON.stringify(json), citations: null }] };
} } });

test("aceita os exemplos de correção e preserva os prenomes compostos", () => {
  const exemplos = [
    ["Gabriela e Guilherme", "Gabriela & Guilherme", true],
    ["Rosangela Fernandes", "Rosangela", true],
    ["Pedro", "Pedro", true],
    ["Moacir Santanda e Flor de Souza", "Flor & Moacir", true],
    ["Gabriela Alves Vieira", "Gabriela", false],
    ["Victor Souza", "Victor", false],
    ["MARIA EDUARDA ALVES", "Maria Eduarda", false],
    ["João Pedro Alves e Ana Clara Souza", "Ana Clara & João Pedro", true],
    ["Maria das Graças da Silva", "Maria das Graças", false],
    ["Ana-Maria Souza", "Ana-Maria", false],
  ] as const;
  for (const [original, corrigido, casal] of exemplos) assert.equal(aceitarNome(original, campo(corrigido), casal), corrigido);
});

test("rejeita pessoa inventada, pessoa apagada, sobrenome no lugar de nome e edição insegura", () => {
  const exemplos = [
    ["Pedro", "Ana & Pedro", true],
    ["Pedro e Gabriela", "Pedro", true],
    ["Pedro e Gabriela", "Gabriela & Gabriela", true],
    ["Gabriela Alves Vieira", "Alves", false],
    ["Victor Souza", "Vitor", false],
    ["Ana Clara", "Ana & Clara", false],
    ["Pedro e Gabriela", "Gabriela e Pedro", true],
    ["Pedro", "<script>alert(1)</script>", false],
  ] as const;
  for (const [original, corrigido, casal] of exemplos) assert.equal(aceitarNome(original, campo(corrigido), casal), original);
  assert.equal(aceitarNome("Alex Silva", campo("Alex", false), false), "Alex Silva");
});

test("API recebe só os dois campos autorizados, sem contato ou resto do evento", () => {
  for (const categoria of CATEGORIAS) {
    const pedido = requisicaoNomes(categoria, {
      nome: "Victor Souza", noivos: "Ana e Pedro", empresa: "Empresa secreta", debutante: "Maria",
      contato_email: "segredo@example.invalid", contato_whatsapp: "19999999999", data: "2028-01-01",
    });
    assert.deepEqual(JSON.parse(pedido.messages[0].content as string), {
      nome: "Victor Souza", noivos: categoria === "casamento" ? "Ana e Pedro" : null,
    });
    assert.equal(pedido.output_config?.format?.type, "json_schema");
    assert.equal(pedido.max_tokens, 1024);
    assert.ok(!JSON.stringify(pedido).includes("segredo@example.invalid"));
  }
  assert.equal(JSON.parse(requisicaoNomes("casamento", { nome: "A".repeat(321), noivos: "Pedro" }).messages[0].content as string).nome, null);
});

test("resposta da IA corrige o jsonb sem confundir contato com casal ou alterar outras respostas", async () => {
  const original = { nome: "Gabriela Alves Vieira", noivos: "Moacir Santanda e Flor de Souza", data: "2028-01-01", contato_whatsapp: "19999999999", local_festa: "Espaço da Festa" };
  const resultado = await padronizarNomes("casamento", original, { cliente: cliente({ nome: campo("Gabriela"), noivos: campo("Flor & Moacir") }) });
  assert.deepEqual(resultado, { ...original, nome: "Gabriela", noivos: "Flor & Moacir" });
  assert.equal(original.nome, "Gabriela Alves Vieira", "não muta o snapshot de origem");
  const corporativo = await padronizarNomes("corporativo", { ...original, empresa: "Da Silva Consultoria" }, { cliente: cliente({ nome: campo("Gabriela"), noivos: campo("Flor & Moacir") }) });
  assert.equal(corporativo.noivos, original.noivos, "só casamento aceita correção dos noivos");
  assert.equal(corporativo.empresa, "Da Silva Consultoria");
});

test("recusa, truncamento, JSON/shape inválido e erro da API não viram correção", async () => {
  for (const falso of [
    cliente({ nome: campo("Ana"), noivos: null }, "max_tokens"),
    cliente({ nome: campo("Ana"), noivos: null }, "refusal"),
    cliente({ nome: campo("Ana"), noivos: null, extra: "indevido" }),
    cliente({ nome: { valor: "Ana", confiavel: "sim" }, noivos: null }),
    { messages: { async create() { throw new Error("segredo e dados da resposta da API"); } } } as ClienteNomes,
  ]) {
    await assert.rejects(padronizarNomes("casamento", { nome: "Ana Souza" }, { cliente: falso }), PadronizacaoNomesError);
  }
});

test("chamada usa prazo total e nenhuma repetição paga automática", async () => {
  let chamado = false;
  const falso: ClienteNomes = { messages: { async create(_pedido, opcoes) {
    chamado = true;
    assert.equal(opcoes.maxRetries, 0);
    assert.equal(opcoes.timeout, 20_000);
    assert.ok(opcoes.signal instanceof AbortSignal);
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ nome: campo("Victor"), noivos: null }), citations: null }] };
  } } };
  assert.equal((await padronizarNomes("corporativo", { nome: "Victor Souza" }, { cliente: falso })).nome, "Victor");
  assert.equal(chamado, true);
});
