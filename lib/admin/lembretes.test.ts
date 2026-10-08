import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diasCorridos,
  estadoLembrete,
  SEM_LEMBRETE,
  TEMA_COBRANCA,
  TEMA_ULTIMA_TENTATIVA,
  temaCobranca,
} from "./lembretes";
import { ROTULO_CURTO_STATUS, ROTULO_STATUS, TEMA_COLUNA } from "./rotulos";
import { recusarMovimento } from "./status";
import { STATUS, type Status } from "@/lib/form/types";
import { maisNovoPrimeiro } from "./ordem";
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

test("a cobrança só existe em Enviado e em Esfriou", () => {
  const lead = enviadoHa(40);
  for (const status of STATUS) {
    const estado = estadoLembrete(lead, status as Status, AGORA);
    if (status === "enviado" || status === "esfriou") {
      assert.equal(estado.pendente, 30, `em ${status}, 40 dias tem que cobrar`);
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

// --------------------------------------------------------------- Esfriou

test("no Esfriou aparecem o Relembrar cliente e, aos 30 dias, a Última tentativa", () => {
  // O lead esfria no 7º dia: é lá que a Mel cobra.
  assert.equal(estadoLembrete(enviadoHa(8), "esfriou", AGORA).pendente, 7);
  assert.equal(estadoLembrete(enviadoHa(30), "esfriou", AGORA).pendente, 30);
  // Quem foi cobrado aos 7 silencia até os 30, com o selo.
  const cobrado = estadoLembrete(
    enviadoHa(15, { lembrete_7_em: new Date(AGORA - 7 * DIA).toISOString() }),
    "esfriou",
    AGORA,
  );
  assert.equal(cobrado.pendente, null);
  assert.equal(cobrado.cobrado, 7);
});

test("cores: Relembrar na tinta da coluna, Última tentativa vermelha, âmbar nunca mais", () => {
  // 7 dias: cinza no Esfriou; azul-claro em Enviado (quem ficou além da semana por update).
  assert.equal(temaCobranca("esfriou", estadoLembrete(enviadoHa(8), "esfriou", AGORA)), TEMA_COBRANCA.esfriou);
  assert.equal(temaCobranca("enviado", estadoLembrete(enviadoHa(8), "enviado", AGORA)), TEMA_COBRANCA.enviado);
  // 30 dias: vermelho, em qualquer coluna, como era antes.
  assert.equal(temaCobranca("esfriou", estadoLembrete(enviadoHa(31), "esfriou", AGORA)), TEMA_ULTIMA_TENTATIVA);
  assert.equal(temaCobranca("enviado", estadoLembrete(enviadoHa(31), "enviado", AGORA)), TEMA_ULTIMA_TENTATIVA);
  assert.match(TEMA_ULTIMA_TENTATIVA.cartao, /red/);
  // Sem cobrança pendente, cartão comum.
  assert.equal(temaCobranca("enviado", estadoLembrete(enviadoHa(3), "enviado", AGORA)), null);
  for (const tema of [...Object.values(TEMA_COBRANCA), TEMA_ULTIMA_TENTATIVA]) {
    assert.ok(!/amber/.test(Object.values(tema).join(" ")), "o âmbar saiu do quadro");
  }
  assert.match(TEMA_COBRANCA.enviado.cartao, /sky/);
  assert.match(TEMA_COBRANCA.esfriou.cartao, /zinc/);
  assert.match(TEMA_COLUNA.esfriou.ponto, /zinc/);
});

test("`esfriou` entrou no enum entre Virou cliente e Lead perdido, com rótulo e trânsito", () => {
  const i = STATUS.indexOf("esfriou");
  assert.equal(STATUS[i - 1], "virou_cliente");
  assert.equal(STATUS[i + 1], "perdido");
  assert.equal(ROTULO_STATUS.esfriou, "Esfriou");
  // Esfriou exige proposta, como Enviado: só esfria quem recebeu uma.
  assert.equal(recusarMovimento("aguardando_revisao", "esfriou", { temProposta: false }), "sem_proposta");
  // De lá a Mel leva para onde quiser: de volta (o cliente respondeu), cliente ou perdido.
  for (const para of ["enviado", "virou_cliente", "perdido"] as const) {
    assert.equal(recusarMovimento("esfriou", para, { temProposta: true }), null, para);
  }
  assert.equal(recusarMovimento("esfriou", "incompleto", { temProposta: true }), "destino_travado");
});

test("a faixa de destinos do celular cabe seis chips: rótulo curto de uma palavra", () => {
  // Em 360px cada chip tem ~52px por dentro; "Aguardando" sozinho mede ~57px.
  for (const status of STATUS) {
    const curto = ROTULO_CURTO_STATUS[status];
    assert.ok(!curto.includes(" ") && curto.length <= 7, `${status}: "${curto}"`);
  }
});

test("toda coluna ordena pela chegada do lead: o mais novo em cima, o mais antigo embaixo", () => {
  // Pedido do owner em 07/10/2026, "sempre": nem o cartão vermelho sobe.
  const fila = [
    { id: "agosto", created_at: "2026-08-19T14:00:00Z" },
    { id: "outubro", created_at: "2026-10-07T09:00:00Z" },
    { id: "setembro", created_at: "2026-09-12T23:59:59.123456+00:00" },
  ];
  assert.deepEqual(
    [...fila].sort(maisNovoPrimeiro).map((l) => l.id),
    ["outubro", "setembro", "agosto"],
  );
});
