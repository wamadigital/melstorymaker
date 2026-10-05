import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIAS_ENTRE_LEMBRETES_EMAIL,
  estadoLembreteEmail,
  legendaLembreteEmail,
} from "./lembrete-email";
import { STATUS } from "@/lib/form/types";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-10-05T15:00:00-03:00");

/** Lead de "Novo" com e-mail, lembrado ha `dias` (ou nunca). */
const lead = (dias: number | null, email: string | null = "lucia@exemplo.com") => ({
  email,
  lembrete_email_em: dias === null ? null : new Date(AGORA - dias * DIA).toISOString(),
});

test("o botão só existe em Novo, e só com e-mail", () => {
  for (const status of STATUS) {
    const estado = estadoLembreteEmail(lead(null), status, AGORA);
    assert.equal(estado.visivel, status === "incompleto", `${status}: visível errado`);
  }
  // Sem ter para onde mandar, nao ha botao -- nem com espaco em branco no campo.
  assert.equal(estadoLembreteEmail(lead(null, null), "incompleto", AGORA).visivel, false);
  assert.equal(estadoLembreteEmail(lead(null, "  "), "incompleto", AGORA).visivel, false);
});

test("nunca lembrado: liberado, sem legenda", () => {
  const estado = estadoLembreteEmail(lead(null), "incompleto", AGORA);
  assert.deepEqual(estado, { visivel: true, liberado: true, ultimoEm: null });
  assert.equal(legendaLembreteEmail(estado), null);
});

test("a trava dura exatamente 7 dias, nem um minuto a mais", () => {
  // A fronteira e onde um off-by-one passaria batido: liberar no 6o dia manda
  // e-mail cedo demais; liberar no 8o deixa a Mel um dia sem poder agir.
  assert.equal(DIAS_ENTRE_LEMBRETES_EMAIL, 7);
  const quase = estadoLembreteEmail(lead(7 - 1 / 1440), "incompleto", AGORA);
  assert.equal(quase.visivel && quase.liberado, false, "faltando 1 minuto ainda trava");
  const vencido = estadoLembreteEmail(lead(7), "incompleto", AGORA);
  assert.equal(vencido.visivel && vencido.liberado, true, "aos 7 dias cheios libera");
});

test("travado: diz quando libera, arredondando para cima", () => {
  const recem = estadoLembreteEmail(lead(0), "incompleto", AGORA);
  assert.ok(recem.visivel && !recem.liberado);
  assert.equal(recem.diasParaLiberar, 7);
  assert.equal(recem.liberaEm, new Date(AGORA + 7 * DIA).toISOString());
  assert.equal(legendaLembreteEmail(recem), "Libera de novo em 7 dias");

  const umDiaDepois = estadoLembreteEmail(lead(1 + 1 / 86_400), "incompleto", AGORA);
  assert.ok(umDiaDepois.visivel && !umDiaDepois.liberado);
  assert.equal(umDiaDepois.diasParaLiberar, 6);

  // Faltando horas, ainda e "1 dia" -- e no singular.
  const ultimoDia = estadoLembreteEmail(lead(6.5), "incompleto", AGORA);
  assert.equal(legendaLembreteEmail(ultimoDia), "Libera de novo em 1 dia");
});

test("relógio adiantado entre servidores não vira 'libera em 8 dias'", () => {
  const noFuturo = { email: "lucia@exemplo.com", lembrete_email_em: new Date(AGORA + 5_000).toISOString() };
  const estado = estadoLembreteEmail(noFuturo, "incompleto", AGORA);
  assert.ok(estado.visivel && !estado.liberado);
  assert.equal(estado.diasParaLiberar, 7);
});

test("liberado de novo, a legenda lembra que já houve um", () => {
  // 15h de Sao Paulo, 8 dias antes: 27/09. A data sai no fuso da Mel, nao em UTC.
  const estado = estadoLembreteEmail(lead(8), "incompleto", AGORA);
  assert.ok(estado.visivel && estado.liberado);
  assert.equal(legendaLembreteEmail(estado), "Último lembrete em 27/09");
});

test("data ilegível não trava o botão para sempre", () => {
  const torto = { email: "lucia@exemplo.com", lembrete_email_em: "nao e data" };
  assert.deepEqual(estadoLembreteEmail(torto, "incompleto", AGORA), {
    visivel: true,
    liberado: true,
    ultimoEm: null,
  });
});

test("fora de Novo não há legenda", () => {
  assert.equal(legendaLembreteEmail(estadoLembreteEmail(lead(1), "enviado", AGORA)), null);
});
