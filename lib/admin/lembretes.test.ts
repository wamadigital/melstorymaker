import assert from "node:assert/strict";
import { test } from "node:test";
import { diasCorridos, estadoLembrete, SEM_LEMBRETE } from "./lembretes";
import { ROTULO_STATUS, TEMA_COLUNA } from "./rotulos";
import { recusarMovimento } from "./status";
import { STATUS, type Status } from "@/lib/form/types";
import { linkLembreteWhatsApp, mensagemLembrete } from "@/lib/whatsapp";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-09-03T12:00:00-03:00");

/** Lead enviado ha N dias, sem nenhuma cobranca feita. */
const enviadoHa = (dias: number, extra: Partial<Record<string, string | null>> = {}) => ({
  enviado_em: new Date(AGORA - dias * DIA).toISOString(),
  lembrete_7_em: null,
  lembrete_30_em: null,
  ...extra,
});

test("dias corridos saem da diferença em ms, não de componentes de data", () => {
  // O painel e renderizado num servidor em UTC e lido em Sao Paulo. Contar por
  // getDate() faria o mesmo lead cair em dias diferentes nos dois lados.
  assert.equal(diasCorridos(new Date(AGORA - 7 * DIA).toISOString(), AGORA), 7);
  assert.equal(diasCorridos(new Date(AGORA - 6.9 * DIA).toISOString(), AGORA), 6);
  assert.equal(diasCorridos(new Date(AGORA).toISOString(), AGORA), 0);
  // Data ilegivel nao pode virar NaN e pintar o cartao de vermelho por acidente.
  assert.equal(diasCorridos("nao e data", AGORA), 0);
});

test("a cobrança só existe dentro de Enviado", () => {
  const lead = enviadoHa(40);
  for (const status of STATUS) {
    const estado = estadoLembrete(lead, status as Status, AGORA);
    if (status === "enviado") {
      assert.equal(estado.pendente, 30, "em enviado, 40 dias tem que cobrar");
    } else {
      assert.deepEqual(estado, SEM_LEMBRETE, `${status} não devia cobrar nada`);
    }
  }
});

test("proposta sem data de envio não conta nada", () => {
  const estado = estadoLembrete(
    { enviado_em: null, lembrete_7_em: null, lembrete_30_em: null },
    "enviado",
    AGORA,
  );
  assert.deepEqual(estado, SEM_LEMBRETE);
});

test("a fronteira é exatamente 7 e exatamente 30", () => {
  // E onde um off-by-one passaria batido: a Mel cobrando no 6o dia irrita, e
  // no 8o ja perdeu a semana.
  assert.equal(estadoLembrete(enviadoHa(6), "enviado", AGORA).pendente, null);
  assert.equal(estadoLembrete(enviadoHa(7), "enviado", AGORA).pendente, 7);
  assert.equal(estadoLembrete(enviadoHa(29), "enviado", AGORA).pendente, 7);
  assert.equal(estadoLembrete(enviadoHa(30), "enviado", AGORA).pendente, 30);
});

test("cobrar apaga o alerta, e o selo diz qual cobrança foi feita", () => {
  const cobrado7 = enviadoHa(10, { lembrete_7_em: new Date(AGORA - DIA).toISOString() });
  const estado = estadoLembrete(cobrado7, "enviado", AGORA);
  assert.equal(estado.pendente, null, "cartao cobrado nao pode continuar gritando");
  assert.equal(estado.cobrado, 7);
  assert.equal(estado.marco, 7);
});

test("aos 30 dias o alerta volta, mesmo com a cobrança de 7 dias já feita", () => {
  const cobrado7 = enviadoHa(31, { lembrete_7_em: new Date(AGORA - 20 * DIA).toISOString() });
  assert.equal(estadoLembrete(cobrado7, "enviado", AGORA).pendente, 30);
});

test("lead de mês e meio pula os 7 dias e vai direto para a última tentativa", () => {
  // Cobrar "faz uma semana que te mandei" num lead de 45 dias seria mentira.
  const estado = estadoLembrete(enviadoHa(45), "enviado", AGORA);
  assert.equal(estado.marco, 30);
  assert.equal(estado.pendente, 30);
  assert.equal(estado.cobrado, null);
});

test("com as duas cobranças feitas o cartão silencia e mostra o selo de 30 dias", () => {
  const tudoCobrado = enviadoHa(35, {
    lembrete_7_em: new Date(AGORA - 28 * DIA).toISOString(),
    lembrete_30_em: new Date(AGORA - 2 * DIA).toISOString(),
  });
  const estado = estadoLembrete(tudoCobrado, "enviado", AGORA);
  assert.equal(estado.pendente, null);
  assert.equal(estado.cobrado, 30, "é este selo que diz à Mel que dá para arquivar");
});

test("a mensagem de cobrança leva o link da proposta de volta", () => {
  // Faz 7 (ou 30) dias: obrigar a pessoa a caçar a conversa antiga perderia o
  // lead pelo mesmo motivo de novo.
  for (const marco of [7, 30] as const) {
    const msg = mensagemLembrete(marco, "https://melstorymaker.com.br/p/a3f9");
    assert.ok(
      msg.split("\n").includes("https://melstorymaker.com.br/p/a3f9"),
      `lembrete de ${marco} dias precisa do link sozinho na linha`,
    );
  }
});

test("sem proposta gerada, a mensagem sai sem link quebrado", () => {
  for (const marco of [7, 30] as const) {
    const msg = mensagemLembrete(marco, null);
    assert.ok(!msg.includes("http"), `lembrete de ${marco} dias vazou link nenhum`);
    assert.ok(!msg.includes("null") && !msg.includes("undefined"));
    assert.ok(msg.trim().length > 0);
  }
});

test("as duas cobranças são mensagens diferentes", () => {
  assert.notEqual(mensagemLembrete(7, null), mensagemLembrete(30, null));
});

test("o link abre a conversa do lead; sem número, o seletor da Mel", () => {
  assert.ok(linkLembreteWhatsApp(7, "(19) 99999-8888", null).startsWith("https://wa.me/5519999998888?text="));
  assert.ok(linkLembreteWhatsApp(30, null, null).startsWith("https://wa.me/?text="));
});

test("`perdido` entrou no enum com rótulo, tema e trânsito próprios", () => {
  // Os mapas sao Record<Status, ...>: valor novo quebra o build ate alguem
  // escolher a cor. Este teste cobre o resto -- que ele seja ALCANCAVEL.
  assert.equal(ROTULO_STATUS.perdido, "Lead perdido");
  assert.ok(TEMA_COLUNA.perdido.ponto.length > 0);
  assert.equal(recusarMovimento("enviado", "perdido", { temProposta: true }), null);
  // Sem proposta tambem: da para perder um lead que nunca chegou a receber uma.
  assert.equal(recusarMovimento("aguardando_revisao", "perdido", { temProposta: false }), null);
  // E volta atras, se o cliente reaparecer.
  assert.equal(recusarMovimento("perdido", "enviado", { temProposta: true }), null);
  // A regra dura continua de pe: nada volta para `incompleto`.
  assert.equal(
    recusarMovimento("perdido", "incompleto", { temProposta: true }),
    "destino_travado",
  );
});
