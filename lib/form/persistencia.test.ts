import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chaveRascunho, concluirLeadLocal, ErroPersistencia, esquecerLead, falhaDaResposta, FALHA_CONEXAO, FilaAutosave,
  guardarLead, lerLeadSalvo, lerRascunho, limparRascunho, permiteNovaTentativa,
  type Armazenamento, type EstadoPersistencia, type ResultadoPersistencia,
} from "./persistencia";
import { CHAVE_LEAD } from "./retomada";
import { copiarEstado, estadosIguais, respostasIguais, type EstadoFormulario } from "./snapshot";

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
const OUTRO_ID = "4f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
const estado = (nome: string): EstadoFormulario => ({
  categoria: "casamento", respostas: { contato_whatsapp: "19999999999", noivos: nome }, passo_atual: "data",
});
const B = estado("base");
const A = estado("primeiro envio");
const C = estado("última edição");

function armazenamentoEmMemoria() {
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

function transporteControlado() {
  const chamadas: { estado: EstadoFormulario; base: EstadoFormulario; resposta: ReturnType<typeof adiar<ResultadoPersistencia>> }[] = [];
  return {
    chamadas,
    enviar: (estado: EstadoFormulario, base: EstadoFormulario) => {
      const resposta = adiar<ResultadoPersistencia>();
      chamadas.push({ estado, base, resposta });
      return resposta.promessa;
    },
    confirmar: (indice: number) => chamadas[indice].resposta.resolver({ ok: true, estado: chamadas[indice].estado }),
  };
}

// Avança as continuações Promise sem relógio, rede ou dependência do event loop.
async function turno() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test("um PATCH ativo, última pendência e flush aguardando ambos os ACKs", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const estados: EstadoPersistencia[] = [];
  const fila = new FilaAutosave(ID, B, { ...transporte, armazenamento: disco, aoMudar: (e) => estados.push(e) });
  fila.enfileirar(A);
  fila.enfileirar(estado("edição intermediária"));
  fila.enfileirar(C);
  assert.equal(transporte.chamadas.length, 1);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  let finalizado = false;
  const flush = fila.confirmarTudo().then((ok) => { finalizado = true; return ok; });
  transporte.confirmar(0);
  await turno();
  assert.equal(finalizado, false);
  assert.equal(transporte.chamadas.length, 2);
  assert.deepEqual(transporte.chamadas[1].estado, C);
  assert.deepEqual(transporte.chamadas[1].base, A);
  transporte.confirmar(1);
  assert.equal(await flush, true);
  assert.deepEqual(fila.obterBase(), C);
  assert.equal(lerRascunho(ID, disco), null);
  assert.equal(estados.at(-1)?.pendente, false);
});

test("edição durante falha de rede permanece local e reconexão envia a última", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const fila = new FilaAutosave(ID, B, {
    ...transporte, consultar: async () => B, armazenamento: disco, aoMudar: () => {},
  });
  fila.enfileirar(A);
  fila.enfileirar(C);
  transporte.chamadas[0].resposta.resolver({ ok: false, falha: FALHA_CONEXAO });
  assert.equal(await fila.confirmarTudo(), false);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  assert.deepEqual(lerRascunho(ID, disco)?.tentado, A);
  const retomada = fila.tentarNovamente(true);
  await turno();
  assert.deepEqual(transporte.chamadas[1].estado, C);
  assert.deepEqual(transporte.chamadas[1].base, B);
  transporte.confirmar(1);
  assert.equal(await retomada, true);
});

test("ACK perdido depois da escrita é recuperado antes de enviar edição nova", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const fila = new FilaAutosave(ID, B, {
    ...transporte, consultar: async () => A, armazenamento: disco, aoMudar: () => {},
  });
  fila.enfileirar(A);
  fila.enfileirar(C);
  transporte.chamadas[0].resposta.resolver({ ok: false, falha: FALHA_CONEXAO });
  assert.equal(await fila.confirmarTudo(), false);
  const retomada = fila.tentarNovamente(true);
  await turno();
  assert.deepEqual(transporte.chamadas[1].estado, C);
  assert.deepEqual(transporte.chamadas[1].base, A);
  transporte.confirmar(1);
  assert.equal(await retomada, true);
  assert.equal(lerRascunho(ID, disco), null);
});

test("GET 500 na recuperação mantém falha de servidor e rascunho", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const fila = new FilaAutosave(ID, B, {
    ...transporte, armazenamento: disco, aoMudar: () => {},
    consultar: async () => { throw new ErroPersistencia(await falhaDaResposta(new Response(JSON.stringify({ erro: "Servidor indisponível" }), { status: 500 }))); },
  });
  fila.enfileirar(C);
  transporte.chamadas[0].resposta.resolver({ ok: false, falha: FALHA_CONEXAO });
  assert.equal(await fila.confirmarTudo(), false);
  assert.equal(await fila.tentarNovamente(true), false);
  assert.equal(fila.obterFalha()?.tipo, "servidor");
  assert.equal(fila.obterFalha()?.mensagem, "Servidor indisponível");
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  assert.equal(transporte.chamadas.length, 1);
});

test("reload recupera último envio incerto e preserva edição feita durante ele", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const antiga = new FilaAutosave(ID, B, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  antiga.enfileirar(A);
  antiga.enfileirar(C);
  const rascunho = lerRascunho(ID, disco)!;
  assert.deepEqual(rascunho.base, B);
  assert.deepEqual(rascunho.tentado, A);
  antiga.parar();
  const nova = new FilaAutosave(ID, A, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  nova.restaurar(rascunho);
  assert.deepEqual(transporte.chamadas[1].base, A);
  assert.deepEqual(transporte.chamadas[1].estado, C);
  transporte.confirmar(1);
  assert.equal(await nova.confirmarTudo(), true);
  transporte.confirmar(0);
  await turno();
  assert.equal(lerRascunho(ID, disco), null);
});

test("conflito após transporte incerto não sobrescreve outra aba nem perde rascunho", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const outraAba = estado("alterado pela outra aba");
  const fila = new FilaAutosave(ID, B, {
    ...transporte, consultar: async () => outraAba, armazenamento: disco, aoMudar: () => {},
  });
  fila.enfileirar(A);
  fila.enfileirar(C);
  transporte.chamadas[0].resposta.resolver({ ok: false, falha: FALHA_CONEXAO });
  assert.equal(await fila.confirmarTudo(), false);
  assert.equal(await fila.tentarNovamente(true), false);
  assert.equal(fila.obterFalha()?.tipo, "conflito");
  assert.equal(transporte.chamadas.length, 1);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  fila.enfileirar(estado("nova edição ainda em conflito"));
  assert.deepEqual(lerRascunho(ID, disco)?.base, B);
  assert.equal(await fila.tentarNovamente(), false);
  const restaurada = new FilaAutosave(ID, outraAba, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  restaurada.restaurar(lerRascunho(ID, disco)!);
  assert.equal(restaurada.obterFalha()?.tipo, "conflito");
  assert.equal(transporte.chamadas.length, 1);
});

test("ACK de uma fila parada não sobrescreve rascunho de uma nova fila", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const antiga = new FilaAutosave(ID, B, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  antiga.enfileirar(A);
  antiga.enfileirar(estado("pendência antiga"));
  antiga.parar();
  const nova = new FilaAutosave(ID, B, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  nova.enfileirar(C);
  const antes = disco.getItem(chaveRascunho(ID));
  transporte.confirmar(0);
  await turno();
  assert.equal(disco.getItem(chaveRascunho(ID)), antes);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  transporte.confirmar(1);
  assert.equal(await nova.confirmarTudo(), true);
});

test("reconexão que encontra a última edição salva só confirma, sem PATCH repetido", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const fila = new FilaAutosave(ID, B, { ...transporte, consultar: async () => C, armazenamento: disco, aoMudar: () => {} });
  fila.enfileirar(C);
  transporte.chamadas[0].resposta.resolver({ ok: false, falha: FALHA_CONEXAO });
  assert.equal(await fila.confirmarTudo(), false);
  assert.equal(await fila.tentarNovamente(true), true);
  assert.equal(transporte.chamadas.length, 1);
  assert.deepEqual(fila.obterBase(), C);
  assert.equal(lerRascunho(ID, disco), null);
});

test("rascunhos por UUID e limpeza por snapshot não removem outra sessão", async () => {
  const disco = armazenamentoEmMemoria();
  const transporte = transporteControlado();
  const fila = new FilaAutosave(ID, B, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  fila.enfileirar(A);
  assert.equal(lerRascunho(OUTRO_ID, disco), null);
  limparRascunho(ID, disco, "snapshot de outra aba");
  assert.ok(lerRascunho(ID, disco));
  guardarLead(OUTRO_ID, disco);
  esquecerLead(ID, disco);
  assert.equal(lerLeadSalvo(disco), OUTRO_ID);
  fila.parar();
  transporte.confirmar(0);
  await turno();
  const segunda = new FilaAutosave(OUTRO_ID, B, { ...transporte, armazenamento: disco, aoMudar: () => {} });
  segunda.restaurar(lerRascunho(ID, disco)!);
  assert.equal(transporte.chamadas.length, 1);
});

test("conclusão da aba A preserva rascunho divergente retido em conflito pela B", async () => {
  const disco = armazenamentoEmMemoria();
  guardarLead(ID, disco);
  const abaA = new FilaAutosave(ID, B, {
    armazenamento: disco, aoMudar: () => {}, enviar: async (e) => ({ ok: true, estado: e }),
  });
  abaA.enfileirar(A);
  assert.equal(await abaA.confirmarTudo(), true);
  const abaB = new FilaAutosave(ID, B, {
    armazenamento: disco, aoMudar: () => {},
    enviar: async () => ({ ok: false, falha: { tipo: "conflito", mensagem: "Outra aba atualizou" } }),
  });
  abaB.enfileirar(C);
  assert.equal(await abaB.confirmarTudo(), false);
  abaA.parar();
  assert.equal(concluirLeadLocal(ID, A, disco), false);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  assert.equal(lerLeadSalvo(disco), ID, "reload ainda encontra o rascunho divergente");
  // O bootstrap fechado usa a mesma proteção, sem descartar o snapshot mostrado.
  assert.equal(concluirLeadLocal(ID, A, disco), false);
  assert.equal(concluirLeadLocal(ID, A, disco, abaB.obterSnapshotPendenteId()), true);
  assert.equal(lerRascunho(ID, disco), null);
  assert.equal(lerLeadSalvo(disco), null);
});

test("descarte explícito só remove o snapshot mostrado, não outro rascunho recente", () => {
  const disco = armazenamentoEmMemoria();
  guardarLead(ID, disco);
  const fila = new FilaAutosave(ID, B, { armazenamento: disco, aoMudar: () => {}, enviar: async (e) => ({ ok: true, estado: e }) });
  fila.reter(A, { tipo: "encerrado", mensagem: "Enviado" });
  const mostrado = fila.obterSnapshotPendenteId();
  fila.reter(C, { tipo: "encerrado", mensagem: "Enviado" });
  assert.equal(concluirLeadLocal(ID, B, disco, mostrado), false);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  assert.equal(lerLeadSalvo(disco), ID);
  assert.equal(concluirLeadLocal(ID, C, disco), true);
  assert.equal(lerRascunho(ID, disco), null);
});

test("snapshot que muda durante limpeza não é removido e mantém UUID", () => {
  const disco = armazenamentoEmMemoria();
  guardarLead(ID, disco);
  const inicial = { leadId: ID, snapshotId: "primeiro", estado: A, base: B };
  const posterior = { leadId: ID, snapshotId: "segundo", estado: C, base: B };
  disco.setItem(chaveRascunho(ID), JSON.stringify(inicial));
  let leituras = 0;
  const concorrente: Armazenamento = {
    ...disco,
    getItem: (chave) => {
      if (chave === chaveRascunho(ID) && ++leituras === 2) disco.setItem(chave, JSON.stringify(posterior));
      return disco.getItem(chave);
    },
  };
  assert.equal(concluirLeadLocal(ID, A, concorrente), false);
  assert.deepEqual(lerRascunho(ID, disco)?.estado, C);
  assert.equal(lerLeadSalvo(disco), ID);
});

test("armazenamento bloqueado não interrompe confirmação do servidor", async () => {
  const bloqueado: Armazenamento = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
  assert.equal(guardarLead(ID, bloqueado), false);
  assert.equal(lerLeadSalvo(bloqueado), null);
  assert.doesNotThrow(() => esquecerLead(ID, bloqueado));
  const estados: EstadoPersistencia[] = [];
  let envios = 0;
  const fila = new FilaAutosave(ID, B, {
    armazenamento: bloqueado, aoMudar: (e) => estados.push(e),
    enviar: async (e) => { envios++; return { ok: true, estado: e }; },
  });
  fila.enfileirar(C);
  assert.equal(await fila.confirmarTudo(), true);
  assert.equal(envios, 1);
  assert.deepEqual(fila.obterBase(), C);
  assert.equal(estados.at(-1)?.salvoNoAparelho, false);
});

test("falhas HTTP mantêm mensagens e critérios de retry distintos", async () => {
  for (const [status, codigo, tipo] of [
    [409, "conflito_respostas", "conflito"], [409, "formulario_enviado", "encerrado"],
    [422, undefined, "invalido"], [429, undefined, "limite"], [503, undefined, "servidor"],
  ] as const) {
    const falha = await falhaDaResposta(new Response(JSON.stringify({ erro: "mensagem específica", codigo, campos: { data: "revise" } }), { status }));
    assert.equal(falha.tipo, tipo);
    assert.equal(falha.mensagem, "mensagem específica");
    assert.equal(permiteNovaTentativa(falha, true), tipo === "servidor");
    assert.equal(permiteNovaTentativa(falha), tipo === "servidor" || tipo === "limite");
    if (tipo === "invalido") assert.deepEqual(falha.campos, { data: "revise" });
  }
  assert.equal(permiteNovaTentativa(FALHA_CONEXAO, true), true);
});

test("snapshots isolam mutações e fechamento só confirma conteúdo igual", () => {
  const original = copiarEstado(C);
  const copia = copiarEstado(original);
  copia.respostas.noivos = "alteração local";
  assert.deepEqual(original, C);
  assert.equal(estadosIguais(C, { ...C, respostas: { noivos: C.respostas.noivos, contato_whatsapp: C.respostas.contato_whatsapp } }), true);
  assert.equal(estadosIguais(C, { ...C, passo_atual: null }), false);
  const fechadoSemPasso: EstadoFormulario = { ...C, passo_atual: null };
  assert.equal(respostasIguais(C, fechadoSemPasso), true);
  assert.equal(respostasIguais(C, B), false);
  assert.equal(respostasIguais(C, { ...C, categoria: "debutante" }), false);
});

test("dados locais inválidos não são importados para um lead", () => {
  const disco = armazenamentoEmMemoria();
  disco.setItem(CHAVE_LEAD, ID);
  disco.setItem(chaveRascunho(ID), JSON.stringify({ leadId: OUTRO_ID, snapshotId: "1", estado: C, base: B }));
  assert.equal(lerRascunho(ID, disco), null);
  disco.setItem(chaveRascunho(ID), "json quebrado");
  assert.equal(lerRascunho(ID, disco), null);
});
