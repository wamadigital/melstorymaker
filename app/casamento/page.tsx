import { CalendarCheck, Camera, Check, Clapperboard, EyeOff, Heart, MessageCircle, Mail, Palette, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { BarraCtaFixa } from "@/components/lp/BarraCtaFixa";
import { CtaFormulario } from "@/components/lp/CtaFormulario";
import { GaleriaReels, type ReelLp } from "@/components/lp/GaleriaReels";
import { HeroVideo } from "@/components/lp/HeroVideo";
import { LinkWhatsApp } from "@/components/lp/LinkWhatsApp";
import { LogoMel } from "@/components/marca/LogoMel";
import { MonogramaMel } from "@/components/marca/MonogramaMel";
import { PixelMeta } from "@/components/meta/PixelMeta";
import { CONTRATADA } from "@/lib/contrato/contratada";
import { EVENTO } from "@/lib/meta/eventos";
import { cn } from "@/lib/utils";
import { adicionaisDaLp, condicoesDaLp, maisDe, pacotesDaLp, prazosDoFaq, telefoneLegivel } from "./conteudo";
import { MIDIA } from "./midia.gerado";
import { CASAMENTOS_PUBLICADOS, REELS } from "./reels";

/*
 * LP de venda de casamento: destino dos anúncios do Instagram.
 *
 * Decisões do owner (01/10/2026), registradas no CLAUDE.md:
 * - identidade COMPLETA da marca só aqui (tokens em `.lp-casamento`);
 * - os Reels são a prova: sem nome de casal, sem depoimento, sem preço;
 * - todo CTA vai ao formulário de sempre, em modo casamento.
 *
 * Página ESTÁTICA (HTML no CDN): o TTFB conta no 4G do navegador do
 * Instagram. Por isso nada aqui lê a URL no servidor -- a query do anúncio
 * entra nos CTAs pelo navegador (`CtaFormulario`).
 *
 * Toda frase tem lastro: pacotes e prazos vêm do catálogo e do escopo do
 * contrato (`conteudo.ts`), as garantias das cláusulas, os espaços das
 * legendas dos Reels.
 */

const URL_SITE = process.env.APP_URL ?? "https://melstorymaker.com.br";

export const metadata: Metadata = {
  metadataBase: new URL(URL_SITE),
  title: "Storymaker de casamento em Campinas | Mel Simão Storymaker",
  description:
    "Vocês vivem o casamento e eu conto tudo nos stories: gravo, edito com trilha e legenda e publico no Instagram de vocês. Campinas e região.",
  alternates: { canonical: "/casamento" },
  openGraph: {
    title: "Vocês vivem o casamento. Eu conto tudo nos stories.",
    description: "Stories e Reels do casamento de vocês, gravados, editados e publicados pela Mel. Campinas e região.",
    url: "/casamento",
    siteName: "Mel Simão | Storymaker",
    locale: "pt_BR",
    type: "website",
  },
};

const SCRIPT_QUERY_NOS_CTAS = `addEventListener("load",function(){document.documentElement.classList.add("lp-carregado")});(function(){try{if(!location.search)return;document.querySelectorAll("a[data-cta]").forEach(function(a){var u=new URL(a.getAttribute("href"),location.origin);var p=new URLSearchParams(location.search);u.searchParams.forEach(function(v,k){p.set(k,v)});a.setAttribute("href",u.pathname+"?"+p.toString())})}catch(e){}})();`;

const ID_CTA_HERO = "cta-hero";
const ID_CTA_FINAL = "cta-final";

const ESPACOS_EM_DESTAQUE = ["Espaço Pieri", "Casa Venamore", "Corsage", "Portal Paraíso", "Rancho Verde", "Spazzio Felicità"];

export default function Page() {
  const reels: ReelLp[] = REELS.map((r) => ({
    id: r.id,
    espaco: r.espaco,
    quando: r.quando,
    ...pick(MIDIA.reels[r.id as keyof typeof MIDIA.reels]),
  }));
  const pacotes = pacotesDaLp();
  const adicionais = adicionaisDaLp();
  const prazos = prazosDoFaq();
  const c = condicoesDaLp();
  const whatsapp = process.env.MEL_WHATSAPP ?? "";
  const estiloOnda = { "--lp-onda": `url(${MIDIA.marca.onda})` } as CSSProperties;

  return (
    <main className="lp-casamento min-h-dvh bg-marca-escuro font-light text-marca-creme" style={estiloOnda}>
      {/* O fundo do documento acompanha a página: no "puxar" do iOS aparecia o
          #F1F1F1 do body por trás. Vale só enquanto a LP está aberta -- daqui
          para o formulário a navegação é de página inteira. */}
      <style>{"html,body{background-color:#20130a}"}</style>
      <PixelMeta
        pixelId={process.env.META_PIXEL_ID}
        eventosIniciais={[
          { tipo: "track", nome: EVENTO.conteudo, dados: { content_category: "casamento", content_name: "lp_casamento" } },
        ]}
      />

      {/* 1. Hero */}
      <section className="lp-escuro relative flex min-h-[100svh] flex-col justify-end overflow-hidden">
        <HeroVideo
          teaser={MIDIA.hero.teaser}
          poster={MIDIA.hero.poster}
          alt="Noivos saindo da cerimônia sob uma chuva de pétalas, ao entardecer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-marca-escuro via-marca-escuro/55 to-marca-escuro/10" />
        <header className="absolute inset-x-0 top-0 flex items-center gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <MonogramaMel className="h-8 w-auto text-marca-creme" />
          <LogoMel className="h-4 w-auto text-marca-creme" />
        </header>

        <div className="relative mx-auto flex w-full max-w-xl flex-col gap-4 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-marca-areia">Storymaker de casamentos · Campinas e região</p>
          <h1 className="text-4xl leading-[1.08] font-bold text-balance text-marca-creme sm:text-5xl">
            Vocês vivem o casamento. Eu conto tudo nos stories.
          </h1>
          <p className="text-lg leading-relaxed text-pretty text-marca-creme/90">
            Gravo, edito com trilha e legenda e publico no Instagram de vocês. Se quiserem, ainda durante a festa.
          </p>
          <div className="flex items-center gap-3">
            <Image
              src={MIDIA.marca.avatar}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="size-12 shrink-0 rounded-md bg-marca-medio object-cover"
            />
            <p className="text-base text-marca-creme">
              Oi, eu sou a Mel <span aria-hidden>✨</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <CtaFormulario id={ID_CTA_HERO} posicao="hero" variante="claro">
              Consultar minha data
            </CtaFormulario>
            <p className="text-sm text-marca-areia">Você escolhe: falar comigo no WhatsApp ou pedir um orçamento.</p>
          </div>
        </div>
      </section>

      {/* Faixa de prova logo abaixo da dobra */}
      <section className="lp-escuro border-y border-marca-creme/10 bg-marca-medio/40 px-5 py-6">
        <p className="mx-auto max-w-xl text-center text-base leading-relaxed text-marca-creme/90">
          <strong className="font-bold text-marca-creme">{maisDe(CASAMENTOS_PUBLICADOS)} casamentos contados desde 2024</strong>, em
          lugares como {lista(ESPACOS_EM_DESTAQUE)}.
        </p>
      </section>

      {/* 2. Galeria de Reels */}
      <section className="lp-escuro py-16" aria-labelledby="titulo-galeria">
        <div className="mx-auto mb-8 flex max-w-xl flex-col gap-3 px-5">
          <Rotulo>Portfólio</Rotulo>
          <h2 id="titulo-galeria" className="text-3xl leading-tight font-bold text-balance text-marca-creme">
            Casamentos que eu contei
          </h2>
          <p className="text-lg leading-relaxed text-pretty text-marca-creme/85">
            Todo casamento ganha um Reels de resumo assim, além dos stories. Toque para assistir com som.
          </p>
        </div>
        <div className="mx-auto max-w-6xl">
          <GaleriaReels reels={reels} />
        </div>
        <p className="mx-auto mt-3 max-w-xl px-5 text-sm text-marca-areia" aria-hidden>
          Deslize para o lado para ver mais →
        </p>
        <div className="mx-auto mt-10 flex max-w-xl justify-center px-5">
          <CtaFormulario posicao="galeria" variante="claro">
            Quero o meu assim
          </CtaFormulario>
        </div>
      </section>

      {/* 3. O que eu faço (problema curto + solução) */}
      <section className="bg-marca-creme px-5 py-16 text-marca-escuro">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <Rotulo claro>O que eu faço no casamento</Rotulo>
          <p className="text-xl leading-snug font-normal text-marca-medio">Passa voando. E as fotos chegam semanas depois.</p>
          <h2 className="text-3xl leading-tight font-bold text-balance">O fotógrafo cuida do álbum. Eu cuido dos stories.</h2>
          <p className="text-lg leading-relaxed text-pretty">
            Enquanto vocês vivem o dia, eu registro os detalhes, a cerimônia, a festa e a reação de quem vocês amam. Edito,
            coloco trilha e legenda e publico no Instagram de vocês, sem ninguém da família precisar largar a pista para gravar.
          </p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            <Pilar icone={<Sparkles />} titulo="Stories ilimitados">
              Tudo o que importa no dia, registrado e publicado sem limite de quantidade.
            </Pilar>
            <Pilar icone={<Clapperboard />} titulo="Editados e espontâneos">
              Alguns ganham montagem. Outros saem do jeito que aconteceram, sem edição.
            </Pilar>
            <Pilar icone={<Palette />} titulo="No estilo de vocês">
              Trilha e legendas escolhidas pensando na personalidade do casal.
            </Pilar>
            <Pilar icone={<EyeOff />} titulo="Discrição">
              Trabalho sem interferir no andamento do casamento, para vocês aproveitarem cada minuto.
            </Pilar>
          </ul>
          <p className="mt-2 rounded-md bg-marca-escuro px-5 py-4 text-lg leading-snug text-marca-creme">
            Quem não pôde ir também quer ver o seu sim. <strong className="font-bold">No Real Time, vê na hora.</strong>
          </p>
        </div>
      </section>

      {/* 4. Pacotes como escolha de tempo */}
      <section className="bg-marca-creme px-5 pb-16 text-marca-escuro" aria-labelledby="titulo-pacotes">
        <div className="mx-auto flex max-w-xl flex-col gap-5 border-t border-marca-escuro/15 pt-16">
          <Rotulo claro>Pacotes</Rotulo>
          <h2 id="titulo-pacotes" className="text-3xl leading-tight font-bold text-balance">
            A diferença é quando vocês querem ver.
          </h2>
          <p className="text-lg leading-relaxed text-pretty">
            Nos dois, a cobertura é de {prazos.horasCobertura} horas, entre cerimônia e recepção. O que muda é a hora em que os
            stories vão para o ar.
          </p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {pacotes.map((p) => (
              <article
                key={p.nome}
                className={cn(
                  "flex flex-col gap-4 rounded-md bg-white p-5 shadow-sm",
                  p.selo ? "border-2 border-marca-terracota" : "border border-marca-escuro/15",
                )}
              >
                {p.selo && (
                  <p className="self-start rounded-md bg-marca-terracota px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-marca-creme">
                    {p.selo}
                  </p>
                )}
                <h3 className="text-2xl font-bold">{p.nome}</h3>
                <p className="text-lg leading-snug font-bold text-marca-terracota">{p.destaque}</p>
                <ul className="flex flex-col gap-2">
                  {p.itens.map((item) => (
                    <li key={item} className="flex gap-2 text-base leading-snug">
                      <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-marca-terracota" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="border-t border-marca-escuro/10 pt-3 text-sm leading-relaxed text-marca-medio">{p.prazo}</p>
              </article>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-base font-bold">Dá para somar:</p>
            <ul className="flex flex-wrap gap-2">
              {adicionais.map((a) => (
                <li key={a} className="rounded-md border border-marca-escuro/20 bg-white px-3 py-1.5 text-sm">
                  {a}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-base leading-relaxed text-marca-medio">
            Locomoção inclusa em Campinas. A data fica reservada com {c.reservaPct}% do valor.
          </p>
          <div className="mt-2 flex flex-col items-center gap-2 text-center">
            <CtaFormulario posicao="pacotes" variante="terracota">
              Quero receber a proposta
            </CtaFormulario>
            <p className="text-sm text-marca-medio">O valor sai na proposta, de acordo com a data e o que vocês escolherem.</p>
          </div>
        </div>
      </section>

      {/* 5. A Mel */}
      <section className="lp-escuro relative overflow-hidden bg-marca-escuro px-5 pt-16">
        <div aria-hidden className="lp-onda pointer-events-none absolute inset-0 bg-marca-areia/15" />
        <div className="relative mx-auto flex max-w-xl flex-col gap-5">
          <Rotulo>Quem vai estar lá</Rotulo>
          <h2 className="text-3xl leading-tight font-bold text-marca-creme">Prazer, eu sou a Mel.</h2>
          <p className="text-lg leading-relaxed text-pretty text-marca-creme/90">
            Trabalho com marketing digital há 7 anos e hoje uso esse olhar para contar casamentos pelo celular. No dia, fico por
            perto sem atrapalhar ninguém, e vocês só se preocupam em aproveitar.
          </p>
          <Image
            src={MIDIA.marca.mel}
            alt="Mel Simão segurando o celular"
            width={720}
            height={720}
            unoptimized
            className="mx-auto mt-2 w-full max-w-sm"
          />
        </div>
      </section>

      {/* 6. Como funciona + garantias */}
      <section className="bg-marca-creme px-5 py-16 text-marca-escuro" aria-labelledby="titulo-como">
        <div className="mx-auto flex max-w-xl flex-col gap-6">
          <Rotulo claro>Como funciona</Rotulo>
          <h2 id="titulo-como" className="text-3xl leading-tight font-bold text-balance">
            Do primeiro oi ao dia do casamento
          </h2>
          <ol className="flex flex-col gap-5">
            <Passo n={1} titulo="Me conta a data">
              Pelo WhatsApp ou por um formulário rapidinho.
            </Passo>
            <Passo n={2} titulo="Recebe a proposta">
              Monto a proposta do casamento de vocês e mando no WhatsApp e no e-mail.
            </Passo>
            <Passo n={3} titulo="Reserva e aproveita">
              A data fica garantida com {c.reservaPct}% do valor. No dia, vocês só aproveitam.
            </Passo>
          </ol>

          <div className="mt-4 flex flex-col gap-4 rounded-md bg-white p-5">
            <h3 className="flex items-center gap-2 text-xl font-bold">
              <ShieldCheck aria-hidden className="size-6 text-marca-terracota" />
              O que fica garantido em contrato
            </h3>
            <Garantia icone={<CalendarCheck />} titulo="Mudou a data?">
              Se eu estiver livre no dia novo, o que vocês já pagaram vai junto.
            </Garantia>
            <Garantia icone={<Wrench />} titulo="Algum erro meu?">
              Nome escrito errado, arquivo com problema ou algo faltando: corrijo sem custo em até {c.diasCorrecao} dias úteis.
            </Garantia>
            <Garantia icone={<Heart />} titulo="E se eu tiver um imprevisto?">
              Vai alguém da minha equipe, no mesmo padrão de trabalho. Se ninguém puder ir, devolvo tudo o que vocês pagaram em até{" "}
              {c.diasDevolucao} dias.
            </Garantia>
          </div>
        </div>
      </section>

      {/* 7. FAQ */}
      <section className="bg-marca-creme px-5 pb-16 text-marca-escuro" aria-labelledby="titulo-faq">
        <div className="mx-auto flex max-w-xl flex-col gap-5 border-t border-marca-escuro/15 pt-16">
          <Rotulo claro>Dúvidas</Rotulo>
          <h2 id="titulo-faq" className="text-3xl leading-tight font-bold text-balance">
            O que os noivos mais me perguntam
          </h2>
          <div className="flex flex-col gap-2">
            <Pergunta titulo="O que faz uma storymaker?">
              Eu gravo, edito e publico o casamento de vocês em stories, pelo celular e com equipamento próprio: os detalhes,
              a cerimônia, a festa e a reação dos convidados, com trilha e legenda no estilo do casal. Depois vocês recebem também um
              Reels com o resumo do dia e todo o material, editado e original.
            </Pergunta>
            <Pergunta titulo="Já tenho fotógrafo e videomaker. Preciso de storymaker?">
              Eu não substituo nenhum dos dois, eu somo. Foto e filme são o registro para a vida toda e costumam chegar semanas
              depois. Os stories mostram o casamento enquanto ele acontece, ou poucos dias depois. E trabalho de forma discreta,
              sem atrapalhar o andamento do casamento.
            </Pergunta>
            <Pergunta titulo="Quando os stories vão para o ar?">
              Depende do pacote. No Real Time, eles vão saindo durante a festa; se a internet do local falhar, publico em até{" "}
              {c.horasSemInternet} horas. No Principal, publico tudo em até {prazos.storiesPrincipal}. Nos dois, o Reels e todo o material chegam no
              Drive em até {prazos.reels}.
            </Pergunta>
            <Pergunta titulo="Sai no nosso Instagram? Preciso passar a senha?">
              Sai no Instagram de vocês. O ideal é me liberar o acesso compartilhado do próprio Instagram, e aí vocês não precisam
              passar a senha. Uso só para publicar o casamento: não leio direct nem mexo nas configurações. Quando termino, paro de
              usar, e vocês tiram o meu acesso nas configurações (ou trocam a senha, se tiverem passado).
            </Pergunta>
            <Pergunta titulo="E se a gente não quiser postar nada?">
              Tudo bem. Sem acesso ao Instagram, eu entrego toda a cobertura por um link para vocês baixarem.
            </Pergunta>
            <Pergunta titulo="Você fica até o fim da festa?">
              A cobertura é de {prazos.horasCobertura} horas, entre cerimônia e recepção. Se a festa for mais longa, dá para somar
              hora adicional, conforme a minha agenda.
            </Pergunta>
            <Pergunta titulo="Por quanto tempo o material fica disponível?">
              O link fica no ar por {c.mesesDrive} meses depois do casamento. Baixem e guardem onde quiserem.
            </Pergunta>
            <Pergunta titulo="Quanto custa?">
              Depende do pacote, da data e do que vocês quiserem somar, como making of ou o Cantinho Polaroid. Me conta a data que
              eu mando a proposta completa. Para reservar são {c.reservaPct}% do valor, e o restante vai por PIX até{" "}
              {c.diasAntesSaldo} dias antes do casamento.
            </Pergunta>
            <Pergunta titulo="Você atende a minha cidade?">
              Atendo Campinas e região. Em Campinas a locomoção já está inclusa; para outras cidades, consulto o valor com vocês.
            </Pergunta>
          </div>
        </div>
      </section>

      {/* 8. CTA final */}
      <section className="lp-escuro relative overflow-hidden bg-marca-escuro px-5 py-20">
        <div aria-hidden className="lp-onda pointer-events-none absolute inset-0 bg-marca-areia/10" />
        <div className="relative mx-auto flex max-w-xl flex-col items-center gap-5 text-center">
          <MonogramaMel className="h-14 w-auto text-marca-areia" />
          <h2 className="text-3xl leading-tight font-bold text-balance text-marca-creme">
            Me conta a data que eu te mando a proposta.
          </h2>
          <p className="text-lg leading-relaxed text-pretty text-marca-creme/85">
            A data só fica reservada com o sinal de {c.reservaPct}%. Até lá, ela continua livre para outro casal.
          </p>
          <div className="flex w-full flex-col items-center gap-2">
            <CtaFormulario id={ID_CTA_FINAL} posicao="final" variante="claro">
              Consultar minha data
            </CtaFormulario>
            <p className="text-sm text-marca-areia">Você escolhe: falar comigo no WhatsApp ou pedir um orçamento.</p>
          </div>
        </div>
      </section>

      {/* 9. Rodapé. O padding de baixo deixa espaço para a barra fixa. */}
      <footer className="lp-escuro border-t border-marca-creme/10 px-5 pb-32 pt-10">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <div className="flex items-center gap-3">
            <MonogramaMel className="h-9 w-auto text-marca-creme" />
            <LogoMel className="h-4 w-auto text-marca-creme" />
          </div>
          <p className="text-sm text-marca-areia">Campinas | SP</p>
          <ul className="flex flex-col gap-1 text-base">
            {whatsapp && (
              <li>
                <LinkWhatsApp numero={whatsapp} className="inline-flex min-h-11 items-center gap-2 text-marca-creme underline-offset-4 hover:underline">
                  <MessageCircle aria-hidden className="size-5 text-marca-areia" />
                  {telefoneLegivel(whatsapp)}
                </LinkWhatsApp>
              </li>
            )}
            <li>
              <a href={`mailto:${CONTRATADA.email}`} className="inline-flex min-h-11 items-center gap-2 text-marca-creme underline-offset-4 hover:underline">
                <Mail aria-hidden className="size-5 text-marca-areia" />
                {CONTRATADA.email}
              </a>
            </li>
            <li>
              <a
                href="https://www.instagram.com/mel.storymaker/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 text-marca-creme underline-offset-4 hover:underline"
              >
                <Camera aria-hidden className="size-5 text-marca-areia" />
                @mel.storymaker
              </a>
            </li>
          </ul>
          <p className="text-xs text-marca-areia">CNPJ {CONTRATADA.cnpjFormatado}</p>
        </div>
      </footer>

      <BarraCtaFixa idHero={ID_CTA_HERO} idFinal={ID_CTA_FINAL} />
      {/* A query do anúncio (`fbclid`, `utm_*`) nos CTAs ANTES da hidratação.
          No 4G o lead toca no botão do hero antes de o React acordar, e o
          `<a>` do HTML estático não tem a query: o lead nasceria sem nada que o
          ligasse ao anúncio. Mesma regra do `repassarQuery` (os parâmetros do
          próprio link ganham dos que vieram). O `CtaFormulario` repete isso
          depois da hidratação. O mesmo script marca `lp-carregado` no `load`,
          que é quando a onda decorativa entra (globals.css). */}
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_QUERY_NOS_CTAS }} />
    </main>
  );
}

/** Só os campos que a galeria usa: a ilha do navegador não recebe bytes nem duração. */
function pick(m: { video: string; preview: string; poster: string; temAudio: boolean }) {
  return { video: m.video, preview: m.preview, poster: m.poster, temAudio: m.temAudio };
}

/** "a, b e c". */
function lista(itens: readonly string[]): string {
  return itens.length < 2 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function Rotulo({ children, claro }: { children: ReactNode; claro?: boolean }) {
  return (
    <p className={cn("text-xs font-bold uppercase tracking-[0.2em]", claro ? "text-marca-terracota" : "text-marca-areia")}>
      {children}
    </p>
  );
}

function Pilar({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-md bg-white p-4">
      <span aria-hidden className="mt-0.5 shrink-0 text-marca-terracota [&_svg]:size-6">
        {icone}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-lg font-bold">{titulo}</span>
        <span className="text-base leading-snug">{children}</span>
      </span>
    </li>
  );
}

function Passo({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-marca-escuro text-lg font-bold text-marca-creme"
      >
        {n}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-lg font-bold">{titulo}</span>
        <span className="text-base leading-snug">{children}</span>
      </span>
    </li>
  );
}

function Garantia({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 shrink-0 text-marca-terracota [&_svg]:size-5">
        {icone}
      </span>
      <p className="text-base leading-snug">
        <strong className="font-bold">{titulo}</strong> {children}
      </p>
    </div>
  );
}

function Pergunta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="group rounded-md bg-white">
      <summary className="flex min-h-14 list-none items-center justify-between gap-3 px-4 py-3 text-lg font-bold [&::-webkit-details-marker]:hidden">
        {titulo}
        <span aria-hidden className="text-2xl leading-none font-light text-marca-terracota transition-transform duration-200 group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="px-4 pb-4 text-base leading-relaxed">{children}</p>
    </details>
  );
}
