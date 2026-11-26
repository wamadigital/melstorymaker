import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, LockKeyhole, Users } from "lucide-react";
import { LogoMel } from "@/components/marca/LogoMel";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";
import { STATUS } from "@/lib/form/types";
import { lerRelatorioComercial } from "./dados";

export const metadata: Metadata = {
  title: "Relatório comercial de 2026 | Mel Storymaker",
  description: "Apresentação privada de desempenho comercial da Mel Storymaker.",
};

const tituloSecao = "text-[1.35rem] font-bold leading-tight tracking-tight";
const painel = "rounded-[1.25rem] border border-[#e8ddd3] bg-[#fffcf8] p-5 sm:p-7";
const origem = "text-xs font-bold tracking-wide";

const meses = [
  ["Jan", "Janeiro"], ["Fev", "Fevereiro"], ["Mar", "Março"],
  ["Abr", "Abril"], ["Mai", "Maio"], ["Jun", "Junho"],
  ["Jul", "Julho"], ["Ago", "Agosto"], ["Set", "Setembro"],
  ["Out", "Outubro"], ["Nov", "Novembro"], ["Dez", "Dezembro"],
];

const historicoSimulado = [
  { leads: 5, propostas: 3 },
  { leads: 10, propostas: 6 },
  { leads: 12, propostas: 7 },
  { leads: 10, propostas: 6 },
  { leads: 12, propostas: 7 },
  { leads: 15, propostas: 9 },
  { leads: 10, propostas: 6 },
  { leads: 5, propostas: 3 },
  { leads: 22, propostas: 13 },
];

const formatarTaxa = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const formatarVariacao = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const celulaRotulo = "sticky left-0 bg-[#fffcf8] px-3 py-2.5 text-left font-bold whitespace-nowrap";

export default async function RelatoriosPage() {
  if (!(await getSessaoAdmin())) redirect("/admin/login?proximo=%2Fadmin%2Frelatorios");

  const { outubro, meses: apurados } = lerRelatorioComercial();
  const desempenho = meses.map(([, nome], indice) => {
    const dados = historicoSimulado[indice] ?? apurados[indice];
    return {
      nome,
      dados,
      taxa: dados?.leads ? dados.propostas / dados.leads : null,
    };
  });
  const { leads: totalEntradas, propostas: propostasOutubro } = apurados[9];
  const linhas = [
    { rotulo: "Leads", valores: desempenho.map(({ dados }) => dados?.leads ?? "—") },
    { rotulo: "Propostas enviadas", valores: desempenho.map(({ dados }) => dados?.propostas ?? "—") },
    { rotulo: "Taxa de envio", valores: desempenho.map(({ taxa }) => taxa === null ? "—" : formatarTaxa.format(taxa)) },
  ];

  return (
    <div className="min-h-dvh bg-[#f8f3ed] text-[#20130a]">
      <header className="border-b border-[#e8ddd3] bg-[#fffcf8]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <LogoMel className="h-5 w-auto max-w-[48%] sm:h-7" />
          <span className="flex items-center gap-1.5 text-xs font-bold text-[#654e41]">
            <LockKeyhole aria-hidden="true" size={14} />
            Apresentação privada
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pt-7 pb-8 sm:px-8 sm:pt-9">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Relatório comercial</h1>
          <p className="flex items-center gap-2 rounded-full border border-[#e8ddd3] bg-[#fffcf8] px-3.5 py-2 text-sm font-bold text-[#654e41]">
            <CalendarDays aria-hidden="true" size={16} />
            Janeiro a novembro de 2026
          </p>
        </div>

        <section aria-labelledby="volume-propostas">
          <div className="mb-3">
            <h2 id="volume-propostas" className={tituloSecao}>Propostas enviadas</h2>
            <p className="mt-1 text-sm text-[#654e41]">Propostas enviadas a leads que entraram no mesmo mês</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {desempenho.slice(5, 11).map(({ nome, dados }, indice) => {
              const propostasAnteriores = desempenho[indice + 4].dados.propostas;
              const variacao = propostasAnteriores ? (dados.propostas - propostasAnteriores) / propostasAnteriores : null;
              const mesAtual = nome === "Novembro";
              return (
                <article
                  key={nome}
                  className={`rounded-[1.25rem] border border-[#e8ddd3] p-4 ${mesAtual ? "bg-[#efe5db]" : "bg-[#fffcf8]"}`}
                >
                  <h3 className="text-sm font-bold text-[#654e41]">{nome}</h3>
                  <p className="mt-2 leading-none font-bold">
                    <span className="text-2xl tracking-tight tabular-nums">{dados.propostas}</span>
                    <span className="ml-1 text-xs">propostas</span>
                  </p>
                  <p className="mt-2 text-xs text-[#654e41]">{dados.leads} leads</p>
                  {variacao === null ? (
                    <p className="mt-3 text-xs text-[#654e41]">Sem base de comparação</p>
                  ) : (
                    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#654e41]">
                      <span className={`rounded-full px-2 py-0.5 font-bold tabular-nums ${variacao > 0 ? "bg-[#deefdf] text-[#21552e]" : "bg-[#e9ded4] text-[#553f32]"}`}>
                        {formatarVariacao.format(variacao)}
                      </span>
                      <span>vs. mês anterior</span>
                    </p>
                  )}
                  {mesAtual && <p className="mt-2 text-xs text-[#654e41]">Até 26/11</p>}
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="outubro" className="mt-7">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 id="outubro" className={tituloSecao}>Movimentação de outubro</h2>
            <span className={origem + " rounded-full bg-[#eae0d5] px-2.5 py-1 text-[#654e41]"}>Dados do Kanban</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-[2.25fr_1fr]">
            <section aria-labelledby="entradas" className={painel}>
              <div className="flex flex-wrap items-start gap-x-8 gap-y-4 border-b border-[#e8ddd3] pb-4 sm:gap-x-12">
                <div>
                  <p className="text-3xl leading-none font-bold tabular-nums">{totalEntradas}</p>
                  <h3 id="entradas" className="mt-1 text-sm font-bold text-[#654e41]">
                    <Users aria-hidden="true" size={15} className="mr-1 inline-block align-[-2px]" />
                    Leads que entraram
                  </h3>
                </div>
                <div>
                  <p className="text-3xl leading-none font-bold tabular-nums">{propostasOutubro}</p>
                  <p className="mt-1 text-sm font-bold text-[#654e41]">Propostas enviadas a esses leads</p>
                </div>
              </div>
              <figure className="mt-4">
                <figcaption className="text-sm font-bold">Entradas por faixa de dias</figcaption>
                <ol className="mt-3 grid grid-cols-5 gap-2 sm:gap-5">
                  {outubro.entradas.map(({ dias, total }) => (
                    <li key={dias} className="text-center">
                      <div className="flex h-27 flex-col justify-end">
                        <span className="mb-1 text-sm font-bold tabular-nums">{total}</span>
                        <div
                          aria-hidden="true"
                          className="mx-auto w-full max-w-24 rounded-t-md bg-[#a05035]"
                          style={{ height: total * 2 }}
                        />
                      </div>
                      <span className="mt-1.5 block text-xs font-bold whitespace-nowrap text-[#654e41]">{dias}</span>
                    </li>
                  ))}
                </ol>
              </figure>
            </section>

            <section aria-labelledby="eventos" className={painel}>
              <h3 id="eventos" className="text-lg font-bold tracking-tight">Leads por tipo de evento</h3>
              <dl className="mt-2 divide-y divide-[#e8ddd3]">
                {outubro.tiposDeEvento.map(({ nome, total }) => (
                  <div key={nome} className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-sm text-[#654e41]">{nome}</dt>
                    <dd className="font-bold tabular-nums">{total}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </section>
        <section aria-labelledby="status-kanban" className={painel + " mt-4"}>
          <h2 id="status-kanban" className={tituloSecao}>Desempenho mensal e status do Kanban</h2>
          <p id="status-periodo" className="mt-1 text-sm text-[#654e41]">
            Leads, propostas e taxas de janeiro a setembro são simulados. Os status são do Kanban em 26/11, agrupados pelo mês de entrada do lead.
          </p>
          <div
            role="region"
            aria-labelledby="status-kanban"
            tabIndex={0}
            className="relative mt-4 overflow-x-auto rounded-lg border border-[#e8ddd3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#823b25]"
          >
            <table aria-describedby="status-periodo" className="w-full min-w-[50rem] text-sm tabular-nums">
              <thead className="bg-[#efe5db] text-[#654e41]">
                <tr>
                  <th scope="col" className="sticky left-0 bg-[#efe5db] px-3 py-3 text-left">Indicador</th>
                  {meses.map(([abreviado, nome]) => (
                    <th key={nome} scope="col" className="px-2 py-3 text-center">
                      <span aria-hidden="true">{abreviado}</span>
                      <span className="sr-only">{nome}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8ddd3]">
                {linhas.map(({ rotulo, valores }) => (
                  <tr key={rotulo}>
                    <th scope="row" className={celulaRotulo}>{rotulo}</th>
                    {valores.map((valor, indice) => (
                      <td key={meses[indice][0]} className="px-2 py-2.5 text-center">{valor}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tbody className="divide-y divide-[#e8ddd3] border-t-2 border-[#e8ddd3]">
                {STATUS.map((status) => (
                  <tr key={status}>
                    <th scope="row" className={celulaRotulo}>{ROTULO_STATUS[status]}</th>
                    {desempenho.map(({ nome }, indice) => (
                      <td key={nome} className="px-2 py-2.5 text-center">{apurados[indice]?.status[status] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
