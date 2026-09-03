import { supabaseAdmin } from "@/lib/supabase/admin";
import { CATEGORIAS, STATUS, type Categoria, type Status } from "@/lib/form/types";
import { COLUNAS_CARTAO, type LeadCartao } from "@/lib/admin/tipos";
import { FiltrosLeads } from "@/components/admin/FiltrosLeads";
import { QuadroLeads, type Coluna } from "@/components/admin/QuadroLeads";
import { lerComRetentativa } from "@/lib/supabase/consulta";

type Busca = { q?: string; categoria?: string };

/** Teto por coluna. "Novo" e a raia gorda (formularios abandonados). */
const LIMITE_COLUNA = 50;

function ehCategoria(v: string | undefined): v is Categoria {
  return !!v && (CATEGORIAS as readonly string[]).includes(v);
}

export default async function PaginaLeads({ searchParams }: { searchParams: Promise<Busca> }) {
  const { q, categoria } = await searchParams;
  const termo = (q ?? "").trim();

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

    // "Enviado" ordena pelo ENVIO, do mais antigo para o mais novo. As outras
    // raias seguem por criacao, do mais novo para o mais velho.
    //
    // A razao e o teto de LIMITE_COLUNA: "Enviado" e a raia que acumula (todo
    // lead fica ali ate virar cliente ou perdido), e cobranca vencida so existe
    // em quem foi enviado ha MAIS tempo. Ordenando por criacao, o dia em que a
    // coluna passasse do teto seria o dia em que os vencidos parariam de ser
    // buscados -- e o quadro deixaria de mostrar exatamente os cartoes que
    // pedem acao, em silencio. Assim o corte cai sobre os envios recentes, que
    // sao justamente os que nao precisam de nada.
    c =
      status === "enviado"
        ? c.order("enviado_em", { ascending: true, nullsFirst: false })
        : c.order("created_at", { ascending: false });

    if (termo) c = c.ilike("nome_display", `%${termo}%`);
    if (ehCategoria(categoria)) c = c.eq("categoria", categoria);
    return c;
  };

  // Uma por status, em paralelo: custam a latencia de 1 e todas caem no
  // leads_status_idx.
  // Com retentativa porque uma falha transitoria do Supabase em UMA consulta
  // apagava a coluna inteira, enquanto as outras tres carregavam normalmente.
  const respostas = await Promise.all(
    STATUS.map((status) => lerComRetentativa(`coluna ${status}`, () => consultar(status))),
  );

  const colunas = Object.fromEntries(
    STATUS.map((status, i) => {
      const { data, count, error } = respostas[i];
      return [
        status,
        {
          cartoes: (data ?? []) as unknown as LeadCartao[],
          total: count ?? 0,
          // Erro por coluna, e nao da pagina inteira: uma raia que falhou nao
          // pode derrubar as outras tres. A mensagem tecnica fica no log do
          // servidor -- "JWT issued at future" nao diz nada para a Mel, e ela
          // nao tem o que fazer com isso alem de tentar de novo.
          erro: error ? "Não consegui carregar esta coluna." : null,
        } satisfies Coluna,
      ];
    }),
  ) as Record<Status, Coluna>;

  const totalGeral = STATUS.reduce((s, status) => s + colunas[status].total, 0);
  const filtrando = !!termo || ehCategoria(categoria);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Leads</h1>
        {filtrando && (
          <p className="text-sm text-muted-foreground">
            {totalGeral} {totalGeral === 1 ? "lead" : "leads"}
            {termo && <> com “{termo}”</>}
          </p>
        )}
      </div>

      <FiltrosLeads categoriaAtual={ehCategoria(categoria) ? categoria : "todas"} termoAtual={termo} />

      {/* `Date.now()` do SERVIDOR, descido como prop: a contagem de cobranca
          precisa dar o mesmo numero no HTML e na hidratacao, senao o cartao
          pisca de cor na fronteira do 7o dia. */}
      <QuadroLeads colunas={colunas} termo={termo} agoraMs={Date.now()} />
    </div>
  );
}
