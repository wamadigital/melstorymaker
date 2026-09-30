"use client";

// "Pagamento": presets, parcelas e o modo "ja pago".
//
// A Mel digita PERCENTUAIS; o valor de cada parcela em R$ e calculado ao vivo
// pela mesma funcao que escreve o contrato (`calcularParcelas`), com o
// arredondamento caindo na ultima parcela. Foi digitando valores que um
// contrato antigo saiu com parcelas que nao somavam o total.

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  calcularParcelas,
  dataDoVencimento,
  letraParcela,
  pagamentoDoPreset,
  PRESETS_PAGAMENTO,
  PRESETS_PAGAMENTO_IDS,
  percentuaisFecham,
  somaPercentuais,
  validarPagamento,
  valorSinal,
  type PresetPagamento,
} from "@/lib/contrato/pagamento";
import { formatarReais } from "@/lib/contrato/extenso";
import type { Pagamento, Parcela, Vencimento } from "@/lib/contrato/tipos";
import { dataCurta } from "@/lib/pdf/formatadores";
import { cn } from "@/lib/utils";
import {
  Campo,
  CampoTexto,
  CLASSE_SELECT,
  EntradaNumero,
  Marcador,
} from "@/components/admin/contrato/campos-ui";
import { textoDeNumero } from "@/components/admin/contrato/reais";
import { ID } from "@/components/admin/contrato/campos";

/** Limite do schema. */
const MAXIMO_PARCELAS = 12;

const TIPOS_VENCIMENTO: { valor: Vencimento["tipo"]; rotulo: string }[] = [
  { valor: "assinatura", rotulo: "Na assinatura" },
  { valor: "data", rotulo: "Numa data" },
  { valor: "dias_antes", rotulo: "Antes do evento" },
  { valor: "pago", rotulo: "Já paga" },
];

/** Troca o tipo do vencimento aproveitando a data que ja estava digitada. */
function trocarVencimento(atual: Vencimento, tipo: Vencimento["tipo"]): Vencimento {
  const data = atual.tipo === "data" || atual.tipo === "pago" ? atual.data : "";
  switch (tipo) {
    case "assinatura":
      return { tipo };
    case "data":
    case "pago":
      return { tipo, data };
    case "dias_antes":
      return { tipo, dias: atual.tipo === "dias_antes" ? atual.dias : 10 };
  }
}

/** Mesma ESTRUTURA do preset (percentuais, sinal, tipo de vencimento), ignorando as datas digitadas. */
function estruturaDe(p: Pagamento): string {
  if (p.modo === "quitado") return "quitado";
  return p.parcelas
    .map(
      (x) =>
        `${x.percentual}|${x.sinal}|${x.vencimento.tipo}|${x.vencimento.tipo === "dias_antes" ? x.vencimento.dias : ""}`,
    )
    .join(";");
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
  const setParcela = (i: number, patch: Partial<Parcela>) =>
    set({ parcelas: pagamento.parcelas.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const calculadas = pagamento.modo === "parcelas" ? calcularParcelas(total, pagamento.parcelas) : [];
  const erros = validarPagamento(pagamento, total, dataEvento, hojeISO);
  const estrutura = estruturaDe(pagamento);
  const soma = somaPercentuais(pagamento.parcelas);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className={cn("text-xs text-muted-foreground")} id="ct-pg-presets">
          Começar de um modelo
        </p>
        <div
          role="group"
          aria-labelledby="ct-pg-presets"
          className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          {PRESETS_PAGAMENTO_IDS.map((id: PresetPagamento) => {
            const ativo = estruturaDe(PRESETS_PAGAMENTO[id].pagamento) === estrutura;
            return (
              <Button
                key={id}
                type="button"
                size="lg"
                variant={ativo ? "default" : "outline"}
                aria-pressed={ativo}
                onClick={() => onPagamento(pagamentoDoPreset(id))}
                className="whitespace-normal"
              >
                {PRESETS_PAGAMENTO[id].rotulo}
              </Button>
            );
          })}
        </div>
      </div>

      {pagamento.modo === "parcelas" ? (
        <div id={ID.pg} tabIndex={-1} className="min-w-0 scroll-mt-6 space-y-3 outline-none">
          {pagamento.parcelas.map((parcela, i) => {
            const letra = letraParcela(i);
            const calc = calculadas[i];
            const vence = dataDoVencimento(parcela.vencimento, dataEvento);
            return (
              <div key={i} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium">
                    Parcela {letra}
                    <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                      {calc ? formatarReais(calc.valor) : ""}
                    </span>
                  </p>
                  {pagamento.parcelas.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      aria-label={`Remover a parcela ${letra}`}
                      onClick={() => set({ parcelas: pagamento.parcelas.filter((_, j) => j !== i) })}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>

                {/* No celular, um campo por linha: lado a lado com o percentual, o
                    select de vencimento ficava com 136px e cortava "Antes do
                    evento" em "Antes do ever". Do `sm` para cima, percentual
                    estreito, vencimento e a data (ou os dias) na mesma linha. */}
                <div className="grid gap-3 sm:grid-cols-[7rem_13rem_minmax(0,1fr)]">
                  <Campo id={ID.pgPercentual(i)} rotulo="Percentual">
                    <EntradaNumero
                      id={ID.pgPercentual(i)}
                      valor={parcela.percentual}
                      onValor={(n) => setParcela(i, { percentual: n })}
                      min={0}
                      max={100}
                      decimais={2}
                      sufixo="%"
                    />
                  </Campo>
                  <Campo id={ID.pgVencimento(i)} rotulo="Vencimento">
                    <select
                      id={ID.pgVencimento(i)}
                      value={parcela.vencimento.tipo}
                      onChange={(e) =>
                        setParcela(i, {
                          vencimento: trocarVencimento(
                            parcela.vencimento,
                            e.target.value as Vencimento["tipo"],
                          ),
                        })
                      }
                      className={CLASSE_SELECT}
                    >
                      {TIPOS_VENCIMENTO.map((t) => (
                        <option key={t.valor} value={t.valor}>
                          {t.rotulo}
                        </option>
                      ))}
                    </select>
                  </Campo>

                  {(parcela.vencimento.tipo === "data" || parcela.vencimento.tipo === "pago") && (
                    <CampoTexto
                      id={ID.pgData(i)}
                      rotulo={parcela.vencimento.tipo === "pago" ? "Paga em" : "Vence em"}
                      tipo="date"
                      valor={parcela.vencimento.data}
                      onValor={(v) =>
                        setParcela(i, {
                          vencimento: { tipo: parcela.vencimento.tipo as "data" | "pago", data: v },
                        })
                      }
                    />
                  )}
                  {parcela.vencimento.tipo === "dias_antes" && (
                    <Campo
                      id={ID.pgDias(i)}
                      rotulo="Dias antes do evento"
                      dica={vence ? `Vence em ${dataCurta(vence)}.` : undefined}
                    >
                      <EntradaNumero
                        id={ID.pgDias(i)}
                        valor={parcela.vencimento.dias}
                        onValor={(n) => setParcela(i, { vencimento: { tipo: "dias_antes", dias: n } })}
                        min={0}
                        max={365}
                        ariaDescribedBy={vence ? `${ID.pgDias(i)}-dica` : undefined}
                      />
                    </Campo>
                  )}
                </div>

                <Marcador
                  id={ID.pgSinal(i)}
                  rotulo="É sinal (garante a reserva da data)"
                  marcado={parcela.sinal}
                  onMarcado={(v) => setParcela(i, { sinal: v })}
                />
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {pagamento.parcelas.length < MAXIMO_PARCELAS && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() =>
                  set({
                    parcelas: [
                      ...pagamento.parcelas,
                      // O que falta para 100% ja vem sugerido.
                      {
                        percentual: Math.max(0, Number((100 - soma).toFixed(2))),
                        sinal: false,
                        vencimento: { tipo: "assinatura" },
                      },
                    ],
                  })
                }
              >
                <Plus />
                Adicionar parcela
              </Button>
            )}
            <p
              className={cn(
                "text-xs tabular-nums",
                percentuaisFecham(pagamento.parcelas) ? "text-muted-foreground" : "text-amber-800",
              )}
            >
              Soma dos percentuais: {textoDeNumero(Number(soma.toFixed(3)), 3)}%{" · "}sinal:{" "}
              {formatarReais(valorSinal(total, pagamento))}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            id={ID.pgQuitadoEm}
            rotulo="Pago integralmente em"
            tipo="date"
            valor={pagamento.quitadoEm}
            onValor={(v) => set({ quitadoEm: v })}
          />
          <Campo
            id={ID.pgSinalQuitado}
            rotulo="Parte do valor pago que é o sinal"
            dica={`Sinal: ${formatarReais(valorSinal(total, pagamento))}. É o que fica retido em caso de desistência.`}
          >
            <EntradaNumero
              id={ID.pgSinalQuitado}
              valor={pagamento.percentualSinalQuitado}
              onValor={(n) => set({ percentualSinalQuitado: n })}
              min={0}
              max={100}
              decimais={2}
              sufixo="%"
              ariaDescribedBy={`${ID.pgSinalQuitado}-dica`}
            />
          </Campo>
        </div>
      )}

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
