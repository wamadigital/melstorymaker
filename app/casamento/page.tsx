import { CalendarCheck, Camera, Check, Clapperboard, Download, EyeOff, Heart, MessageCircle, Mail, ShieldCheck, Sparkles, Wrench } from "lucide-react";
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
import {
  adicionaisDaLp,
  CELEBRACOES_MAIS_DE,
  condicoesDaLp,
  pacotesDaLp,
  prazosDoFaq,
  telefoneLegivel,
  TITULO_LP,
} from "./conteudo";
import { MIDIA } from "./midia.gerado";
import { ANO_PRIMEIRO_CASAMENTO, REELS } from "./reels";

/*
 * LP de venda de casamento: destino dos anúncios do Instagram.
 *
 * Decisões do owner (01/10/2026), registradas no CLAUDE.md:
 * - identidade COMPLETA da marca só aqui (tokens em `.lp-casamento`);
 * - os Reels são a prova: sem nome de casal, sem depoimento, sem preço;
 * - todo CTA vai ao formulário de sempre, em modo casamento.
 * E de 03/10/2026: o serviço é o REGISTRO para guardar e rever; publicar nos
 * stories é opção do casal, nunca a promessa principal.
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
    "Registro a cerimônia, a festa e os momentos espontâneos pelo celular, em vídeos para vocês guardarem. Se quiserem, também publico nos stories. Campinas e região.",
  alternates: { canonical: "/casamento" },
  openGraph: {
    title: TITULO_LP,
    description: "Os vídeos do casamento de vocês, registrados pela Mel pelo celular, para guardar e compartilhar. Campinas e região.",
    url: "/casamento",
    siteName: "Mel Simão | Storymaker",
    locale: "pt_BR",
    type: "website",
  },
};

const SCRIPT_QUERY_NOS_CTAS = `addEventListener("load",function(){document.documentElement.classList.add("lp-carregado")});(function(){try{if(!location.search)return;document.querySelectorAll("a[data-cta]").forEach(function(a){var u=new URL(a.getAttribute("href"),location.origin);var p=new URLSearchParams(location.search);u.searchParams.forEach(function(v,k){p.set(k,v)});a.setAttribute("href",u.pathname+"?"+p.toString())})}catch(e){}})();`;

/** Parágrafo que passa de 6 linhas no celular: ver o comentário do `<main>`. */
const LONGO = "text-pretty sm:text-balance";

const ID_CTA_HERO = "cta-hero";
const ID_CTA_FINAL = "cta-final";

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
    // `text-balance` aqui, e não bloco a bloco: `text-wrap` é herdado, então vale
    // para todo texto da LP, inclusive o das ilhas (galeria, barra fixa) --
    // nenhuma quebra deixa uma palavra sozinha na última linha (owner, 03/10/2026).
    // O Chromium só balanceia bloco de até 6 linhas e, acima disso, volta à
    // quebra comum, viúva incluída. Por isso os parágrafos que passam de 6
    // linhas no celular levam `LONGO`: `text-pretty` (não deixa palavra
    // sozinha em tamanho nenhum) só até 640px, e balanceados dali para cima,
    // onde a coluna é larga e eles cabem em 4. Medido em 03/10/2026, de 320 a
    // 1280px: nenhuma palavra sozinha.
    <main className="lp-casamento min-h-dvh bg-marca-escuro font-light text-balance text-marca-creme" style={estiloOnda}>
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

      {/* 1. Hero: texto no escuro liso e o vídeo num quadro de câmera (HeroVideo).
          Nada por cima do vídeo além do visor: o título sobre as pétalas não
          se lia (owner, 03/10/2026). */}
      <section className="lp-escuro">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <header className="flex items-center gap-3 pb-2">
            <MonogramaMel className="h-8 w-auto text-marca-creme" />
            <LogoMel className="h-4 w-auto text-marca-creme" />
          </header>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-marca-areia">Storymaker · Campinas e região</p>
          <h1 className="text-4xl leading-[1.08] font-bold text-balance text-marca-creme sm:text-5xl">{TITULO_LP}</h1>
          <HeroVideo
            teaser={MIDIA.hero.teaser}
            poster={MIDIA.hero.poster}
            alt="Noivos saindo da cerimônia de mãos dadas sob uma chuva de pétalas, ao entardecer"
          />
          <p className="text-lg leading-relaxed text-marca-creme/90">
            Sou a Mel e já registrei mais de {CELEBRACOES_MAIS_DE} celebrações pelo celular. Guardo abraços, sorrisos e lágrimas de
            alegria enquanto vocês celebram essa nova etapa ao lado de quem amam.
          </p>
          <CtaFormulario id={ID_CTA_HERO} posicao="hero" variante="claro" className="max-w-none">
            Consultar nossa data
          </CtaFormulario>
        </div>
      </section>

      {/* Faixa logo abaixo da dobra */}
      <section className="lp-escuro border-y border-marca-creme/10 bg-marca-medio/40 px-5 py-6">
        <p className="mx-auto max-w-xl text-center text-base leading-relaxed text-marca-creme/90">
          Desde {ANO_PRIMEIRO_CASAMENTO}, registrando em vídeos o que a emoção nem sempre deixa colocar em palavras.
        </p>
      </section>

      {/* 2. Galeria de Reels */}
      <section className="lp-escuro py-16" aria-labelledby="titulo-galeria">
        <div className="mx-auto mb-8 flex max-w-xl flex-col gap-3 px-5">
          <Rotulo>Portfólio</Rotulo>
          <h2 id="titulo-galeria" className="text-3xl leading-tight font-bold text-balance text-marca-creme">
            Conheça meu trabalho
          </h2>
          <p className="text-lg leading-relaxed text-marca-creme/85">
            Estes são alguns vídeos de resumo que preparei para os casais. Aperte o play, ligue o som e conheça meu jeito de registrar as
            cerimônias, as reações e a festa.
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
            Quero uma proposta
          </CtaFormulario>
        </div>
      </section>

      {/* 3. O que eu registro + benefícios + a escolha de publicar (transição para os pacotes) */}
      <section className="bg-marca-creme px-5 py-16 text-marca-escuro" aria-labelledby="titulo-registro">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <Rotulo claro>A cobertura</Rotulo>
          <h2 id="titulo-registro" className="text-3xl leading-tight font-bold text-balance">
            O que eu registro no casamento?
          </h2>
          <p className={cn("text-lg leading-relaxed", LONGO)}>
            Com o celular, acompanho a cerimônia e a festa para registrar detalhes, reações e momentos espontâneos. Depois, vocês
            recebem os vídeos editados para baixar e guardar.
          </p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            <Pilar icone={<Sparkles />} titulo="Momentos espontâneos">
              Atenção aos abraços, às reações e ao que acontece durante a cobertura.
            </Pilar>
            <Pilar icone={<Clapperboard />} titulo="Edição">
              Montagem, trilha e legendas pensadas para combinar com o casal.
            </Pilar>
            <Pilar icone={<Download />} titulo="Vídeos para guardar">
              Arquivos originais e editados disponíveis para vocês baixarem e reverem.
            </Pilar>
            <Pilar icone={<EyeOff />} titulo="Durante o casamento">
              Respeitamos sempre o espaço dos demais profissionais.
            </Pilar>
          </ul>
          <div className="mt-2 flex flex-col gap-2 rounded-md bg-marca-escuro px-5 py-5 text-marca-creme">
            <h3 className="text-xl leading-snug font-bold text-balance">Para guardar. Para compartilhar. Vocês escolhem.</h3>
            <p className={cn("text-lg leading-snug text-marca-creme/90", LONGO)}>
              Se vocês também quiserem publicar no Instagram, os
              stories saem depois do casamento ou em tempo real, conforme a opção escolhida.
            </p>
          </div>
        </div>
      </section>

      {/* 4. Pacotes */}
      <section className="bg-marca-creme px-5 pb-16 text-marca-escuro" aria-labelledby="titulo-pacotes">
        <div className="mx-auto flex max-w-xl flex-col gap-5 border-t border-marca-escuro/15 pt-16">
          <Rotulo claro>Pacotes</Rotulo>
          <h2 id="titulo-pacotes" className="text-3xl leading-tight font-bold text-balance">
            Escolham como querem registrar e compartilhar.
          </h2>
          <p className="text-lg leading-relaxed">
            Conheçam as
            opções de cobertura e o que cada uma inclui.
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
            <p className="text-base font-bold">Opcionais:</p>
            <ul className="flex flex-wrap gap-2">
              {adicionais.map((a) => (
                <li key={a} className="rounded-md border border-marca-escuro/20 bg-white px-3 py-1.5 text-sm">
                  {a}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex flex-col items-center gap-2 text-center">
            <CtaFormulario posicao="pacotes" variante="terracota">
              Consultar nossa data
            </CtaFormulario>
          </div>
        </div>
      </section>

      {/* 5. A Mel */}
      <section className="lp-escuro relative overflow-hidden bg-marca-escuro px-5 pt-16">
        <div aria-hidden className="lp-onda pointer-events-none absolute inset-0 bg-marca-areia/15" />
        <div className="relative mx-auto flex max-w-xl flex-col gap-5">
          <Rotulo>Quem sou eu</Rotulo>
          <h2 className="text-3xl leading-tight font-bold text-balance text-marca-creme">
            Mais de {CELEBRACOES_MAIS_DE} celebrações registradas.
          </h2>
          <p className={cn("text-lg leading-relaxed text-marca-creme/90", LONGO)}>
            Sou a Mel, storymaker de casamentos. Pelo celular, acompanho os encontros, as reações e os momentos espontâneos com
            atenção e discrição. Essa experiência faz parte do olhar que levo para o casamento de vocês, em vídeos para guardar e
            rever.
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
            Da primeira conversa à cerimônia.
          </h2>
          <ol className="flex flex-col gap-5">
            <Passo n={1} titulo="Contem o que estão planejando">
              Quero saber quando, onde e como será a celebração.
            </Passo>
            <Passo n={2} titulo="Escolham a cobertura">
              Conversamos sobre os registros, a publicação e o que faz sentido para vocês.
            </Passo>
            <Passo n={3} titulo="Reservem a data">
              Com a proposta aprovada e o sinal pago, seguimos com os preparativos da cobertura.
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
              Vai alguém da minha equipe, no mesmo padrão de trabalho.
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
            <Pergunta titulo="Como funciona o trabalho de uma storymaker no casamento?" longo>
              Eu registro os momentos da cobertura em vídeo pelo celular e preparo os materiais para vocês receberem e guardarem. A
              publicação nos stories também pode fazer parte do serviço, se vocês quiserem.
            </Pergunta>
            <Pergunta titulo="A cobertura combina com o trabalho do fotógrafo e do videomaker?" longo>
              Sim. Minha atuação acrescenta registros pelo celular, com atenção aos momentos espontâneos da cobertura. Posso trabalhar
              junto das outras equipes, respeitando o espaço e o andamento do casamento. Vocês recebem esses vídeos para guardar e
              rever.
            </Pergunta>
            <Pergunta titulo="Podemos contratar só os registros, sem postar no Instagram?" longo>
              Sim. Vocês podem contratar a cobertura para receber os vídeos e guardar os registros, sem publicação e sem disponibilizar
              acesso ao Instagram. Se quiserem que eu publique, combinamos a forma de acesso e as publicações na contratação.
            </Pergunta>
            <Pergunta titulo="Quando vamos receber os vídeos?" longo>
              O vídeo de resumo e os arquivos originais e editados ficam disponíveis no Drive em até {prazos.entregaDrive}. Se vocês
              escolherem publicação nos stories, ela segue o prazo da cobertura contratada e as condições apresentadas no pacote.
            </Pergunta>
            <Pergunta titulo="Você fica até o fim da festa?">
              A cobertura é de {prazos.horasCobertura} horas, entre cerimônia e recepção. Se a festa for mais longa, dá para somar
              hora adicional, conforme a minha agenda.
            </Pergunta>
            <Pergunta titulo="Por quanto tempo o material fica disponível?">
              O link fica no ar por {c.mesesDrive} meses depois do casamento. Baixem e guardem onde quiserem.
            </Pergunta>
            <Pergunta titulo="Quanto custa?" longo>
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
            Que momentos vocês querem ter para rever?
          </h2>
          <p className="text-lg leading-relaxed text-marca-creme/85">
            Vamos conversar sobre o casamento e sobre como vocês gostariam de guardar esses registros.
          </p>
          <div className="flex w-full flex-col items-center gap-2">
            <CtaFormulario id={ID_CTA_FINAL} posicao="final" variante="claro">
              Conversar sobre nosso casamento
            </CtaFormulario>
            <p className="text-sm text-marca-areia">Consultem a disponibilidade e conheçam as opções de cobertura.</p>
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

function Pergunta({ titulo, longo, children }: { titulo: string; longo?: boolean; children: ReactNode }) {
  return (
    <details className="group rounded-md bg-white">
      <summary className="flex min-h-14 list-none items-center justify-between gap-3 px-4 py-3 text-lg font-bold [&::-webkit-details-marker]:hidden">
        {titulo}
        <span aria-hidden className="text-2xl leading-none font-light text-marca-terracota transition-transform duration-200 group-open:rotate-45">
          +
        </span>
      </summary>
      <p className={cn("px-4 pb-4 text-base leading-relaxed", longo && LONGO)}>{children}</p>
    </details>
  );
}
