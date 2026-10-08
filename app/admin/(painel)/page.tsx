import { supabaseAdmin } from "@/lib/supabase/admin";
import { CATEGORIAS, STATUS, type Categoria, type Status } from "@/lib/form/types";
import { COLUNAS_CARTAO, type LeadCartao } from "@/lib/admin/tipos";
import { FiltrosLeads } from "@/components/admin/FiltrosLeads";
import { QuadroLeads, type Coluna } from "@/components/admin/QuadroLeads";
import { lerComRetentativa } from "@/lib/supabase/consulta";
import { esfriarParados } from "@/lib/supabase/esfriar";
import { FRASE_PERIODO, ehPeriodo, inicioDoPeriodo } from "@/lib/admin/periodo";

type Busca = { q?: string; categoria?: string; periodo?: string };

/** Teto por coluna. "Novo" e a raia gorda (formularios abandonados). */
const LIMITE_COLUNA = 50;

function ehCategoria(v: string | undefined): v is Categoria {
  return !!v && (CATEGORIAS as readonly string[]).includes(v);
}

export default async function PaginaLeads({ searchParams }: { searchParams: Promise<Busca> }) {
  const { q, categoria, periodo: periodoUrl } = await searchParams;
  const termo = (q ?? "").trim();
  // Sem `periodo` na URL (ou com lixo nela) e todo o periodo: o padrao nao
  // ocupa a URL, como a categoria "Todas".
  const periodo = ehPeriodo(periodoUrl) ? periodoUrl : "todo";

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

    // Toda raia na mesma ordem: pela CHEGADA do lead, a data que o cartao
    // mostra, do mais novo (em cima) para o mais antigo (embaixo). Pedido do
    // owner em 07/10/2026 -- antes "Enviado" e "Esfriou" vinham do mais antigo
    // para o mais novo, com a cobranca vencida no topo.
    //
    // O preco: passando de LIMITE_COLUNA, o corte cai nos mais ANTIGOS. Em
    // "Esfriou" sao eles que tem a "Ultima tentativa" (vermelha); a coluna avisa
    // "Mostrando 50 de N", e o caminho e a Mel dar os antigos por perdidos.
    c = c.order("created_at", { ascending: false });

    if (termo) c = c.ilike("nome_display", `%${termo}%`);
    if (ehCategoria(categoria)) c = c.eq("categoria", categoria);
    if (desde) c = c.gte("created_at", desde);
    return c;
  };

  // Uma por status, em paralelo: custam a latencia de 1 e todas caem no
  // leads_status_idx.
  // Com retentativa porque uma falha transitoria do Supabase em UMA consulta
  // apagava a coluna inteira, enquanto as outras carregavam normalmente.
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
          // pode derrubar as outras. A mensagem tecnica fica no log do
          // servidor -- "JWT issued at future" nao diz nada para a Mel, e ela
          // nao tem o que fazer com isso alem de tentar de novo.
          erro: error ? "Não consegui carregar esta coluna." : null,
        } satisfies Coluna,
      ];
    }),
  ) as Record<Status, Coluna>;

  const totalGeral = STATUS.reduce((s, status) => s + colunas[status].total, 0);
  const filtrando = !!termo || ehCategoria(categoria) || periodo !== "todo";

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
        categoriaAtual={ehCategoria(categoria) ? categoria : "todas"}
        termoAtual={termo}
        periodoAtual={periodo}
      />

      {/* `Date.now()` do SERVIDOR, descido como prop: a contagem de cobranca
          precisa dar o mesmo numero no HTML e na hidratacao, senao o cartao
          pisca de cor na fronteira do 7o dia. */}
      <QuadroLeads colunas={colunas} termo={termo} periodo={periodo} agoraMs={agoraMs} />
    </div>
  );
}
