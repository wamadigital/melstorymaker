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
