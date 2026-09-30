import assert from "node:assert/strict";
import { test } from "node:test";
import { pagamentoSchema, type Pagamento, type Parcela } from "./tipos";
import {
  PRESETS_PAGAMENTO,
  PRESETS_PAGAMENTO_IDS,
  calcularParcelas,
  dataDoVencimento,
  dataISOValida,
  diaDoCalendario,
  letraParcela,
  pagamentoDoPreset,
  presetDoPagamento,
  calcularPersonalizado,
  interpretacaoVigente,
  manterInterpretacao,
  percentuaisFecham,
  somarDiasISO,
  validarPagamento,
  valorSinal,
} from "./pagamento";

const HOJE = "2026-09-29";
const EVENTO = "2027-01-23";

function parcela(percentual: number, sinal: boolean, vencimento: Parcela["vencimento"]): Parcela {
  return { percentual, sinal, vencimento };
}

function parcelas(...lista: Parcela[]): Pagamento {
  return { modo: "parcelas", parcelas: lista, quitadoEm: "", percentualSinalQuitado: 30, textoLivre: "", interpretacao: null };
}

const valores = (total: number, lista: Parcela[]) => calcularParcelas(total, lista).map((p) => p.valor);

// ---------------------------------------------------------------- calculo --

test("30/70 de R$ 1.290,00 = 387,00 + 903,00", () => {
  assert.deepEqual(valores(129000, pagamentoDoPreset("30/70").parcelas), [38700, 90300]);
});

test("15/15/70 de R$ 1.290,00 = 193,50 + 193,50 + 903,00", () => {
  assert.deepEqual(valores(129000, pagamentoDoPreset("15/15/70").parcelas), [19350, 19350, 90300]);
});

test("15/15/70 de R$ 2.450,00 = 367,50 + 367,50 + 1.715,00", () => {
  assert.deepEqual(valores(245000, pagamentoDoPreset("15/15/70").parcelas), [36750, 36750, 171500]);
});

test("33,33/33,33/33,34 de R$ 1.000,00 soma exatamente o total", () => {
  const lista = [
    parcela(33.33, true, { tipo: "assinatura" }),
    parcela(33.33, false, { tipo: "assinatura" }),
    parcela(33.34, false, { tipo: "assinatura" }),
  ];
  assert.deepEqual(valores(100000, lista), [33330, 33330, 33340]);
});

test("arredondamento half-up, e o residuo cai na ultima parcela", () => {
  // 30% de R$ 10,05 = 301,5 centavos -> 302; a ultima fecha o total.
  assert.deepEqual(valores(1005, pagamentoDoPreset("30/70").parcelas), [302, 703]);
  // Um terco de R$ 10,00: 333,3 -> 333, e o centavo que sobra vai para a ultima.
  const tercos = [parcela(33.33, true, { tipo: "assinatura" }), parcela(33.33, false, { tipo: "assinatura" }), parcela(33.34, false, { tipo: "assinatura" })];
  assert.deepEqual(valores(1000, tercos), [333, 333, 334]);
  // 0,5 centavo sobe (half-up), nao vai para o par.
  assert.deepEqual(valores(1, [parcela(50, true, { tipo: "assinatura" }), parcela(50, false, { tipo: "assinatura" })]), [1, 0]);
});

test("as parcelas SEMPRE somam o total, em qualquer valor, e nunca ficam negativas", () => {
  const presets = (["30/70", "50/50", "15/15/70", "integral"] as const).map((id) => pagamentoDoPreset(id).parcelas);
  presets.push([parcela(33.33, true, { tipo: "assinatura" }), parcela(33.33, false, { tipo: "assinatura" }), parcela(33.34, false, { tipo: "assinatura" })]);
  presets.push([parcela(12.5, true, { tipo: "assinatura" }), parcela(87.5, false, { tipo: "assinatura" })]);
  for (let total = 0; total <= 300_000; total += 1_237) {
    for (const lista of presets) {
      const calc = valores(total, lista);
      assert.equal(calc.reduce((s, v) => s + v, 0), total, `total ${total}`);
      assert.ok(calc.every((v) => Number.isInteger(v) && v >= 0), `total ${total}: ${calc}`);
    }
  }
});

test("percentuais que ainda nao fecham 100% nao empurram residuo para a ultima", () => {
  const lista = [parcela(30, true, { tipo: "assinatura" }), parcela(60, false, { tipo: "assinatura" })];
  assert.equal(percentuaisFecham(lista), false);
  assert.deepEqual(valores(100000, lista), [30000, 60000]);
});

test("total em float e recusado", () => {
  assert.throws(() => calcularParcelas(1290.5, pagamentoDoPreset("30/70").parcelas), RangeError);
  assert.throws(() => calcularParcelas(-1, pagamentoDoPreset("30/70").parcelas), RangeError);
});

test("sinal e a soma das parcelas marcadas; no quitado, a parte declarada", () => {
  assert.equal(valorSinal(129000, pagamentoDoPreset("30/70")), 38700);
  assert.equal(valorSinal(129000, pagamentoDoPreset("15/15/70")), 38700);
  assert.equal(valorSinal(245000, pagamentoDoPreset("15/15/70")), 73500);
  assert.equal(valorSinal(129000, pagamentoDoPreset("integral")), 38700);
  assert.equal(valorSinal(129000, pagamentoDoPreset("quitado")), 38700);
});

// ---------------------------------------------------------------- presets --

test("presets validos pelo schema, com os rotulos dos botoes do painel", () => {
  for (const id of PRESETS_PAGAMENTO_IDS) {
    const p = pagamentoDoPreset(id);
    assert.deepEqual(pagamentoSchema.parse(p), p, id);
    assert.deepEqual(PRESETS_PAGAMENTO[id].pagamento, p, id);
  }
  // Os botoes do painel, nesta ordem (pedido do owner em 30/09/2026).
  assert.deepEqual([...PRESETS_PAGAMENTO_IDS], ["30/70", "50/50", "quitado", "personalizado"]);
  assert.equal(PRESETS_PAGAMENTO["30/70"].rotulo, "30% + 70%");
  assert.equal(PRESETS_PAGAMENTO["50/50"].rotulo, "Metade-metade");
  assert.equal(PRESETS_PAGAMENTO.quitado.rotulo, "Já pago");
  assert.equal(PRESETS_PAGAMENTO.personalizado.rotulo, "Personalizado");
  // Estruturas antigas continuam sendo dados validos (contratos ja salvos).
  assert.equal(PRESETS_PAGAMENTO["15/15/70"].rotulo, "15% + 15% + 70%");
  assert.equal(PRESETS_PAGAMENTO.integral.rotulo, "Tudo na assinatura");
});

test("metade-metade: 50% de sinal na assinatura e 50% ate 10 dias antes do evento", () => {
  const p = pagamentoDoPreset("50/50");
  assert.deepEqual(p.parcelas, [
    { percentual: 50, sinal: true, vencimento: { tipo: "assinatura" } },
    { percentual: 50, sinal: false, vencimento: { tipo: "dias_antes", dias: 10 } },
  ]);
  assert.deepEqual(valores(247000, p.parcelas), [123500, 123500]);
  assert.equal(valorSinal(247000, p), 123500);
});

test("o painel reconhece o modelo do pagamento salvo; parcelas fora dos modelos nao casam com nenhum", () => {
  assert.equal(presetDoPagamento(pagamentoDoPreset("30/70")), "30/70");
  assert.equal(presetDoPagamento(pagamentoDoPreset("50/50")), "50/50");
  assert.equal(presetDoPagamento(pagamentoDoPreset("quitado")), "quitado");
  assert.equal(presetDoPagamento(pagamentoDoPreset("personalizado")), "personalizado");
  assert.equal(presetDoPagamento(pagamentoDoPreset("15/15/70")), null);
});

test("todo preset em parcelas tem sinal e fecha 100%", () => {
  for (const id of ["30/70", "50/50", "15/15/70", "integral"] as const) {
    const p = pagamentoDoPreset(id);
    assert.ok(percentuaisFecham(p.parcelas), id);
    assert.ok(p.parcelas.some((x) => x.sinal), id);
  }
  assert.equal(pagamentoDoPreset("quitado").modo, "quitado");
});

test("preset e copia nova a cada chamada; o compartilhado e congelado", () => {
  const a = pagamentoDoPreset("30/70");
  a.parcelas[0].percentual = 99;
  assert.equal(pagamentoDoPreset("30/70").parcelas[0].percentual, 30);
  assert.throws(() => {
    (PRESETS_PAGAMENTO["30/70"].pagamento.parcelas[0] as { percentual: number }).percentual = 1;
  }, TypeError);
});

// ------------------------------------------------------------------ datas --

test("datas ISO lidas sem fuso, e data que nao existe e recusada", () => {
  assert.ok(dataISOValida("2027-02-28"));
  assert.ok(dataISOValida("2028-02-29"), "bissexto");
  assert.equal(dataISOValida("2027-02-29"), false);
  assert.equal(dataISOValida("2027-02-30"), false);
  assert.equal(dataISOValida("2027-13-01"), false);
  assert.equal(dataISOValida("23/01/2027"), false);
  assert.equal(dataISOValida(""), false);
  assert.equal(somarDiasISO("2027-01-23", -10), "2027-01-13");
  assert.equal(somarDiasISO("2027-01-05", -10), "2026-12-26");
  assert.equal(somarDiasISO("2027-03-01", -1), "2027-02-28");
  assert.equal((diaDoCalendario("2027-01-02") ?? 0) - (diaDoCalendario("2027-01-01") ?? 0), 1);
});

test("data do vencimento de cada tipo, para a previa do painel", () => {
  assert.equal(dataDoVencimento({ tipo: "assinatura" }, EVENTO), null);
  assert.equal(dataDoVencimento({ tipo: "dias_antes", dias: 10 }, EVENTO), "2027-01-13");
  assert.equal(dataDoVencimento({ tipo: "dias_antes", dias: 10 }, ""), null);
  assert.equal(dataDoVencimento({ tipo: "data", data: "2026-12-10" }, EVENTO), "2026-12-10");
  assert.equal(dataDoVencimento({ tipo: "pago", data: "" }, EVENTO), null);
  assert.equal(letraParcela(0), "A");
  assert.equal(letraParcela(2), "C");
});

// -------------------------------------------------------------- validacao --

test("presets completos passam na validacao", () => {
  assert.deepEqual(validarPagamento(pagamentoDoPreset("30/70"), 129000, EVENTO, HOJE), []);
  assert.deepEqual(validarPagamento(pagamentoDoPreset("integral"), 129000, EVENTO, HOJE), []);
  const quinze = pagamentoDoPreset("15/15/70");
  quinze.parcelas[1].vencimento = { tipo: "data", data: "2026-12-10" };
  assert.deepEqual(validarPagamento(quinze, 129000, EVENTO, HOJE), []);
  const quitado = pagamentoDoPreset("quitado");
  quitado.quitadoEm = "2026-09-01";
  assert.deepEqual(validarPagamento(quitado, 129000, EVENTO, HOJE), []);
});

test("15/15/70 sem a data da segunda parcela acusa a falta, sem inventar data", () => {
  assert.deepEqual(validarPagamento(pagamentoDoPreset("15/15/70"), 129000, EVENTO, HOJE), [
    "Parcela B: informe a data de vencimento.",
  ]);
});

test("percentuais que nao somam 100 sao erro", () => {
  const p = parcelas(parcela(30, true, { tipo: "assinatura" }), parcela(60, false, { tipo: "dias_antes", dias: 10 }));
  assert.deepEqual(validarPagamento(p, 129000, EVENTO, HOJE), ["Os percentuais das parcelas somam 90%; precisam somar 100%."]);
  const acima = parcelas(parcela(30, true, { tipo: "assinatura" }), parcela(70.004, false, { tipo: "assinatura" }));
  assert.ok(validarPagamento(acima, 129000, EVENTO, HOJE).includes("Os percentuais das parcelas somam 100,004%; precisam somar 100%."));
});

test("tolerancia de 0,001 na soma, mas no maximo duas casas por parcela", () => {
  const tercos = parcelas(
    parcela(33.333, true, { tipo: "assinatura" }),
    parcela(33.333, false, { tipo: "assinatura" }),
    parcela(33.334, false, { tipo: "assinatura" }),
  );
  const erros = validarPagamento(tercos, 100000, EVENTO, HOJE);
  assert.ok(!erros.some((e) => e.startsWith("Os percentuais")), "a soma passa na tolerancia");
  assert.ok(erros.includes("Parcela A: use no máximo duas casas decimais no percentual."));
});

test("sem nenhuma parcela como sinal e erro", () => {
  const p = parcelas(parcela(30, false, { tipo: "assinatura" }), parcela(70, false, { tipo: "dias_antes", dias: 10 }));
  assert.deepEqual(validarPagamento(p, 129000, EVENTO, HOJE), [
    "Marque pelo menos uma parcela como sinal: é ela que garante a reserva da data.",
  ]);
});

test("parcela com 0% e lista vazia sao erro", () => {
  const p = parcelas(parcela(0, true, { tipo: "assinatura" }), parcela(100, false, { tipo: "assinatura" }));
  assert.ok(validarPagamento(p, 129000, EVENTO, HOJE).includes("Parcela A: informe o percentual."));
  assert.deepEqual(validarPagamento(parcelas(), 129000, EVENTO, HOJE), ["Inclua pelo menos uma parcela no pagamento."]);
});

test("data de vencimento sem ano ou inexistente", () => {
  const semAno = pagamentoDoPreset("15/15/70");
  semAno.parcelas[1].vencimento = { tipo: "data", data: "10/12" };
  assert.deepEqual(validarPagamento(semAno, 129000, EVENTO, HOJE), ["Parcela B: a data de vencimento precisa ter dia, mês e ano."]);

  const inexistente = pagamentoDoPreset("15/15/70");
  inexistente.parcelas[1].vencimento = { tipo: "data", data: "2027-02-30" };
  assert.deepEqual(validarPagamento(inexistente, 129000, "2027-03-20", HOJE), [
    "Parcela B: a data de vencimento não existe (30/02/2027).",
  ]);
});

test("vencimento depois do evento e erro; no proprio dia do evento, nao", () => {
  const depois = pagamentoDoPreset("15/15/70");
  depois.parcelas[1].vencimento = { tipo: "data", data: "2027-02-01" };
  assert.deepEqual(validarPagamento(depois, 129000, EVENTO, HOJE), [
    "Parcela B: o vencimento (01/02/2027) é depois do evento (23/01/2027); precisa ser até a data do evento.",
  ]);
  const noDia = pagamentoDoPreset("15/15/70");
  noDia.parcelas[1].vencimento = { tipo: "data", data: EVENTO };
  assert.deepEqual(validarPagamento(noDia, 129000, EVENTO, HOJE), []);
});

test("vencimento em data que ja passou pede 'já pago'", () => {
  const passado = pagamentoDoPreset("15/15/70");
  passado.parcelas[1].vencimento = { tipo: "data", data: "2026-09-01" };
  assert.deepEqual(validarPagamento(passado, 129000, EVENTO, HOJE), [
    "Parcela B: o vencimento (01/09/2026) já passou. Se ela já foi paga, use “já pago”.",
  ]);
});

/**
 * O caso de um contrato antigo: evento a poucos dias, e o saldo "até 10 dias
 * antes do evento" vencia antes de o contrato ser assinado.
 */
test("'N dias antes do evento' que cai antes de hoje e erro, e manda usar 'na assinatura'", () => {
  const erros = validarPagamento(pagamentoDoPreset("30/70"), 129000, "2026-10-05", HOJE);
  assert.deepEqual(erros, [
    "Parcela B: “até 10 dias antes do evento” cai em 25/09/2026, que já passou, e a parcela venceria antes da assinatura. Use “na assinatura”.",
  ]);
  // Cair exatamente hoje ainda da para pagar.
  assert.deepEqual(validarPagamento(pagamentoDoPreset("30/70"), 129000, "2026-10-09", HOJE), []);
});

test("parcela 'já pago' com data futura e erro; no passado ou hoje, nao", () => {
  const futuro = parcelas(parcela(30, true, { tipo: "pago", data: "2026-10-01" }), parcela(70, false, { tipo: "dias_antes", dias: 10 }));
  assert.deepEqual(validarPagamento(futuro, 129000, EVENTO, HOJE), [
    "Parcela A: a data do pagamento (01/10/2026) é futura; parcela ainda não paga usa outro vencimento.",
  ]);
  const passado = parcelas(parcela(30, true, { tipo: "pago", data: "2026-09-01" }), parcela(70, false, { tipo: "dias_antes", dias: 10 }));
  assert.deepEqual(validarPagamento(passado, 129000, EVENTO, HOJE), []);
  const hoje = parcelas(parcela(30, true, { tipo: "pago", data: HOJE }), parcela(70, false, { tipo: "dias_antes", dias: 10 }));
  assert.deepEqual(validarPagamento(hoje, 129000, EVENTO, HOJE), []);
  const semData = parcelas(parcela(30, true, { tipo: "pago", data: "" }), parcela(70, false, { tipo: "dias_antes", dias: 10 }));
  assert.deepEqual(validarPagamento(semData, 129000, EVENTO, HOJE), ["Parcela A: informe a data em que foi paga."]);
});

test("modo quitado: data obrigatoria, nao futura, e sinal declarado", () => {
  const semData = pagamentoDoPreset("quitado");
  assert.deepEqual(validarPagamento(semData, 129000, EVENTO, HOJE), ["Informe a data em que o pagamento foi quitado."]);

  const futuro = pagamentoDoPreset("quitado");
  futuro.quitadoEm = "2026-12-01";
  assert.deepEqual(validarPagamento(futuro, 129000, EVENTO, HOJE), [
    "A data da quitação (01/12/2026) é futura: quitado é pagamento já feito.",
  ]);

  const semSinal = pagamentoDoPreset("quitado");
  semSinal.quitadoEm = "2026-09-01";
  semSinal.percentualSinalQuitado = 0;
  assert.deepEqual(validarPagamento(semSinal, 129000, EVENTO, HOJE), [
    "Informe que parte do valor pago corresponde ao sinal (o padrão é 30%).",
  ]);

  const semAno = pagamentoDoPreset("quitado");
  semAno.quitadoEm = "01/09";
  assert.deepEqual(validarPagamento(semAno, 129000, EVENTO, HOJE), ["A data da quitação precisa ter dia, mês e ano."]);
});

test("sem data do evento valida, as checagens que dependem dela sao puladas (a montagem acusa a data)", () => {
  assert.deepEqual(validarPagamento(pagamentoDoPreset("30/70"), 129000, "", HOJE), []);
  const quinze = pagamentoDoPreset("15/15/70");
  quinze.parcelas[1].vencimento = { tipo: "data", data: "2027-12-10" };
  assert.deepEqual(validarPagamento(quinze, 129000, "", HOJE), []);
});

test("parcela que arredonda para R$ 0,00 e acusada", () => {
  const p = parcelas(parcela(1, true, { tipo: "assinatura" }), parcela(99, false, { tipo: "assinatura" }));
  assert.deepEqual(validarPagamento(p, 40, EVENTO, HOJE), ["Parcela A: o valor calculado fica em R$ 0,00."]);
});

// ---------------------------------------------------------- personalizado --

const grupo = (quantidade: number, valorCentavos: number | null, percentual: number | null, extra: Partial<{ sinal: boolean; determinavel: boolean; vencimento: string }> = {}) => ({
  quantidade,
  valorCentavos,
  percentual,
  vencimento: extra.vencimento ?? "na assinatura deste contrato",
  sinal: extra.sinal ?? false,
  determinavel: extra.determinavel ?? true,
});

const interp = (grupos: ReturnType<typeof grupo>[], textoFonte = "texto") => ({ textoFonte, grupos, pendencias: [] as string[] });

test("personalizado: a conta e do codigo -- valores em reais e em percentual viram centavos exatos", () => {
  const r = calcularPersonalizado(247000, interp([grupo(1, 74100, null, { sinal: true }), grupo(1, null, 70)]));
  assert.deepEqual(r.itens.map((i) => i.valorGrupo), [74100, 172900]);
  assert.equal(r.soma, 247000);
  assert.equal(r.sinal, 74100);
  assert.deepEqual(r.problemas, []);
});

test("personalizado: 'o resto em 3 vezes' fecha o total com o centavo na ultima parcela, num item so", () => {
  const r = calcularPersonalizado(247000, interp([grupo(1, 50000, null, { sinal: true }), grupo(3, null, 26.5857)]));
  assert.equal(r.soma, 247000);
  assert.deepEqual(r.problemas, []);
  const [, resto] = r.itens;
  assert.equal(resto.quantidade, 3);
  assert.equal(resto.valorParcela, 65667);
  assert.equal(resto.valorUltima, 65666);
  assert.equal(resto.valorGrupo, 197000);
});

test("personalizado: soma que nao bate com o total NAO e corrigida -- vira problema que bloqueia o PDF", () => {
  const r = calcularPersonalizado(247000, interp([grupo(8, 10000, null)]));
  assert.equal(r.soma, 80000);
  assert.equal(r.problemas.length, 1);
  assert.match(r.problemas[0], /somam R\$ 800,00, mas o valor total do contrato é R\$ 2\.470,00/);
});

test("personalizado: parcela sem vencimento determinavel e grupo vazio sao problemas", () => {
  const r = calcularPersonalizado(80000, interp([grupo(8, 10000, null, { determinavel: false, vencimento: "em 8 vezes" })]));
  assert.deepEqual(r.problemas, ["Parcela A (em 8 vezes): falta dizer quando vence."]);
  assert.match(calcularPersonalizado(80000, interp([])).problemas[0], /não conseguiu identificar as parcelas/);
});

test("personalizado: o sinal e so o que a IA marcou (sem entrada, sinal zero)", () => {
  const r = calcularPersonalizado(80000, interp([grupo(1, 80000, null, { vencimento: "na entrega do material" })]));
  assert.equal(r.sinal, 0);
  const p = { ...pagamentoDoPreset("personalizado"), textoLivre: "tudo na entrega", interpretacao: interp([grupo(1, 80000, null)], "tudo na entrega") };
  assert.equal(valorSinal(80000, p), 0);
});

test("personalizado: interpretacao so vale para o texto de que saiu", () => {
  const base = { ...pagamentoDoPreset("personalizado"), textoLivre: "8x de 100", interpretacao: interp([grupo(8, 10000, null)], "8x de 100") };
  assert.ok(interpretacaoVigente(base));
  assert.equal(interpretacaoVigente({ ...base, textoLivre: "10x de 80" }), null);
  // Espacos nas pontas nao invalidam.
  assert.ok(interpretacaoVigente({ ...base, textoLivre: "  8x de 100 " }));
});

test("personalizado: o servidor ignora a interpretacao que vem do navegador", () => {
  const doServidor = interp([grupo(8, 10000, null)], "8x de 100");
  const salvos = { pagamento: { ...pagamentoDoPreset("personalizado"), textoLivre: "8x de 100", interpretacao: doServidor } };
  const forjada = interp([grupo(1, 1, null)], "8x de 100");
  const recebidos = { pagamento: { ...pagamentoDoPreset("personalizado"), textoLivre: "8x de 100", interpretacao: forjada } };
  // O cast evita montar DadosContrato inteiro: a funcao so olha o pagamento.
  type D = Parameters<typeof manterInterpretacao>[0];
  assert.deepEqual(manterInterpretacao(recebidos as unknown as D, salvos as unknown as D).pagamento.interpretacao, doServidor);
  const mudado = { pagamento: { ...recebidos.pagamento, textoLivre: "10x de 80" } };
  assert.equal(manterInterpretacao(mudado as unknown as D, salvos as unknown as D).pagamento.interpretacao, null);
});

test("personalizado: sem texto, a montagem pede a descricao do pagamento", () => {
  assert.deepEqual(validarPagamento(pagamentoDoPreset("personalizado"), 129000, EVENTO, HOJE), [
    "Descreva a forma de pagamento (ex.: “30% de entrada na assinatura e o restante em 4 vezes, todo dia 10”).",
  ]);
  assert.deepEqual(validarPagamento({ ...pagamentoDoPreset("personalizado"), textoLivre: "metade agora, metade no dia" }, 129000, EVENTO, HOJE), []);
});
