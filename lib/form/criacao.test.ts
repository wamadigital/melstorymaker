import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAVE_TENTATIVA, CriacaoLead, guardarOrigemOrcar, lerOrigemOrcar, lerTentativa, limparTentativa, origemOrcarDoLead, respostasIniciaisPreservadas,
  type LeadCriado, type TentativaCriacao,
} from "./criacao";
import { ErroPersistencia, type Armazenamento } from "./persistencia";
import { CHAVE_LEAD } from "./retomada";
import { copiarEstado, type EstadoFormulario } from "./snapshot";

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
const OUTRO_ID = "4f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
const INICIAL: EstadoFormulario = { categoria: "casamento", respostas: { contato_whatsapp: "19999999999" }, passo_atual: "nome" };
const ack = (id = ID): LeadCriado => ({ ...copiarEstado(INICIAL), id, status: "incompleto" });

function discoEmMemoria() {
  const valores = new Map<string, string>();
  return {
    valores,
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => { valores.set(chave, valor); },
    removeItem: (chave: string) => { valores.delete(chave); },
  };
}

function adiar<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}

test("ACK perdido após INSERT: retry repete identidade e não cria outro lead", async () => {
  const disco = discoEmMemoria();
  const linhas = new Map<string, LeadCriado>();
  const idsEnviados: string[] = [];
  let insercoes = 0;
  let idsGerados = 0;
  const criacao = new CriacaoLead({
    armazenamento: disco, gerarId: () => { idsGerados++; return ID; }, consultar: async () => null,
    enviar: async (tentativa) => {
      idsEnviados.push(tentativa.id);
      assert.equal(lerTentativa(disco)?.id, tentativa.id, "identidade durável antes do POST");
      if (!linhas.has(tentativa.id)) {
        insercoes++;
        linhas.set(tentativa.id, { ...copiarEstado(tentativa.estado), id: tentativa.id, status: "incompleto" });
        throw new TypeError("a resposta se perdeu depois do INSERT");
      }
      return linhas.get(tentativa.id)!;
    },
  });
  assert.equal((await criacao.enviar(INICIAL)).ok, false);
  assert.equal(lerTentativa(disco)?.id, ID);
  const resultado = await criacao.enviar(INICIAL);
  assert.equal(resultado.ok, true);
  assert.deepEqual(idsEnviados, [ID, ID]);
  assert.equal(insercoes, 1);
  assert.equal(idsGerados, 1);
  assert.equal(disco.getItem(CHAVE_LEAD), null, "tentativa ainda não é um lead com ACK aplicado");
  if (resultado.ok) criacao.confirmar(resultado.tentativa);
  assert.equal(criacao.obterTentativa(), null);
  assert.equal(lerTentativa(disco), null);
});

test("reload e GET 404 transitório repetem POST com a mesma identidade", async () => {
  const disco = discoEmMemoria();
  const primeira = new CriacaoLead({
    armazenamento: disco, gerarId: () => ID, consultar: async () => null,
    enviar: async () => { throw new TypeError("ACK perdido"); },
  });
  await primeira.enviar(INICIAL);
  const chamadas: string[] = [];
  const retomada = new CriacaoLead({
    armazenamento: disco, gerarId: () => { throw new Error("não deve gerar outro ID"); },
    consultar: async (id) => { chamadas.push(`GET:${id}`); return null; },
    enviar: async (tentativa) => { chamadas.push(`POST:${tentativa.id}`); return ack(tentativa.id); },
  });
  const resultado = await retomada.recuperar();
  assert.equal(resultado?.ok, true);
  assert.deepEqual(chamadas, [`GET:${ID}`, `POST:${ID}`]);
  assert.equal(lerTentativa(disco)?.id, ID, "só a aplicação do ACK limpa a tentativa");
});

test("recuperação existente devolve snapshot completo e fechado sem repetir POST", async () => {
  const disco = discoEmMemoria();
  const tentativa: TentativaCriacao = { id: ID, snapshotId: "primeiro", estado: INICIAL };
  disco.setItem(CHAVE_TENTATIVA, JSON.stringify(tentativa));
  const fechado: LeadCriado = { ...ack(), status: "aguardando_revisao", respostas: { ...INICIAL.respostas, nome: "Ana", noivos: "Ana e João" }, passo_atual: "contato_email" };
  let posts = 0;
  const criacao = new CriacaoLead({
    armazenamento: disco, consultar: async () => fechado,
    enviar: async () => { posts++; return ack(); },
  });
  const resultado = await criacao.recuperar();
  assert.ok(resultado?.ok);
  assert.deepEqual(resultado.lead, fechado);
  assert.equal(posts, 0);
  assert.equal(respostasIniciaisPreservadas(INICIAL, fechado), true);
  assert.equal(respostasIniciaisPreservadas({ ...INICIAL, categoria: "debutante" }, fechado), false);
  assert.equal(respostasIniciaisPreservadas({ ...INICIAL, respostas: { contato_whatsapp: "11988888888" } }, fechado), false);
});

test("troca de categoria/WhatsApp preserva intenção mas payload incerto é imutável", async () => {
  const disco = discoEmMemoria();
  const envios: TentativaCriacao[] = [];
  const criacao = new CriacaoLead({
    armazenamento: disco, gerarId: () => ID, consultar: async () => null,
    enviar: async (tentativa) => { envios.push(tentativa); throw new TypeError("offline"); },
  });
  const primeiro = copiarEstado(INICIAL);
  await criacao.enviar(primeiro);
  const snapshotInicial = lerTentativa(disco)?.snapshotId;
  primeiro.respostas.contato_whatsapp = "mutação externa";
  const desejado: EstadoFormulario = { categoria: "debutante", respostas: { contato_whatsapp: "11988888888" }, passo_atual: "nome" };
  await criacao.enviar(desejado);
  assert.deepEqual(envios.map((e) => e.id), [ID, ID]);
  assert.deepEqual(envios.map((e) => e.estado), [INICIAL, INICIAL]);
  const salva = lerTentativa(disco)!;
  assert.notEqual(salva.snapshotId, snapshotInicial);
  assert.deepEqual(salva.rascunho, desejado);
  const aposReload = new CriacaoLead({ armazenamento: disco, consultar: async () => null, enviar: async (e) => { assert.deepEqual(e.estado, INICIAL); return ack(); } });
  const recuperada = await aposReload.recuperar();
  assert.ok(recuperada?.ok);
  assert.deepEqual(recuperada.tentativa.rascunho, desejado);
});

test("armazenamento bloqueado mantém tentativa em memória até a aba fechar", async () => {
  const bloqueado: Armazenamento = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
  const ids: string[] = [];
  let sequencia = 0;
  const criacao = new CriacaoLead({
    armazenamento: bloqueado, gerarId: () => ID, consultar: async () => null,
    enviar: async (e) => { ids.push(e.id); if (++sequencia === 1) throw new TypeError("ACK perdido"); return ack(e.id); },
  });
  assert.equal((await criacao.enviar(INICIAL)).ok, false);
  assert.equal(criacao.estaSalvoNoAparelho(), false);
  const resultado = await criacao.enviar(INICIAL);
  assert.ok(resultado.ok);
  assert.deepEqual(ids, [ID, ID]);
  assert.doesNotThrow(() => criacao.confirmar(resultado.tentativa));
  assert.equal(criacao.obterTentativa(), null);
});

test("cliques concorrentes compartilham um POST e o mesmo ACK", async () => {
  const disco = discoEmMemoria();
  const resposta = adiar<LeadCriado>();
  let posts = 0;
  const criacao = new CriacaoLead({
    armazenamento: disco, gerarId: () => ID, consultar: async () => null,
    enviar: async () => { posts++; return resposta.promessa; },
  });
  const primeira = criacao.enviar(INICIAL);
  const segunda = criacao.enviar(INICIAL);
  assert.equal(primeira, segunda);
  assert.equal(posts, 1);
  resposta.resolver(ack());
  assert.deepEqual(await primeira, await segunda);
});

test("retomada explícita de outro UUID tem prioridade sem apagar tentativa antiga", async () => {
  const disco = discoEmMemoria();
  const antiga: TentativaCriacao = { id: ID, snapshotId: "antiga", estado: INICIAL };
  disco.setItem(CHAVE_TENTATIVA, JSON.stringify(antiga));
  disco.setItem(CHAVE_LEAD, OUTRO_ID);
  let consultas = 0;
  let posts = 0;
  const criacao = new CriacaoLead({
    armazenamento: disco, leadConfirmadoAtual: OUTRO_ID,
    consultar: async () => { consultas++; return ack(); }, enviar: async () => { posts++; return ack(); },
  });
  assert.equal(criacao.obterTentativa(), null);
  assert.equal(criacao.recuperar(), null);
  assert.equal(consultas + posts, 0);
  assert.deepEqual(lerTentativa(disco), antiga);
  assert.equal(disco.getItem(CHAVE_LEAD), OUTRO_ID);
});

test("ACK antigo não limpa outra identidade ou uma intenção mais recente", async () => {
  const disco = discoEmMemoria();
  const criacao = new CriacaoLead({ armazenamento: disco, gerarId: () => ID, consultar: async () => null, enviar: async () => ack() });
  const primeira = await criacao.enviar(INICIAL);
  assert.ok(primeira.ok);
  const outra: TentativaCriacao = { id: OUTRO_ID, snapshotId: "nova", estado: INICIAL };
  disco.setItem(CHAVE_TENTATIVA, JSON.stringify(outra));
  criacao.confirmar(primeira.tentativa);
  assert.deepEqual(lerTentativa(disco), outra);
  const posterior: TentativaCriacao = { ...primeira.tentativa, snapshotId: "posterior", rascunho: { ...INICIAL, categoria: "debutante" } };
  disco.setItem(CHAVE_TENTATIVA, JSON.stringify(posterior));
  assert.equal(limparTentativa(primeira.tentativa, disco), false);
  assert.deepEqual(lerTentativa(disco), posterior);
});

test("GET 500 e erro HTTP de criação preservam a mesma tentativa e classificação", async () => {
  const disco = discoEmMemoria();
  const primeira = new CriacaoLead({
    armazenamento: disco, gerarId: () => ID, consultar: async () => null,
    enviar: async () => { throw new ErroPersistencia({ tipo: "limite", mensagem: "Aguarde" }); },
  });
  const limite = await primeira.enviar(INICIAL);
  assert.equal(limite.ok, false);
  if (!limite.ok) assert.equal(limite.falha.tipo, "limite");
  const retomada = new CriacaoLead({
    armazenamento: disco, consultar: async () => { throw new ErroPersistencia({ tipo: "servidor", mensagem: "Servidor indisponível" }); },
    enviar: async () => { throw new Error("GET 500 não autoriza novo POST nem identidade"); },
  });
  const servidor = await retomada.recuperar();
  assert.ok(servidor && !servidor.ok);
  assert.equal(servidor.falha.tipo, "servidor");
  assert.equal(lerTentativa(disco)?.id, ID);
});

test("somente a resposta de criação nova autoriza Pixel Lead, nunca replay ou GET", async () => {
  const disco = discoEmMemoria();
  let envios = 0;
  const criacao = new CriacaoLead({
    armazenamento: disco, gerarId: () => ID,
    enviar: async () => ({ ...ack(), criadoAgora: ++envios === 1 }),
    consultar: async () => ({ ...ack(), criadoAgora: true }),
  });
  const novo = await criacao.enviar(INICIAL);
  assert.ok(novo.ok);
  assert.equal(novo.criadoAgora, true);
  const replay = await criacao.enviar(INICIAL);
  assert.ok(replay.ok);
  assert.equal(replay.criadoAgora, false);
  const get = await criacao.recuperar();
  assert.ok(get?.ok);
  assert.equal(get.criadoAgora, false);
});

test("tentativa /orcar sobrevive ACK perdido e retomada por outra página", async () => {
  const disco = discoEmMemoria();
  const primeira = new CriacaoLead({
    armazenamento: disco, gerarId: () => ID, origem_formulario: "orcar", consultar: async () => null,
    enviar: async (tentativa) => {
      assert.equal(tentativa.origem_formulario, "orcar");
      throw new TypeError("ACK perdido");
    },
  });
  assert.equal((await primeira.enviar(INICIAL)).ok, false);
  assert.equal(lerTentativa(disco)?.origem_formulario, "orcar");
  const retomada = new CriacaoLead({
    armazenamento: disco, consultar: async () => null,
    enviar: async (tentativa) => {
      assert.equal(tentativa.origem_formulario, "orcar", "página normal não reativa proposta automática");
      assert.deepEqual(tentativa.estado, INICIAL);
      return { ...ack(), origem_formulario: "orcar" };
    },
  });
  const resultado = await retomada.recuperar();
  assert.ok(resultado?.ok);
  assert.equal(resultado.lead.origem_formulario, "orcar");
  assert.equal(resultado.tentativa.origem_formulario, "orcar");
});

test("retomar tentativa normal em /orcar só acrescenta opt-out sem alterar identidade ou snapshot", async () => {
  const disco = discoEmMemoria();
  const inicial: TentativaCriacao = { id: ID, snapshotId: "imutavel", estado: INICIAL };
  disco.setItem(CHAVE_TENTATIVA, JSON.stringify(inicial));
  let rede = 0;
  const criacao = new CriacaoLead({
    armazenamento: disco, origem_formulario: "orcar",
    consultar: async () => { rede++; return ack(); },
    enviar: async () => { throw new Error("GET existente não cria novamente"); },
  });
  assert.equal(rede, 0, "construir a preferência não altera lead no servidor");
  assert.deepEqual(lerTentativa(disco), { ...inicial, origem_formulario: "orcar" });
  const resultado = await criacao.recuperar();
  assert.ok(resultado?.ok);
  assert.deepEqual(resultado.tentativa.estado, INICIAL);
  assert.equal(resultado.tentativa.snapshotId, inicial.snapshotId);
  assert.equal(resultado.tentativa.origem_formulario, "orcar");
});

test("preferência /orcar local fica isolada por lead após limpar tentativa confirmada", () => {
  const disco = discoEmMemoria();
  guardarOrigemOrcar(ID, disco);
  assert.equal(lerOrigemOrcar(ID, disco), true);
  assert.equal(lerOrigemOrcar(OUTRO_ID, disco), false);
  assert.equal(disco.getItem(CHAVE_LEAD), null, "preferência não cria identidade confirmada");
  guardarOrigemOrcar("invalido", disco);
  assert.equal(lerOrigemOrcar("invalido", disco), false);
  assert.doesNotThrow(() => guardarOrigemOrcar(ID, null));
  assert.equal(lerOrigemOrcar(ID, null), false);
});

test("UUID antigo removido ou encerrado não transmite opt-out a novo lead pela página normal", async () => {
  const disco = discoEmMemoria();
  guardarOrigemOrcar(ID, disco);
  assert.equal(origemOrcarDoLead(ID, undefined, ID), true);
  assert.equal(origemOrcarDoLead(OUTRO_ID, undefined, ID), false, "ref antiga exige o mesmo UUID");
  assert.equal(origemOrcarDoLead(OUTRO_ID, undefined, null), false, "descarte em 404/410/encerrado limpa referência");
  assert.equal(origemOrcarDoLead(OUTRO_ID, "orcar", null), true, "página /orcar continua explícita");
  const criacaoNormal = new CriacaoLead({
    armazenamento: disco, gerarId: () => OUTRO_ID, consultar: async () => null,
    enviar: async (tentativa) => {
      assert.equal(tentativa.origem_formulario, undefined, "preferência local de outro UUID não altera o POST novo");
      return ack(OUTRO_ID);
    },
  });
  assert.equal((await criacaoNormal.enviar(INICIAL)).ok, true);
});

test("lead confirmado diferente de tentativa /orcar antiga não herda a preferência", () => {
  const disco = discoEmMemoria();
  disco.setItem(CHAVE_TENTATIVA, JSON.stringify({ id: ID, snapshotId: "antiga", estado: INICIAL, origem_formulario: "orcar" }));
  const criacao = new CriacaoLead({
    armazenamento: disco, leadConfirmadoAtual: OUTRO_ID,
    consultar: async () => ack(OUTRO_ID), enviar: async () => ack(OUTRO_ID),
  });
  assert.equal(criacao.obterTentativa(), null);
  assert.equal(origemOrcarDoLead(OUTRO_ID, undefined, criacao.obterTentativa()?.id ?? null), false);
  assert.equal(lerTentativa(disco)?.origem_formulario, "orcar", "slot alheio é preservado sem aplicar ao lead atual");
});
