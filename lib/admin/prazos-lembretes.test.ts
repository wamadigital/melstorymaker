import assert from "node:assert/strict";
import { test } from "node:test";
import { atrasoProximaMudancaLembrete } from "./prazos-lembretes";
import type { DisparoWhatsApp, LeadCartao } from "./tipos";
import { STATUS } from "@/lib/form/types";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-10-15T18:00:00Z");
const iso = (dias: number) => new Date(AGORA - dias * DIA).toISOString();
type Cartao = Parameters<typeof atrasoProximaMudancaLembrete>[0][number];
function lead(dias: number, extra: Partial<LeadCartao> = {}): Cartao {
  return { status: "esfriou", enviado_em: iso(dias), lembrete_7_em: null, lembrete_30_em: null, ...extra };
}
function ack(marco: 7 | 30, diasProposta: number, diasAck = 1): DisparoWhatsApp {
  return { tipo: marco === 7 ? "lembrete_proposta_7d" : "lembrete_proposta_30d",
    proposta_enviado_em: iso(diasProposta), enviado_em: iso(diasAck) };
}

test("agenda a fronteira de sete dias mais próxima, sem usar o relógio do navegador", () => {
  assert.equal(atrasoProximaMudancaLembrete([lead(2), lead(6.5), lead(6)], AGORA), DIA / 2);
  assert.equal(atrasoProximaMudancaLembrete([lead(7)], AGORA - 1), 1);
  assert.equal(atrasoProximaMudancaLembrete([lead(7)], AGORA), null);
  assert.equal(atrasoProximaMudancaLembrete([lead(8)], AGORA), null);
});

test("trinta dias só agenda quando o primeiro ACK pertence à proposta vigente", () => {
  assert.equal(atrasoProximaMudancaLembrete([lead(29)], AGORA), null);
  const atual = lead(29, { disparos_whatsapp: [ack(7, 29, 20)] });
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA), DIA);
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA - 1), 1);
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA), null);
  assert.equal(atrasoProximaMudancaLembrete([lead(29, { disparos_whatsapp: [ack(7, 40)] })], AGORA), null);
  assert.equal(atrasoProximaMudancaLembrete([lead(29, {
    disparos_whatsapp: [ack(7, 29)], enviado_em: "2026-09-16T18:00:00.000001+00:00",
  })], AGORA), null, "revisões diferentes no mesmo milissegundo não servem como ACK");
});

test("agenda o fim da espera de 15 dias mesmo quando a proposta já passou dos trinta", () => {
  for (const status of ["enviado", "esfriou"] as const) {
    const atual = lead(45, { status, disparos_whatsapp: [ack(7, 45, 14)] });
    assert.equal(atrasoProximaMudancaLembrete([atual], AGORA), DIA);
    assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA - 1), 1);
    assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA), null);
    assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA + 1), null);
  }
});

test("o timer escolhe o prazo posterior e não antecipa a liberação no trigésimo dia", () => {
  const atual = lead(29, { disparos_whatsapp: [ack(7, 29, 1)] });
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA), DIA, "atualiza o marco aos trinta dias");
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA), 13 * DIA);
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + 14 * DIA), null);
});

test("ACK inválido, futuro ou de outra proposta não fabrica prazo futuro", () => {
  for (const enviado_em of ["inválido", new Date(AGORA + 1).toISOString(), iso(46)]) {
    assert.equal(atrasoProximaMudancaLembrete([lead(45, {
      disparos_whatsapp: [{ ...ack(7, 45), enviado_em }],
    })], AGORA), null, enviado_em);
  }
  assert.equal(atrasoProximaMudancaLembrete([lead(45, { disparos_whatsapp: [ack(7, 46, 20)] })], AGORA), null);
});

test("expirar o teste restaura a espera normal e depois agenda o ACK7 mais quinze dias", () => {
  const atual = lead(45, { disparos_whatsapp: [ack(7, 45, 1)],
    teste_whatsapp: { marco: 30, expiraEm: new Date(AGORA + DIA).toISOString() } });
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA), DIA);
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + DIA), 13 * DIA);
  assert.equal(atrasoProximaMudancaLembrete([atual], AGORA + 14 * DIA), null);
});

test("ignora demais colunas e entradas sem data válida", () => {
  for (const status of STATUS) {
    assert.equal(atrasoProximaMudancaLembrete([lead(6, { status })], AGORA),
      status === "enviado" || status === "esfriou" ? DIA : null, status);
  }
  for (const enviado_em of [null, "inválido"]) {
    assert.equal(atrasoProximaMudancaLembrete([lead(6, { enviado_em })], AGORA), null);
  }
  assert.equal(atrasoProximaMudancaLembrete([], AGORA), null);
  assert.equal(atrasoProximaMudancaLembrete([lead(6)], NaN), null);
});

test("teste válido agenda os trinta dias e a expiração, sem estender sua autorização", () => {
  const teste = lead(29, { teste_whatsapp: { marco: 30, expiraEm: new Date(AGORA + 2 * DIA).toISOString() } });
  assert.equal(atrasoProximaMudancaLembrete([teste], AGORA), DIA);
  assert.equal(atrasoProximaMudancaLembrete([teste], AGORA + DIA), DIA);
  assert.equal(atrasoProximaMudancaLembrete([teste], AGORA + 2 * DIA), null);
  const expiraAntes = lead(29, { teste_whatsapp: { marco: 30, expiraEm: new Date(AGORA + DIA / 2).toISOString() } });
  assert.equal(atrasoProximaMudancaLembrete([expiraAntes], AGORA), DIA / 2);
  assert.equal(atrasoProximaMudancaLembrete([expiraAntes], AGORA + DIA / 2), null);
});

test("nenhum timer periódico é necessário depois dos marcos já atendidos", () => {
  assert.equal(atrasoProximaMudancaLembrete([lead(45, {
    disparos_whatsapp: [ack(7, 45, 20), ack(30, 45)],
  })], AGORA), null);
});
