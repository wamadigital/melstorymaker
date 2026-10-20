import assert from "node:assert/strict";
import { test } from "node:test";
import { compararCartoesNaColuna, prioridadeEsfriou } from "./ordem";
import type { DisparoWhatsApp, LeadCartao, SolicitacaoWhatsApp } from "./tipos";
import { STATUS } from "@/lib/form/types";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-10-15T18:00:00.000Z");
const iso = (dias: number) => new Date(AGORA - dias * DIA).toISOString();

function lead(id: string, dias: number, extra: Partial<LeadCartao> = {}): LeadCartao {
  return {
    id,
    created_at: iso(dias),
    enviado_em: iso(dias),
    lembrete_7_em: null,
    lembrete_30_em: null,
    status: "esfriou",
    categoria: "casamento",
    nome_display: id,
    data_evento: null,
    passo_atual: null,
    lembrete_email_em: null,
    chamado_whatsapp_em: null,
    qualificado_em: null,
    pdf_url: "https://example.invalid/proposta.pdf",
    whatsapp: "19988763916",
    email: null,
    ...extra,
  };
}

function ack(marco: 7 | 30, diasProposta: number, diasAck = 1): DisparoWhatsApp {
  return { tipo: marco === 7 ? "lembrete_proposta_7d" : "lembrete_proposta_30d",
    proposta_enviado_em: iso(diasProposta), enviado_em: iso(diasAck) };
}

function solicitacao(
  marco: 7 | 30,
  estado: SolicitacaoWhatsApp["estado"],
  diasProposta: number,
  extra: Partial<SolicitacaoWhatsApp> = {},
): SolicitacaoWhatsApp {
  return { tipo: marco === 7 ? "lembrete_proposta_7d" : "lembrete_proposta_30d", estado,
    proposta_enviado_em: iso(diasProposta), ocorrido_em: iso(0), motivo: null, ...extra };
}

test("Esfriou sobe última tentativa, primeiro lembrete e depois os demais; desempata pela chegada", () => {
  const cartoes = [
    lead("novo-sem-acao", 2),
    lead("primeiro-8", 8),
    lead("ultimo-40", 40, { disparos_whatsapp: [ack(7, 40, 20)] }),
    lead("enviado-10", 10, { disparos_whatsapp: [ack(7, 10)] }),
    lead("primeiro-35-sem-ack", 35),
    lead("ultimo-31", 31, { disparos_whatsapp: [ack(7, 31, 20)] }),
    lead("enviado-45", 45, { disparos_whatsapp: [ack(7, 45, 20), ack(30, 45)] }),
  ];
  assert.deepEqual(cartoes.sort((a, b) => compararCartoesNaColuna(a, b, "esfriou", AGORA)).map((item) => item.id), [
    "ultimo-31", "ultimo-40", "primeiro-8", "primeiro-35-sem-ack", "novo-sem-acao", "enviado-10", "enviado-45",
  ]);
});

test("outras colunas mantêm somente created_at descendente, inclusive Enviado", () => {
  const vermelho = lead("vermelho", 40, { disparos_whatsapp: [ack(7, 40, 20)] });
  const primeiro = lead("primeiro", 8);
  const novo = lead("novo", 1);
  for (const coluna of STATUS.filter((item) => item !== "esfriou")) {
    assert.deepEqual([vermelho, novo, primeiro].sort((a, b) => compararCartoesNaColuna(a, b, coluna, AGORA))
      .map((item) => item.id), ["novo", "primeiro", "vermelho"], coluna);
  }
});

test("a espera após o primeiro ACK sai da prioridade vermelha e volta no prazo exato", () => {
  const aguardando = lead("aguardando", 45, { disparos_whatsapp: [ack(7, 45, 15)] });
  const primeiro = lead("primeiro", 8);
  assert.equal(prioridadeEsfriou(aguardando, AGORA - 1), 2);
  assert.ok(compararCartoesNaColuna(aguardando, primeiro, "esfriou", AGORA - 1) > 0);
  assert.equal(prioridadeEsfriou(aguardando, AGORA), 0);
  assert.ok(compararCartoesNaColuna(aguardando, primeiro, "esfriou", AGORA) < 0);
  assert.equal(prioridadeEsfriou(aguardando, AGORA + 1), 0);
});

test("snapshots em curso, enviados ou indeterminados saem das prioridades acionáveis", () => {
  for (const marco of [7, 30] as const) {
    const dias = marco === 7 ? 8 : 40;
    for (const estado of ["pendente", "reservado", "enviando", "enviado", "indeterminado", "expirado", "cancelado"] as const) {
      assert.equal(prioridadeEsfriou(lead(`${marco}-${estado}`, dias, {
        disparos_whatsapp: marco === 30 ? [ack(7, dias, 20)] : [],
        solicitacoes_whatsapp: [solicitacao(marco, estado, dias)],
      }), AGORA), 2, `${marco}/${estado}`);
    }
  }
});

test("só cancelamento reativável comprovado libera novamente o grupo da ação", () => {
  assert.equal(prioridadeEsfriou(lead("cancelado", 8, {
    solicitacoes_whatsapp: [solicitacao(7, "cancelado", 8, { reenvioPermitido: true })],
  }), AGORA), 1);
  assert.equal(prioridadeEsfriou(lead("cancelado", 40, {
    disparos_whatsapp: [ack(7, 40, 20)],
    solicitacoes_whatsapp: [solicitacao(30, "cancelado", 40, { reenvioPermitido: true })],
  }), AGORA), 0);
  for (const reenvioPermitido of [false, undefined]) {
    assert.equal(prioridadeEsfriou(lead("definitivo", 8, {
      solicitacoes_whatsapp: [solicitacao(7, "cancelado", 8, { reenvioPermitido })],
    }), AGORA), 2);
  }
  assert.equal(prioridadeEsfriou(lead("expirado", 8, {
    solicitacoes_whatsapp: [solicitacao(7, "expirado", 8, { reenvioPermitido: true })],
  }), AGORA), 2);
});

test("uma revisão anterior ou outro tipo não esconde a ação atual", () => {
  assert.equal(prioridadeEsfriou(lead("reenviada", 8, {
    disparos_whatsapp: [ack(7, 40)],
    solicitacoes_whatsapp: [solicitacao(7, "enviado", 40)],
  }), AGORA), 1);
  assert.equal(prioridadeEsfriou(lead("ultima", 40, {
    disparos_whatsapp: [ack(7, 40, 20)],
    solicitacoes_whatsapp: [solicitacao(7, "enviado", 40)],
  }), AGORA), 0);
  const micros = "2026-10-07T18:00:00.000001+00:00";
  assert.equal(prioridadeEsfriou(lead("micros", 8, {
    enviado_em: micros, solicitacoes_whatsapp: [solicitacao(7, "enviado", 8)],
  }), AGORA), 1, "Date.parse truncaria as revisões diferentes para o mesmo milissegundo");
});

test("a solicitação mais recente prevalece sem alterar os snapshots de entrada", () => {
  const fila = [solicitacao(7, "pendente", 8, { ocorrido_em: iso(1) }),
    solicitacao(7, "cancelado", 8, { ocorrido_em: iso(0), reenvioPermitido: true })];
  const antes = structuredClone(fila);
  assert.equal(prioridadeEsfriou(lead("retry", 8, { solicitacoes_whatsapp: fila }), AGORA), 1);
  assert.deepEqual(fila, antes);
});

test("metadado de teste válido libera prioridade 30; expiração restaura primeira mensagem", () => {
  const teste = lead("TESTE HENRIQUE", 35, {
    teste_whatsapp: { marco: 30, expiraEm: new Date(AGORA + DIA).toISOString() },
  });
  assert.equal(prioridadeEsfriou(teste, AGORA), 0);
  assert.equal(prioridadeEsfriou(teste, AGORA + DIA), 1);
  assert.equal(prioridadeEsfriou({ ...teste,
    solicitacoes_whatsapp: [solicitacao(30, "pendente", 35)] }, AGORA), 2);
});

test("7 e 30 dias usam o instante explícito do servidor, incluindo as fronteiras", () => {
  const primeiro = lead("primeiro", 7);
  assert.equal(prioridadeEsfriou(primeiro, AGORA - 1), 2);
  assert.equal(prioridadeEsfriou(primeiro, AGORA), 1);
  const ultimo = lead("ultimo", 30, { disparos_whatsapp: [ack(7, 30, 20)] });
  assert.equal(prioridadeEsfriou(ultimo, AGORA - 1), 2);
  assert.equal(prioridadeEsfriou(ultimo, AGORA), 0);
});

test("o comparador usa a coluna desenhada no arraste, sem depender do status persistido", () => {
  const vermelho = lead("vermelho", 40, { status: "enviado", disparos_whatsapp: [ack(7, 40, 20)] });
  const novo = lead("novo", 2);
  assert.ok(compararCartoesNaColuna(vermelho, novo, "esfriou", AGORA) < 0);
  assert.ok(compararCartoesNaColuna(vermelho, novo, "enviado", AGORA) > 0);
});
