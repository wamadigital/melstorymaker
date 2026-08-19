import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STATUS, type Lead, type Status } from "@/lib/form/types";
import { CLASSE_STATUS, ROTULO_STATUS, rotuloCategoria, rotuloPasso } from "@/lib/admin/rotulos";
import { dataCurta, dataHoraLocal } from "@/lib/pdf/formatadores";
import { FiltrosLeads } from "@/components/admin/FiltrosLeads";
import { AcoesLead } from "@/components/admin/AcoesLead";
import { cn } from "@/lib/utils";

type Busca = { status?: string; q?: string };

function ehStatus(v: string | undefined): v is Status {
  return !!v && (STATUS as readonly string[]).includes(v);
}

export default async function PaginaLeads({
  searchParams,
}: {
  searchParams: Promise<Busca>;
}) {
  const { status, q } = await searchParams;
  const termo = (q ?? "").trim();

  // Leitura pela service role: a tabela tem RLS sem policies, entao este e o
  // unico caminho possivel -- e ele so roda depois do middleware validar a sessao.
  let consulta = supabaseAdmin()
    .from("leads")
    .select(
      "id, created_at, categoria, status, nome_display, data_evento, passo_atual, enviado_em, pdf_url, whatsapp, email",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (ehStatus(status)) consulta = consulta.eq("status", status);
  if (termo) consulta = consulta.ilike("nome_display", `%${termo}%`);

  const { data, error } = await consulta;

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Não consegui carregar os leads: {error.message}
      </p>
    );
  }

  const leads = (data ?? []) as Pick<
    Lead,
    | "id"
    | "created_at"
    | "categoria"
    | "status"
    | "nome_display"
    | "data_evento"
    | "passo_atual"
    | "enviado_em"
    | "pdf_url"
    | "whatsapp"
    | "email"
  >[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">
          {leads.length} {leads.length === 1 ? "resultado" : "resultados"}
        </p>
      </div>

      <FiltrosLeads statusAtual={ehStatus(status) ? status : "todos"} termoAtual={termo} />

      {leads.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum lead por aqui ainda.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {leads.map((lead) => {
            const parouEm =
              lead.status === "incompleto" ? rotuloPasso(lead.categoria, lead.passo_atual) : null;

            return (
              // O menu fica FORA do <Link>: botao dentro de link e HTML
              // invalido, e o clique no menu navegaria para o detalhe.
              <li key={lead.id} className="flex items-center gap-1 pr-2 transition-colors hover:bg-accent">
                <Link
                  href={`/admin/leads/${lead.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">
                      {lead.nome_display || <span className="text-muted-foreground">Sem nome</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {rotuloCategoria(lead.categoria)}
                      {lead.data_evento && <> · {dataCurta(lead.data_evento)}</>}
                    </p>
                    {parouEm && (
                      <p className="text-xs text-muted-foreground">Parou em: {parouEm}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                    <span
                      className={cn(
                        "rounded-md border px-2.5 py-0.5 text-xs font-medium",
                        CLASSE_STATUS[lead.status],
                      )}
                    >
                      {ROTULO_STATUS[lead.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dataHoraLocal(lead.created_at)}
                    </span>
                  </div>
                </Link>

                <AcoesLead
                  id={lead.id}
                  nome={lead.nome_display ?? ""}
                  pdfUrl={lead.pdf_url}
                  whatsapp={lead.whatsapp}
                  temEmail={!!lead.email}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
