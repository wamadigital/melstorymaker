"use client";

// Avisos do contrato, agrupados por gravidade. Os do SISTEMA sao regras fixas
// (montar.ts); os da REVISAO DA IA apontam o que um revisor juridico apontaria
// numa clausula; os da REDACAO DA IA dizem o que das observacoes ficou FORA do
// texto e em que secao do formulario resolver. Nenhum aviso muda o texto
// sozinho: quem decide e a Mel.

import { Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import type { Aviso } from "@/lib/contrato/tipos";
import { cn } from "@/lib/utils";
import { secaoCitada } from "@/components/admin/contrato/campos";
import { origemDoAviso, ROTULO_ORIGEM_AVISO } from "@/components/admin/contrato/estado";

const GRUPOS: {
  gravidade: Aviso["gravidade"];
  titulo: string;
  Icone: typeof OctagonAlert;
  caixa: string;
  icone: string;
}[] = [
  {
    gravidade: "bloqueante",
    titulo: "Corrija antes de enviar",
    Icone: OctagonAlert,
    caixa: "border-destructive/30 bg-destructive/5",
    icone: "text-destructive",
  },
  {
    gravidade: "atencao",
    titulo: "Atenção",
    Icone: TriangleAlert,
    caixa: "border-amber-300 bg-amber-50",
    icone: "text-amber-700",
  },
  {
    gravidade: "sugestao",
    titulo: "Sugestões",
    Icone: Lightbulb,
    caixa: "border-stone-200 bg-stone-50",
    icone: "text-stone-500",
  },
];

export function ListaAvisos({
  avisos,
  tituloDaClausula,
  onIrParaClausula,
  onIrParaSecao,
}: {
  avisos: readonly Aviso[];
  /** "CLÁUSULA 7 - DO PAGAMENTO" para uma clausula que esta no texto; null se nao esta. */
  tituloDaClausula: (id: string) => string | null;
  onIrParaClausula: (id: string) => void;
  /** Rola ate um bloco do formulario (id de `campos.ts`). */
  onIrParaSecao: (id: string) => void;
}) {
  if (avisos.length === 0) return null;

  return (
    <div role="status" className="space-y-3">
      {GRUPOS.map(({ gravidade, titulo, Icone, caixa, icone }) => {
        const doGrupo = avisos.filter((a) => a.gravidade === gravidade);
        if (doGrupo.length === 0) return null;
        return (
          <div key={gravidade} className={cn("space-y-2 rounded-lg border p-3", caixa)}>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Icone className={cn("size-4 shrink-0", icone)} />
              {titulo}
            </p>
            <ul className="space-y-2">
              {doGrupo.map((a, i) => {
                const origem = origemDoAviso(a);
                // O que ficou FORA do texto nao tem clausula para ver: o link
                // e para a secao do formulario que o aviso manda usar.
                const secao = origem === "redacao_ia" ? secaoCitada(a.texto) : null;
                const cabecalho = origem !== "redacao_ia" && a.clausula ? tituloDaClausula(a.clausula) : null;
                return (
                  <li key={`${a.origem}-${i}-${a.texto}`} className="space-y-0.5 text-sm">
                    <p className="wrap-anywhere">{a.texto}</p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>{ROTULO_ORIGEM_AVISO[origem]}</span>
                      {secao && (
                        <button
                          type="button"
                          onClick={() => onIrParaSecao(secao.id)}
                          className="text-left underline underline-offset-2 hover:text-foreground"
                        >
                          ir para a seção {secao.rotulo}
                        </button>
                      )}
                      {cabecalho && a.clausula && (
                        <button
                          type="button"
                          onClick={() => onIrParaClausula(a.clausula!)}
                          className="text-left underline underline-offset-2 hover:text-foreground"
                        >
                          ver {cabecalho}
                        </button>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
