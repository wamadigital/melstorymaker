"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Campo, Recado } from "@/components/admin/contrato/campos-ui";
import { FormServico } from "@/components/admin/contrato/FormServico";
import { duracaoCurta, formatarReais } from "@/lib/contrato/extenso";
import { totalContrato } from "@/lib/contrato/montar";
import {
  editarCondicoesCasamento,
  editarServicoCasamento,
  mudarModoCasamento,
  OPCOES_CASAMENTO,
  opcaoCasamentoSelecionada,
  selecionarOpcaoCasamento,
} from "@/lib/contrato/negociacao-casamento";
import type { DadosContrato, Servico } from "@/lib/contrato/tipos";

/** Negociação privada do contrato. Nunca grava no lead nem na proposta comercial. */
export function FormServicoCasamento({
  dados,
  onDados,
}: {
  dados: DadosContrato;
  onDados: (dados: DadosContrato) => void;
}) {
  const selecionada = opcaoCasamentoSelecionada(dados);
  const configuracao = selecionada ? dados.negociacaoCasamento?.[selecionada] : null;
  const personalizada = configuracao?.modo === "personalizado";
  const legada = selecionada === null && !!dados.servico.pacote;

  function escolher(opcao: (typeof OPCOES_CASAMENTO)[number]["id"]) {
    if (
      legada &&
      !window.confirm(
        "Este contrato já tem condições salvas. Ao escolher uma opção, elas serão substituídas pelas condições originais dessa opção. Deseja continuar?",
      )
    ) return;
    onDados(selecionarOpcaoCasamento(dados, opcao));
  }

  return (
    <div className="min-w-0 space-y-4">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-xs text-muted-foreground">Opção escolhida para o contrato</legend>
        <div className="grid grid-cols-2 gap-2">
          {OPCOES_CASAMENTO.map((opcao) => (
            <Button
              key={opcao.id}
              type="button"
              variant={selecionada === opcao.id ? "default" : "outline"}
              className="h-auto min-h-14 min-w-0 flex-col gap-0.5 whitespace-normal px-2 py-2 text-center"
              aria-pressed={selecionada === opcao.id}
              onClick={() => escolher(opcao.id)}
            >
              <span>{opcao.rotulo}</span>
              <span className="text-xs font-normal">{opcao.pacote}</span>
              {dados.negociacaoCasamento?.[opcao.id].modo === "personalizado" && (
                <span className="text-[10px] font-normal">Personalizada</span>
              )}
            </Button>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        As alterações ficam somente neste contrato. A proposta comercial original é preservada.
      </p>

      {selecionada && (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-2 text-xs text-muted-foreground">Condições desta opção</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant={!personalizada ? "default" : "outline"}
              className="h-auto min-h-10 whitespace-normal py-2"
              aria-pressed={!personalizada}
              onClick={() => onDados(mudarModoCasamento(dados, "original"))}
            >
              Usar condições originais
            </Button>
            <Button
              type="button"
              variant={personalizada ? "default" : "outline"}
              className="h-auto min-h-10 whitespace-normal py-2"
              aria-pressed={personalizada}
              onClick={() => onDados(mudarModoCasamento(dados, "personalizado"))}
            >
              Personalizar esta opção
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Cada opção guarda sua própria negociação. Trocar de opção ou voltar às condições originais
            mantém os ajustes. Salve o rascunho para preservá-los ao sair.
          </p>
        </fieldset>
      )}

      {legada && (
        <Recado tom="info">
          Este contrato já tinha condições próprias salvas. Elas foram mantidas. Escolha uma opção acima
          somente se quiser substituí-las.
        </Recado>
      )}

      {personalizada || legada ? (
        <FormServico
          key={selecionada ?? "legado"}
          templateId="casamento"
          servico={dados.servico}
          onServico={(servico) =>
            onDados(legada ? { ...dados, servico } : editarServicoCasamento(dados, servico))
          }
          dataEvento={dados.evento.data}
          personalizacaoCasamento
        />
      ) : selecionada ? (
        <ResumoServico servico={dados.servico} />
      ) : (
        <Recado tom="info">Escolha a Opção 1 ou a Opção 2 para definir as condições do contrato.</Recado>
      )}

      {personalizada && (
        <Campo
          id="ct-casamento-condicoes"
          rotulo="Outras condições da contratação (opcional)"
          dica="Entram no contrato exatamente como você escrever, sem alteração pela IA."
        >
          <Textarea
            id="ct-casamento-condicoes"
            value={configuracao?.condicoes ?? ""}
            onChange={(e) => onDados(editarCondicoesCasamento(dados, e.target.value.slice(0, 6000)))}
            maxLength={6000}
            aria-describedby="ct-casamento-condicoes-dica"
            placeholder="Ex.: a cobertura se encerra após a primeira dança."
            className="min-h-28"
          />
        </Campo>
      )}
    </div>
  );
}

function ResumoServico({ servico }: { servico: Servico }) {
  const escopo = servico.escopo;
  const itens = [
    `${duracaoCurta(escopo.minutosCobertura)} de cobertura${escopo.abrangencia ? `, abrangendo ${escopo.abrangencia}` : ""}.`,
    ...(escopo.minutosMakingOf > 0 ? [`${duracaoCurta(escopo.minutosMakingOf)} de making of.`] : []),
    ...(escopo.stories ? ["Stories ilimitados."] : []),
    ...(escopo.tempoReal ? ["Publicação em tempo real durante o evento."] : []),
    `${escopo.storymakers} ${escopo.storymakers === 1 ? "storymaker" : "storymakers"}.`,
    ...escopo.reels.map((reel) => `Reels de até ${escopo.segundosReels} segundos: ${reel}.`),
    ...escopo.extras,
    ...servico.adicionais.map((adicional) => adicional.descricao),
  ];
  return (
    <div className="space-y-3 rounded-lg bg-muted p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Condições originais · {servico.pacote}</p>
        <p className="text-xs text-muted-foreground">Tabela de preço {servico.tabela}</p>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        {itens.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground">Total do contrato</p>
        <p className="text-lg font-semibold tabular-nums">{formatarReais(totalContrato(servico))}</p>
      </div>
    </div>
  );
}
