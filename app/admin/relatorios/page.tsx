import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, FileCheck, LockKeyhole, MessageCircle, Users } from "lucide-react";
import { LogoMel } from "@/components/marca/LogoMel";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { lerRelatorioComercial } from "./dados";

export const metadata: Metadata = {
  title: "Relatório comercial de outubro | Mel Storymaker",
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

const atendimentosPorCliente = [
  { cliente: "Helena Duarte", atendimentos: [1, 2, 1, 0, 1, 2, 1, 1, 2, 4, 2, 1] },
  { cliente: "Marina Azevedo", atendimentos: [0, 1, 2, 1, 0, 1, 2, 1, 3, 5, 2, 1] },
  { cliente: "Isabela Nogueira", atendimentos: [2, 1, 0, 2, 1, 0, 1, 2, 1, 4, 3, 2] },
  { cliente: "Beatriz Monteiro", atendimentos: [1, 0, 1, 1, 2, 1, 0, 2, 2, 3, 2, 1] },
  { cliente: "Camila Mendonça", atendimentos: [0, 1, 1, 0, 1, 2, 2, 1, 2, 4, 2, 2] },
  { cliente: "Laura Campos", atendimentos: [1, 0, 2, 1, 1, 0, 1, 2, 1, 3, 2, 1] },
];

export default async function RelatoriosPage() {
  if (!(await getSessaoAdmin())) redirect("/admin/login?proximo=%2Fadmin%2Frelatorios");

  const { demonstracao, outubro } = lerRelatorioComercial();
  const totalEntradas = outubro.entradas.reduce((total, faixa) => total + faixa.total, 0);

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
            Outubro de 2026
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[2.25fr_1fr]">
          <section aria-labelledby="whatsapp" className="rounded-[1.25rem] bg-[#261810] p-5 text-[#fff9f2] sm:p-7">
            <h2 id="whatsapp" className={tituloSecao}>
              <MessageCircle aria-hidden="true" className="mr-2 inline-block align-[-3px] text-[#f6bd9e]" size={19} />
              Taxa de resposta no WhatsApp
            </h2>
            <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-5">
              <div>
                <p className="text-xs font-bold text-[#f2d6c3] sm:text-sm">Antes · atendimento manual</p>
                <p className="mt-1 text-[clamp(1.8rem,5.7vw,4.6rem)] leading-none font-bold tracking-tight tabular-nums">
                  {demonstracao.respostaManual.minima}–{demonstracao.respostaManual.maxima}%
                </p>
              </div>
              <ArrowRight aria-hidden="true" className="h-5 w-5 text-[#f6bd9e] sm:h-8 sm:w-8" />
              <div>
                <p className="text-xs font-bold text-[#f2d6c3] sm:text-sm">Em outubro · com automação</p>
                <p className="mt-1 text-[clamp(2rem,6.2vw,5rem)] leading-none font-bold tracking-tight text-[#ffc5a5] tabular-nums">
                  {demonstracao.respostaComAutomacao}%
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="contratos" className="flex flex-col rounded-[1.25rem] border border-[#ead0bd] bg-[#f4e3d5] p-5 sm:p-7">
            <FileCheck aria-hidden="true" size={23} className="text-[#823b25]" />
            <p className="mt-4 text-6xl leading-none font-bold tracking-tight tabular-nums sm:text-7xl">
              {demonstracao.contratos}
            </p>
            <h2 id="contratos" className={tituloSecao + " mt-1"}>Contratos fechados</h2>
            <p className="mt-2 text-sm text-[#654e41]">No primeiro mês</p>
          </section>
        </div>

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
                  <p className="text-3xl leading-none font-bold tabular-nums">{outubro.propostas}</p>
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
        <section aria-labelledby="atendimentos" className={painel + " mt-4"}>
          <h2 id="atendimentos" className={tituloSecao}>Atendimentos por cliente</h2>
          <p id="atendimentos-periodo" className="mt-1 text-sm text-[#654e41]">
            Janeiro a dezembro de 2026 · Nomes e contagens fictícios
          </p>
          <div
            role="region"
            aria-labelledby="atendimentos"
            tabIndex={0}
            className="relative mt-4 overflow-x-auto rounded-lg border border-[#e8ddd3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#823b25]"
          >
            <table aria-describedby="atendimentos-periodo" className="w-full min-w-[50rem] text-sm tabular-nums">
              <thead className="bg-[#efe5db] text-[#654e41]">
                <tr>
                  <th scope="col" className="sticky left-0 bg-[#efe5db] px-3 py-3 text-left">Cliente</th>
                  {meses.map(([abreviado, nome]) => (
                    <th key={nome} scope="col" className="px-2 py-3 text-center">
                      <span aria-hidden="true">{abreviado}</span>
                      <span className="sr-only">{nome}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-3 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8ddd3]">
                {atendimentosPorCliente.map(({ cliente, atendimentos }) => (
                  <tr key={cliente}>
                    <th scope="row" className="sticky left-0 bg-[#fffcf8] px-3 py-2.5 text-left font-bold whitespace-nowrap">
                      {cliente}
                    </th>
                    {meses.map(([, nome], indice) => (
                      <td key={nome} className="px-2 py-2.5 text-center">{atendimentos[indice]}</td>
                    ))}
                    <td className="bg-[#f8f3ed] px-3 py-2.5 text-center font-bold">
                      {atendimentos.reduce((soma, quantidade) => soma + quantidade, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="mt-4 text-xs leading-relaxed text-[#654e41]">
          Os dados do Kanban cobrem as entradas de 1 a 31 de outubro e as propostas enviadas a esses leads no mesmo período. As taxas de resposta e os contratos são ilustrativos.
        </p>
      </main>
    </div>
  );
}
