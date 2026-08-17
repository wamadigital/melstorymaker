"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import { ArrowLeft, Loader2, WifiOff } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BarraProgresso } from "@/components/form/BarraProgresso";
import { CampoPergunta } from "@/components/form/CampoPergunta";
import {
  arvore,
  limparRespostasOrfas,
  normalizarOpcoes,
  passoAnterior,
  passosVisiveis,
  progresso,
  proximoPasso,
} from "@/lib/form/engine";
import { validarResposta } from "@/lib/form/validacao";
import { isCategoria, type Categoria, type Respostas } from "@/lib/form/types";

const CHAVE_LEAD = "mel:lead_id";

type Tela = "boas_vindas" | "categoria" | "pergunta" | "confirmacao";

export function FormularioClient({ whatsappMel }: { whatsappMel: string }) {
  // Comeca em boas_vindas de proposito: e o estado que o servidor renderiza, e
  // o titulo precisa estar no HTML inicial para o LCP ficar abaixo de 2,5s em
  // 4G. Uma tela de "carregando" aqui empurraria o LCP para depois da
  // hidratacao + da ida ao banco. A retomada acontece logo depois, por cima.
  const [tela, setTela] = useState<Tela>("boas_vindas");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [respostas, setRespostas] = useState<Respostas>({});
  const [passoId, setPassoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [retomando, setRetomando] = useState(false);
  const [offline, setOffline] = useState(false);
  const [direcao, setDirecao] = useState<1 | -1>(1);

  const semMovimento = useReducedMotion();
  // Guarda o ultimo estado salvo com sucesso, para o botao "tentar de novo".
  const ultimoEnvio = useRef<Respostas>({});

  const passos = categoria ? passosVisiveis(categoria, respostas) : [];
  const passo = passos.find((p) => p.id === passoId) ?? null;

  // ---------------------------------------------------------------- retomada

  useEffect(() => {
    const salvo = window.localStorage.getItem(CHAVE_LEAD);
    // Sem lead salvo a tela ja esta certa: nada a fazer, nenhum request.
    if (!salvo) return;

    let cancelado = false;
    setRetomando(true);

    (async () => {
      try {
        const r = await fetch(`/api/leads/${salvo}`, { cache: "no-store" });
        if (cancelado) return;

        if (!r.ok) {
          window.localStorage.removeItem(CHAVE_LEAD);
          return;
        }

        const lead = await r.json();

        // Lead que ja terminou nao volta pro formulario: reabrir o link comeca
        // uma proposta nova, em vez de reeditar uma proposta ja enviada.
        if (lead.status !== "incompleto" || !isCategoria(lead.categoria)) {
          window.localStorage.removeItem(CHAVE_LEAD);
          return;
        }

        const rec: Respostas = lead.respostas ?? {};
        const visiveis = passosVisiveis(lead.categoria, rec);
        const alvo = visiveis.find((p) => p.id === lead.passo_atual) ?? visiveis[0];

        setLeadId(lead.id);
        setCategoria(lead.categoria);
        setRespostas(rec);
        ultimoEnvio.current = rec;
        setPassoId(alvo?.id ?? null);
        setRascunho(alvo ? (rec[alvo.id] ?? "") : "");
        setTela(alvo ? "pergunta" : "categoria");
      } catch {
        // Falhou a retomada: segue em boas_vindas, que ja esta na tela.
      } finally {
        if (!cancelado) setRetomando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  // ------------------------------------------------------------- persistencia

  /**
   * Envia SEMPRE o conjunto completo de respostas, nao o delta. Assim, se o
   * lead ficar sem sinal por tres perguntas dentro do navegador do WhatsApp, o
   * primeiro autosave que voltar a funcionar recupera tudo sozinho.
   */
  const salvar = useCallback(
    async (rec: Respostas, proximo: string | null, cat: Categoria, id: string) => {
      try {
        const r = await fetch(`/api/leads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoria: cat, respostas: rec, passo_atual: proximo ?? undefined }),
        });
        if (!r.ok) throw new Error(String(r.status));
        ultimoEnvio.current = rec;
        setOffline(false);
        return true;
      } catch {
        setOffline(true);
        return false;
      }
    },
    [],
  );

  // ------------------------------------------------------------------ navegar

  async function escolherCategoria(valor: string) {
    if (!isCategoria(valor) || ocupado) return;
    setOcupado(true);
    setErro(null);

    try {
      let id = leadId;

      if (!id) {
        // RF-02: o lead nasce aqui, antes da 2a pergunta. Lead parcial e lead.
        const r = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoria: valor }),
        });
        if (!r.ok) throw new Error("criar");
        const criado = await r.json();
        id = criado.id as string;
        window.localStorage.setItem(CHAVE_LEAD, id);
        setLeadId(id);
      }

      // Trocar de categoria reaproveita o mesmo lead e preserva o contato:
      // criar um registro novo a cada troca encheria o painel de lead orfao.
      const trocou = !!categoria && categoria !== valor;
      const base: Respostas = trocou
        ? Object.fromEntries(Object.entries(respostas).filter(([k]) => k.startsWith("contato_")))
        : respostas;

      const visiveis = passosVisiveis(valor, base);
      const primeiro = visiveis[0] ?? null;

      setCategoria(valor);
      setRespostas(base);
      setPassoId(primeiro?.id ?? null);
      setRascunho(primeiro ? (base[primeiro.id] ?? "") : "");
      setDirecao(1);
      setTela("pergunta");

      void salvar(base, primeiro?.id ?? null, valor, id);
    } catch {
      setErro("Não consegui começar agora. Tenta de novo?");
    } finally {
      setOcupado(false);
    }
  }

  async function avancar(valorOverride?: string) {
    if (!passo || !categoria || !leadId || ocupado) return;

    const valor = valorOverride ?? rascunho;
    const mensagem = validarResposta(passo, valor);
    if (mensagem) {
      setErro(mensagem);
      return;
    }

    setErro(null);
    const atualizadas = limparRespostasOrfas(categoria, { ...respostas, [passo.id]: valor });
    const prox = proximoPasso(categoria, atualizadas, passo.id);

    setRespostas(atualizadas);
    setDirecao(1);

    if (prox) {
      // Avanco otimista: a tela nao espera a rede. O PATCH carrega o estado
      // inteiro, entao uma falha isolada se resolve no proximo passo.
      setPassoId(prox.id);
      setRascunho(atualizadas[prox.id] ?? "");
      void salvar(atualizadas, prox.id, categoria, leadId);
      return;
    }

    await submeter(atualizadas, categoria, leadId, passo.id);
  }

  async function submeter(rec: Respostas, cat: Categoria, id: string, passoFinal: string) {
    setOcupado(true);
    setErro(null);

    try {
      // Aqui o await e obrigatorio: e a ultima chance de o servidor receber
      // tudo antes da transicao de status.
      //
      // passoFinal (e nao null) de proposito: se o submit falhar logo depois, a
      // retomada precisa voltar na ULTIMA pergunta, nao na primeira. Passar null
      // faria o handler cair no primeiro passo visivel.
      const salvou = await salvar(rec, passoFinal, cat, id);
      if (!salvou) throw new Error("autosave");

      const r = await fetch(`/api/leads/${id}/submit`, { method: "POST" });
      if (!r.ok) throw new Error("submit");

      window.localStorage.removeItem(CHAVE_LEAD);
      setTela("confirmacao");
    } catch {
      setErro("Não consegui enviar agora. Confere sua conexão e tenta de novo?");
      setOffline(true);
    } finally {
      setOcupado(false);
    }
  }

  function voltar() {
    if (!passo || !categoria) return;
    setErro(null);
    setDirecao(-1);

    const anterior = passoAnterior(categoria, respostas, passo.id);
    if (!anterior) {
      setTela("categoria");
      return;
    }
    setPassoId(anterior.id);
    setRascunho(respostas[anterior.id] ?? "");
  }

  // ------------------------------------------------------------------ animacao

  const desloc = semMovimento ? 0 : 24;
  const transicao = { duration: semMovimento ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] as const };
  const variantes = {
    entra: { opacity: 0, x: direcao * desloc },
    ativo: { opacity: 1, x: 0 },
    sai: { opacity: 0, x: direcao * -desloc },
  };

  const marcador =
    categoria && passo ? progresso(categoria, respostas, passo.id) : { atual: 1, total: 1 };

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
        {tela === "pergunta" && (
          <header className="mb-8 flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={voltar}
              aria-label="Voltar"
              className="-ml-2 shrink-0"
            >
              <ArrowLeft className="size-5" />
            </Button>
            <BarraProgresso atual={marcador.atual} total={marcador.total} />
            <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
              {marcador.atual}/{marcador.total}
            </span>
          </header>
        )}

        <main className="flex flex-1 flex-col justify-center">
          <AnimatePresence mode="wait" initial={false}>
            <m.section
              key={tela === "pergunta" ? `p:${passoId}` : tela}
              variants={variantes}
              initial="entra"
              animate="ativo"
              exit="sai"
              transition={transicao}
              className="w-full"
            >
              {tela === "boas_vindas" && (
                <div className="flex flex-col gap-6 text-center">
                  <h1 className="text-4xl leading-tight font-semibold text-balance">
                    {arvore.boas_vindas.titulo}
                  </h1>
                  <p className="text-lg text-pretty text-muted-foreground">
                    {arvore.boas_vindas.texto}
                  </p>
                  <Button
                    size="lg"
                    // Enquanto a retomada esta em voo, entrar aqui criaria um
                    // lead novo por cima de um que ja existe.
                    disabled={retomando}
                    className="mt-2 h-14 rounded-2xl text-lg"
                    onClick={() => {
                      setDirecao(1);
                      setTela("categoria");
                    }}
                  >
                    {retomando && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {arvore.boas_vindas.cta}
                  </Button>
                </div>
              )}

              {tela === "categoria" && (
                <div className="flex flex-col gap-7">
                  <h2 className="text-3xl leading-tight font-semibold text-balance">
                    {arvore.categoria.pergunta}
                  </h2>
                  <div className="flex flex-col gap-3">
                    {normalizarOpcoes(arvore.categoria.opcoes).map((opcao) => (
                      <button
                        key={opcao.valor}
                        type="button"
                        disabled={ocupado}
                        onClick={() => escolherCategoria(opcao.valor)}
                        className="min-h-14 w-full rounded-2xl border border-border bg-card px-5 py-4 text-left text-lg transition-colors hover:border-primary/40 hover:bg-accent active:scale-[0.99] disabled:opacity-60"
                      >
                        {opcao.rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tela === "pergunta" && passo && (
                <div className="flex flex-col gap-7">
                  <h2 className="text-3xl leading-tight font-semibold text-balance">
                    {passo.pergunta}
                  </h2>

                  <CampoPergunta
                    passo={passo}
                    valor={rascunho}
                    erro={erro}
                    onChange={(v) => {
                      setRascunho(v);
                      if (erro) setErro(null);
                    }}
                    onAvancar={avancar}
                  />

                  {/* escolha_unica avanca no proprio clique: um botao aqui seria um passo a mais sem funcao. */}
                  {passo.tipo !== "escolha_unica" && (
                    <Button
                      size="lg"
                      disabled={ocupado}
                      onClick={() => avancar()}
                      className="h-14 rounded-2xl text-lg"
                    >
                      {ocupado && <Loader2 className="mr-2 size-4 animate-spin" />}
                      {proximoPasso(categoria!, respostas, passo.id) ? "Continuar" : "Enviar"}
                    </Button>
                  )}
                </div>
              )}

              {tela === "confirmacao" && (
                <div className="flex flex-col gap-6 text-center">
                  <h1 className="text-4xl leading-tight font-semibold text-balance">
                    {arvore.confirmacao.titulo}
                  </h1>
                  <p className="text-lg text-pretty text-muted-foreground">
                    {arvore.confirmacao.texto}
                  </p>
                  <a
                    href={`https://wa.me/${whatsappMel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ size: "lg" }), "mt-2 h-14 rounded-2xl text-lg")}
                  >
                    {arvore.confirmacao.cta_whatsapp}
                  </a>
                </div>
              )}
            </m.section>
          </AnimatePresence>

          {erro && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {erro}
            </p>
          )}
        </main>

        {offline && (
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <WifiOff className="size-3.5" />
            Sem conexão. Suas respostas são salvas assim que o sinal voltar.
          </p>
        )}
      </div>
    </LazyMotion>
  );
}
