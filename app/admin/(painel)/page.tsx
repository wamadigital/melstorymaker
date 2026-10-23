import { STATUS, type Status } from "@/lib/form/types";
import { FiltrosLeads } from "@/components/admin/FiltrosLeads";
import { QuadroLeads } from "@/components/admin/QuadroLeads";
import { esfriarParados } from "@/lib/supabase/esfriar";
import { encerrarEventosPassados } from "@/lib/supabase/encerrar-eventos";
import { lerColunaKanban } from "@/lib/supabase/coluna-kanban";
import { TAMANHO_LOTE_KANBAN, type ColunaKanbanDados } from "@/lib/admin/paginacao-kanban";
import { FRASE_PERIODO } from "@/lib/admin/periodo";
import { normalizarFiltrosNavegacao, type BuscaNavegacao } from "@/lib/admin/navegacao";

export default async function PaginaLeads({ searchParams }: { searchParams: Promise<BuscaNavegacao> }) {
  const filtros = normalizarFiltrosNavegacao(await searchParams);
  const { q: termo, categoria, periodo } = filtros;
  // Sem `periodo` na URL (ou com lixo nela) e todo o periodo: o padrao nao
  // ocupa a URL, como a categoria "Todas".

  // Um relogio so: o mesmo "agora" esfria os parados e desce para os cartoes.
  const agoraMs = Date.now();

  // Antes de ler as colunas: quem ficou uma semana parado depois do prazo da
  // cobranca sai de "Enviado" e vai para "Esfriou" (lib/admin/esfriar.ts). Nunca
  // lanca -- se falhar, o quadro abre do mesmo jeito e o cron diario tenta de novo.
  const encerramento = await encerrarEventosPassados();
  await esfriarParados(agoraMs);

  // O primeiro lote de cada coluna usa a mesma leitura das próximas cargas.
  // Os totais continuam sendo contagens reais; os 50 são só o prefixo visível.
  const respostas = await Promise.all(
    STATUS.map((status) => lerColunaKanban({ status, filtros, quantidade: TAMANHO_LOTE_KANBAN, agoraMs })),
  );
  const colunas = Object.fromEntries(STATUS.map((status, i) => [status, respostas[i]])) as Record<Status, ColunaKanbanDados>;

  const totalGeral = STATUS.reduce((s, status) => s + colunas[status].total, 0);
  const filtrando = !!termo || !!categoria || periodo !== "todo";

  return (
    <div className="space-y-5">
      {encerramento.erro && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Não consegui atualizar os eventos encerrados. Atualize a página para tentar novamente.
        </p>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Leads</h1>
        {filtrando && (
          <p className="text-sm text-muted-foreground">
            {totalGeral} {totalGeral === 1 ? "lead" : "leads"}
            {termo && <> com “{termo}”</>}
            {periodo !== "todo" && <> {FRASE_PERIODO[periodo]}</>}
          </p>
        )}
      </div>

      <FiltrosLeads
        categoriaAtual={categoria ?? "todas"}
        termoAtual={termo}
        periodoAtual={periodo}
      />

      {/* `Date.now()` do SERVIDOR, descido como prop: a contagem de cobranca
          precisa dar o mesmo numero no HTML e na hidratacao, senao o cartao
          pisca de cor na fronteira do 7o dia. */}
      <QuadroLeads colunas={colunas} termo={termo} periodo={periodo} agoraMs={agoraMs} filtros={filtros} />
    </div>
  );
}
