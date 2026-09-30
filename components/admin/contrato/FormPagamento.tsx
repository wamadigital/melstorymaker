"use client";

// "Pagamento": quatro opcoes e quase nenhum campo (pedido do owner em
// 30/09/2026). Os dois modelos prontos (30/70 e metade-metade) aparecem como
// resumo, sem editor de parcelas: sao o caso de quase todo contrato, e um
// editor de percentuais, vencimentos e sinal por parcela era componente demais
// para a Mel preencher. O que foge deles vai em "Personalizado", em texto livre
// ("8 vezes de R$ 100", "tudo depois que eu entregar"), e a IA transforma em
// clausula na hora de gerar o texto -- com o sistema conferindo se as parcelas
// somam o total e se toda parcela tem vencimento.
//
// Os valores em R$ continuam CALCULADOS pela mesma funcao que escreve o
// contrato (`calcularParcelas` / `calcularPersonalizado`), nunca digitados.

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  calcularParcelas,
  calcularPersonalizado,
  dataDoVencimento,
  interpretacaoVigente,
  letraParcela,
  pagamentoDoPreset,
  presetDoPagamento,
  PRESETS_PAGAMENTO,
  PRESETS_PAGAMENTO_IDS,
  validarPagamento,
  valorSinal,
  type PresetPagamento,
} from "@/lib/contrato/pagamento";
import { formatarPercentual, formatarReais } from "@/lib/contrato/extenso";
import type { Pagamento, Vencimento } from "@/lib/contrato/tipos";
import { dataCurta } from "@/lib/pdf/formatadores";
import { cn } from "@/lib/utils";
import { CampoTexto } from "@/components/admin/contrato/campos-ui";
import { ID } from "@/components/admin/contrato/campos";

/** Limite do schema. */
const MAXIMO_TEXTO = 3000;

/** Como cada vencimento aparece no resumo do painel (o contrato tem a frase dele). */
function vencimentoNoResumo(v: Vencimento, dataEvento: string): string {
  switch (v.tipo) {
    case "assinatura":
      return "na assinatura";
    case "data":
      return v.data ? `em ${dataCurta(v.data)}` : "data a informar";
    case "pago":
      return v.data ? `já paga em ${dataCurta(v.data)}` : "já paga";
    case "dias_antes": {
      const vence = dataDoVencimento(v, dataEvento);
      const dias = v.dias === 1 ? "1 dia" : `${v.dias} dias`;
      return `até ${dias} antes do evento${vence ? ` (${dataCurta(vence)})` : ""}`;
    }
  }
}

export function FormPagamento({
  pagamento,
  onPagamento,
  total,
  dataEvento,
  hojeISO,
}: {
  pagamento: Pagamento;
  onPagamento: (p: Pagamento) => void;
  /** Centavos, de `totalContrato`. */
  total: number;
  dataEvento: string;
  hojeISO: string;
}) {
  const set = (patch: Partial<Pagamento>) => onPagamento({ ...pagamento, ...patch });
  const ativo = presetDoPagamento(pagamento);
  const erros = validarPagamento(pagamento, total, dataEvento, hojeISO);

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Forma de pagamento"
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
      >
        {PRESETS_PAGAMENTO_IDS.map((id: PresetPagamento) => (
          <Button
            key={id}
            type="button"
            size="lg"
            variant={ativo === id ? "default" : "outline"}
            aria-pressed={ativo === id}
            // Escolher de novo o que ja esta escolhido nao apaga nada (o texto
            // do personalizado, a data do "já pago").
            onClick={() => ativo !== id && onPagamento(pagamentoDoPreset(id))}
            className="whitespace-normal"
          >
            {PRESETS_PAGAMENTO[id].rotulo}
          </Button>
        ))}
      </div>

      <div id={ID.pg} tabIndex={-1} className="min-w-0 scroll-mt-6 space-y-3 outline-none">
        {pagamento.modo === "parcelas" && (
          <ResumoParcelas pagamento={pagamento} total={total} dataEvento={dataEvento} modelo={ativo} />
        )}

        {pagamento.modo === "quitado" && (
          <div className="space-y-2">
            <div className="max-w-xs">
              <CampoTexto
                id={ID.pgQuitadoEm}
                rotulo="Pago integralmente em"
                tipo="date"
                valor={pagamento.quitadoEm}
                onValor={(v) => set({ quitadoEm: v })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatarPercentual(pagamento.percentualSinalQuitado)} do valor pago (
              {formatarReais(valorSinal(total, pagamento))}) conta como sinal: é o que fica retido em caso
              de desistência.
            </p>
          </div>
        )}

        {pagamento.modo === "personalizado" && (
          <Personalizado pagamento={pagamento} total={total} onTexto={(textoLivre) => set({ textoLivre })} />
        )}
      </div>

      {erros.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">Para fechar o pagamento:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {erros.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Os modelos prontos, so para ler: letra, percentual, quando vence e o valor. */
function ResumoParcelas({
  pagamento,
  total,
  dataEvento,
  modelo,
}: {
  pagamento: Pagamento;
  total: number;
  dataEvento: string;
  modelo: PresetPagamento | null;
}) {
  const calculadas = calcularParcelas(total, pagamento.parcelas);
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border">
        {calculadas.map((p, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm">
            <span className="font-medium">
              {letraParcela(i)}. {formatarPercentual(p.percentual)}
            </span>
            <span className="min-w-0 flex-1 text-muted-foreground">
              {vencimentoNoResumo(p.vencimento, dataEvento)}
              {p.sinal && " · sinal (reserva a data)"}
            </span>
            <span className="tabular-nums">{formatarReais(p.valor)}</span>
          </li>
        ))}
      </ul>
      {/* Contrato salvo antes da simplificacao, com parcelas que nao sao
          nenhum dos modelos: continua valendo, so nao se edita mais aqui. */}
      {modelo === null && (
        <p className="text-xs text-muted-foreground">
          Parcelas de um contrato salvo antes. Para mudar, escolha um modelo acima ou descreva em
          “Personalizado”.
        </p>
      )}
    </div>
  );
}

/**
 * Texto livre + o que a IA entendeu dele, quando ja entendeu. A leitura so
 * acontece ao gerar o texto do contrato; mudar o texto depois invalida a
 * leitura anterior, e o painel diz isso em vez de mostrar parcelas velhas.
 */
function Personalizado({
  pagamento,
  total,
  onTexto,
}: {
  pagamento: Pagamento;
  total: number;
  onTexto: (texto: string) => void;
}) {
  const interp = interpretacaoVigente(pagamento);
  const calc = interp ? calcularPersonalizado(total, interp) : null;
  const leituraVelha = !interp && pagamento.interpretacao !== null;
  const idDica = `${ID.pgTexto}-dica`;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={ID.pgTexto} className="text-xs text-muted-foreground">
          Como vai ser o pagamento
        </label>
        <Textarea
          id={ID.pgTexto}
          value={pagamento.textoLivre}
          onChange={(e) => onTexto(e.target.value.slice(0, MAXIMO_TEXTO))}
          rows={4}
          aria-describedby={idDica}
          placeholder="Ex.: 30% de entrada na assinatura e o restante em 4 vezes, todo dia 10, de janeiro a abril de 2027."
        />
        <p id={idDica} className="text-xs text-muted-foreground">
          Escreva do seu jeito. Ao gerar o texto do contrato, a IA transforma isto na cláusula de
          pagamento e o sistema confere se as parcelas somam o total ({formatarReais(total)}). Diga qual
          parcela é a entrada (sinal): é ela que fica retida se a cliente desistir.
        </p>
      </div>

      {leituraVelha && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          O texto mudou depois da última leitura da IA. Gere o texto do contrato de novo para ela conferir.
        </p>
      )}

      {calc && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Como a IA entendeu:</p>
          <ul className="divide-y rounded-lg border">
            {calc.itens.map((it, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm">
                <span className="font-medium">
                  {letraParcela(i)}. {it.quantidade > 1 ? `${it.quantidade}x ${formatarReais(it.valorParcela)}` : formatarReais(it.valorGrupo)}
                </span>
                <span className={cn("min-w-0 flex-1", it.determinavel ? "text-muted-foreground" : "text-amber-800")}>
                  {it.vencimento}
                  {it.sinal && " · sinal (reserva a data)"}
                </span>
                {it.quantidade > 1 && <span className="tabular-nums">{formatarReais(it.valorGrupo)}</span>}
              </li>
            ))}
          </ul>
          <p
            className={cn(
              "text-xs tabular-nums",
              calc.soma === total ? "text-muted-foreground" : "text-amber-800",
            )}
          >
            Soma das parcelas: {formatarReais(calc.soma)} de {formatarReais(total)}
            {calc.sinal > 0 ? ` · sinal: ${formatarReais(calc.sinal)}` : " · sem sinal"}
          </p>
          {calc.problemas.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-lg border border-amber-300 bg-amber-50 p-3 pl-7 text-xs text-amber-900">
              {calc.problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
