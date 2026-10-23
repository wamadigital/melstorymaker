import { supabaseAdmin } from "@/lib/supabase/admin";
import { STATUS, type Status } from "@/lib/form/types";
import { COLUNAS_CARTAO, type LeadCartao } from "@/lib/admin/tipos";
import { FiltrosLeads } from "@/components/admin/FiltrosLeads";
import { QuadroLeads, type Coluna } from "@/components/admin/QuadroLeads";
import { lerComRetentativa } from "@/lib/supabase/consulta";
import { esfriarParados } from "@/lib/supabase/esfriar";
import { lerDisparosWhatsApp } from "@/lib/supabase/disparos-whatsapp";
import { lerTestesWhatsApp } from "@/lib/supabase/testes-whatsapp";
import { lerEsfriouPrioritario } from "@/lib/supabase/esfriou-prioritario";
import { FRASE_PERIODO, inicioDoPeriodo } from "@/lib/admin/periodo";
import { normalizarFiltrosNavegacao, type BuscaNavegacao } from "@/lib/admin/navegacao";

/** Teto por coluna. "Novo" e a raia gorda (formularios abandonados). */
const LIMITE_COLUNA = 50;

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
  await esfriarParados(agoraMs);

  const desde = inicioDoPeriodo(periodo, agoraMs);

  // Uma consulta por coluna, com count exato: alem dos cartoes, traz o TOTAL
  // real da raia. E o que substitui o "N resultados" antigo, que era o length de
  // um .limit(200) sem paginacao -- ou seja, mentia a partir de 200.
  //
  // Leitura pela service role: a tabela tem RLS sem policies, entao este e o
  // unico caminho possivel -- e so roda depois do middleware validar a sessao.
  const consultar = (status: Status) => {
    let c = supabaseAdmin()
      .from("leads")
      .select(COLUNAS_CARTAO, { count: "exact" })
      .eq("status", status)
      .limit(LIMITE_COLUNA);

    // As demais raias mantêm a chegada. Esfriou é consultada separadamente:
    // primeiro escolhe pendências por prioridade, depois aplica o teto visual.
    c = c.order("created_at", { ascending: false }).order("id", { ascending: true });

    if (termo) c = c.ilike("nome_display", `%${termo}%`);
    if (categoria) c = c.eq("categoria", categoria);
    if (desde) c = c.gte("created_at", desde);
    return c;
  };

  // Uma por status, em paralelo: custam a latencia de 1 e todas caem no
  // leads_status_idx.
  // Com retentativa porque uma falha transitoria do Supabase em UMA consulta
  // apagava a coluna inteira, enquanto as outras carregavam normalmente.
  const respostas = await Promise.all(
    STATUS.map((status) => status === "esfriou"
      ? lerEsfriouPrioritario({ termo, categoria,
        desde, agoraMs, limite: LIMITE_COLUNA })
      : lerComRetentativa(`coluna ${status}`, () => consultar(status))),
  );

  const demaisCartoes = respostas.flatMap(({ data }, i) => STATUS[i] === "esfriou"
    ? [] : (data ?? []) as unknown as LeadCartao[]);
  const idsVisiveis = demaisCartoes.map(({ id }) => id);
  const [disparos, testes] = await Promise.all([
    lerDisparosWhatsApp(idsVisiveis),
    lerTestesWhatsApp(demaisCartoes, agoraMs),
  ]);

  const colunas = Object.fromEntries(
    STATUS.map((status, i) => {
      const { data, count, error } = respostas[i];
      return [
        status,
        {
          cartoes: ((data ?? []) as unknown as LeadCartao[]).map((lead) => status === "esfriou" ? lead : ({
            ...lead, disparos_whatsapp: disparos.porLead.get(lead.id) ?? [],
            solicitacoes_whatsapp: disparos.solicitacoesPorLead.get(lead.id) ?? [],
            teste_whatsapp: testes.get(lead.id),
          })),
          total: count ?? 0,
          // Erro por coluna, e nao da pagina inteira: uma raia que falhou nao
          // pode derrubar as outras. A mensagem tecnica fica no log do
          // servidor -- "JWT issued at future" nao diz nada para a Mel, e ela
          // nao tem o que fazer com isso alem de tentar de novo.
          erro: error ? "Não consegui carregar esta coluna." : null,
        } satisfies Coluna,
      ];
    }),
  ) as Record<Status, Coluna>;

  const totalGeral = STATUS.reduce((s, status) => s + colunas[status].total, 0);
  const filtrando = !!termo || !!categoria || periodo !== "todo";

  return (
    <div className="space-y-5">
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

      {(disparos.erro || respostas.some(r => "erroDisparos" in r && r.erroDisparos)) && (
        <p role="status" className="text-xs text-muted-foreground">
          Não consegui carregar os envios automáticos do WhatsApp. Atualize a página para conferir o histórico.
        </p>
      )}

      {/* `Date.now()` do SERVIDOR, descido como prop: a contagem de cobranca
          precisa dar o mesmo numero no HTML e na hidratacao, senao o cartao
          pisca de cor na fronteira do 7o dia. */}
      <QuadroLeads colunas={colunas} termo={termo} periodo={periodo} agoraMs={agoraMs} filtros={filtros} />
    </div>
  );
}
