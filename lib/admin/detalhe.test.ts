import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lead } from "@/lib/form/types";
import type { RegistroContrato } from "@/lib/contrato/tipos";
import { carregarDetalhe } from "./detalhe";

// A função só coordena leituras; os dados são opacos para ela.
const lead = { id: "lead-ficticio" } as Lead;
const contrato = { lead_id: lead.id, status: "assinado" } as RegistroContrato;

test("detalhe inicia as duas leituras sem esperar a resposta de uma para começar a outra", async () => {
  const iniciadas: string[] = [];
  let liberarLead!: (v: { data: Lead; error: null }) => void;
  let liberarContrato!: (v: RegistroContrato) => void;
  const pendenteLead = new Promise<{ data: Lead; error: null }>((resolve) => { liberarLead = resolve; });
  const pendenteContrato = new Promise<RegistroContrato>((resolve) => { liberarContrato = resolve; });
  const resultado = carregarDetalhe({
    lerLead: () => { iniciadas.push("lead"); return pendenteLead; },
    lerContrato: () => { iniciadas.push("contrato"); return pendenteContrato; },
  });
  await Promise.resolve();
  assert.deepEqual(iniciadas, ["lead", "contrato"]);
  liberarContrato(contrato);
  liberarLead({ data: lead, error: null });
  assert.deepEqual(await resultado, {
    estado: "ok", lead, registroContrato: contrato, falhaAoLerContrato: false, erroContrato: null,
  });
});

test("falha do contrato mantém o lead e bloqueia a seção em vez de abrir rascunho", async () => {
  const erro = new Error("falha fictícia de leitura");
  const resultado = await carregarDetalhe({
    lerLead: async () => ({ data: lead, error: null }),
    lerContrato: async () => { throw erro; },
  });
  assert.deepEqual(resultado, {
    estado: "ok", lead, registroContrato: null, falhaAoLerContrato: true, erroContrato: erro,
  });
});

test("contrato realmente ausente é diferente de contrato ilegível", async () => {
  const resultado = await carregarDetalhe({
    lerLead: async () => ({ data: lead, error: null }),
    lerContrato: async () => null,
  });
  assert.equal(resultado.estado, "ok");
  if (resultado.estado === "ok") assert.equal(resultado.falhaAoLerContrato, false);
});

test("lead só é inexistente quando a consulta terminou sem erro e sem registro", async () => {
  const resultado = await carregarDetalhe({
    lerLead: async () => ({ data: null, error: null }),
    lerContrato: async () => null,
  });
  assert.deepEqual(resultado, { estado: "ausente" });
  const erro = { message: "consulta indisponível", code: "erro-ficticio" };
  assert.deepEqual(await carregarDetalhe({
    lerLead: async () => ({ data: null, error: erro }),
    lerContrato: async () => null,
  }), { estado: "erro", erro });
});

test("exceção na consulta do lead também é falha, mesmo com contrato carregado", async () => {
  const erro = new Error("transporte fictício indisponível");
  assert.deepEqual(await carregarDetalhe({
    lerLead: () => { throw erro; },
    lerContrato: async () => contrato,
  }), { estado: "erro", erro });
});
