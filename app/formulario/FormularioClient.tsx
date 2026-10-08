"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { linkPrimeiroContato } from "@/lib/whatsapp";
import { BarraProgresso } from "@/components/form/BarraProgresso";
import { CampoPergunta } from "@/components/form/CampoPergunta";
import { OpcaoEscolha } from "@/components/form/OpcaoEscolha";
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
import { EVENTO, EVENTO_FORMULARIO, idEvento } from "@/lib/meta/eventos";
import { rastrear, rastrearComCopia } from "@/lib/meta/pixel";
import {
  armazenamentoLocal, concluirLeadLocal, ErroPersistencia, esquecerLead, falhaDaResposta, FilaAutosave, guardarLead,
  lerLeadSalvo, lerRascunho, limparRascunho, permiteNovaTentativa,
  type Armazenamento, type EstadoPersistencia,
} from "@/lib/form/persistencia";
import { estadosIguais, respostasIguais, type EstadoFormulario } from "@/lib/form/snapshot";
import { CriacaoLead, respostasIniciaisPreservadas, type TentativaCriacao } from "@/lib/form/criacao";

/**
 * Caixa das duas portas da abertura. Mesma forma e mesma altura minima nas
 * duas: elas sao alternativas de peso igual, e uma mais baixa que a outra
 * leria como opcao secundaria. A altura vem daqui e nao do conteudo porque os
 * rotulos tem tamanhos diferentes -- em 360px um quebra em duas linhas e o
 * outro nao.
 */
const PORTA =
  "flex min-h-40 flex-col justify-between gap-4 rounded-md p-4 text-left transition-all active:scale-[0.99]";

type Tela = "boas_vindas" | "categoria" | "pergunta" | "confirmacao";

/** `/formulario` abre nas duas portas; `/orcamento`, direto na categoria. */
export type TelaInicial = Extract<Tela, "boas_vindas" | "categoria">;

export function FormularioClient({
  whatsappMel,
  inicio,
  categoriaInicial,
}: {
  whatsappMel: string;
  inicio: TelaInicial;
  /**
   * Evento ja escolhido na URL (`/formulario?evento=casamento`, da LP), lido
   * no servidor. Muda o subtitulo e a mensagem da abertura, e a porta "Quero
   * um orcamento" pula a escolha da categoria.
   */
  categoriaInicial?: Categoria;
}) {
  // A tela inicial vem do servidor por prop, e nunca de uma leitura da URL no
  // navegador: e o estado que o servidor renderiza, e o conteudo precisa estar
  // no HTML inicial para o LCP ficar abaixo de 2,5s em 4G. Uma tela de
  // "carregando" aqui empurraria o LCP para depois da hidratacao + da ida ao
  // banco. A retomada acontece logo depois, por cima.
  const [tela, setTela] = useState<Tela>(inicio);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [respostas, setRespostas] = useState<Respostas>({});
  const [passoId, setPassoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [retomando, setRetomando] = useState(false);
  const [offline, setOffline] = useState(false);
  const [armazenamentoIndisponivel, setArmazenamentoIndisponivel] = useState(false);
  const [falhaRetomada, setFalhaRetomada] = useState(false);
  const [persistencia, setPersistencia] = useState<EstadoPersistencia>({
    pendente: false, enviando: false, salvoNoAparelho: false, falha: null,
  });
  const [direcao, setDirecao] = useState<1 | -1>(1);
  // A pessoa entrou no fluxo pela porta, com a categoria vinda da URL, e nunca
  // viu a tela de categoria: o "voltar" da primeira pergunta leva de novo as
  // portas. So `escolherCategoria` escreve isto, e so depois das travas dela.
  const [pulouCategoria, setPulouCategoria] = useState(false);

  const semMovimento = useReducedMotion();
  const temWhatsapp = whatsappMel.trim() !== "";
  const filaRef = useRef<FilaAutosave | null>(null);
  const armazenamentoRef = useRef<Armazenamento | null>(null);
  const leadRef = useRef<string | null>(null);
  const criacaoRef = useRef<CriacaoLead | null>(null);
  const criacaoAplicadaRef = useRef<string | null>(null);
  const enviandoFinalRef = useRef(false);
  const montadoRef = useRef(true);
  /** `IniciouOrcamento` sai uma vez por visita, na primeira entrada no fluxo. */
  const iniciouOrcamento = useRef(false);

  const passos = categoria ? passosVisiveis(categoria, respostas) : [];
  const passo = passos.find((p) => p.id === passoId) ?? null;

  const prepararFila = useCallback((id: string, base: EstadoFormulario) => {
    filaRef.current?.parar();
    const fila = new FilaAutosave(id, base, {
      armazenamento: armazenamentoRef.current,
      consultar: async () => {
        const r = await fetch(`/api/leads/${id}`, { cache: "no-store" });
        if (!r.ok) throw new ErroPersistencia(await falhaDaResposta(r));
        const lead = await r.json();
        return lead.status === "incompleto"
          ? { categoria: lead.categoria, respostas: lead.respostas ?? {}, passo_atual: lead.passo_atual ?? null }
          : null;
      },
      aoMudar: (estado) => {
        if (!montadoRef.current) return;
        setPersistencia(estado);
        setOffline(estado.falha?.tipo === "conexao");
      },
      enviar: async (estado, confirmada) => {
        const r = await fetch(`/api/leads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...estado, base: confirmada }),
        });
        if (!r.ok) return { ok: false, falha: await falhaDaResposta(r) };
        const ack = await r.json() as EstadoFormulario;
        return { ok: true, estado: ack };
      },
    });
    filaRef.current = fila;
    setPersistencia({ pendente: false, enviando: false, salvoNoAparelho: false, falha: null });
    return fila;
  }, []);

  const abrirEstado = useCallback((estado: EstadoFormulario) => {
    const rec = limparRespostasOrfas(estado.categoria, estado.respostas);
    const visiveis = passosVisiveis(estado.categoria, rec);
    const alvo = visiveis.find((p) => p.id === estado.passo_atual) ?? visiveis[0];
    setCategoria(estado.categoria);
    setRespostas(rec);
    setPassoId(alvo?.id ?? null);
    setRascunho(alvo ? (rec[alvo.id] ?? "") : "");
    setPulouCategoria(false);
    setTela(alvo ? "pergunta" : "categoria");
  }, []);

  const confirmarEnvio = useCallback((id: string, confirmado: Pick<EstadoFormulario, "categoria" | "respostas">, snapshotDescartado?: string | null) => {
    filaRef.current?.parar();
    concluirLeadLocal(id, confirmado, armazenamentoRef.current, snapshotDescartado);
    leadRef.current = null;
    setPersistencia({ pendente: false, enviando: false, salvoNoAparelho: false, falha: null });
    setOffline(false);
    rastrear(EVENTO.submit, { content_category: confirmado.categoria }, idEvento("submit", id));
    setTela("confirmacao");
  }, []);

  // ---------------------------------------------------------------- retomada

  useEffect(() => {
    montadoRef.current = true;
    armazenamentoRef.current = armazenamentoLocal();
    setArmazenamentoIndisponivel(!armazenamentoRef.current);
    const leadSalvo = lerLeadSalvo(armazenamentoRef.current);
    const criacao = new CriacaoLead({
      armazenamento: armazenamentoRef.current,
      leadConfirmadoAtual: leadSalvo,
      enviar: async (tentativa) => {
        const r = await fetch("/api/leads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...tentativa.estado, tentativa_id: tentativa.id }),
        });
        if (!r.ok) throw new ErroPersistencia(await falhaDaResposta(r));
        return { ...await r.json(), criadoAgora: r.status === 201 };
      },
      consultar: async (id) => {
        const r = await fetch(`/api/leads/${id}`, { cache: "no-store" });
        if (r.status === 404) return null;
        if (!r.ok) throw new ErroPersistencia(await falhaDaResposta(r));
        return r.json();
      },
    });
    criacaoRef.current = criacao;
    const tentativa = criacao.obterTentativa();
    const salvo = leadSalvo ?? tentativa?.id;
    // Sem lead salvo a tela ja esta certa: nada a fazer, nenhum request.
    if (!salvo) return () => { montadoRef.current = false; filaRef.current?.parar(); };

    let cancelado = false;
    setRetomando(true);
    leadRef.current = tentativa ? null : salvo;

    (async () => {
      try {
        let lead;
        let confirmada: TentativaCriacao | null = null;
        let criouAgora = false;
        if (tentativa) {
          const resultado = await criacao.recuperar()!;
          if (cancelado) return;
          if (!resultado.ok) throw new ErroPersistencia(resultado.falha);
          lead = resultado.lead;
          confirmada = resultado.tentativa;
          criouAgora = resultado.criadoAgora;
        } else {
          const r = await fetch(`/api/leads/${salvo}`, { cache: "no-store" });
          if (cancelado) return;
          if (!r.ok) {
            if (r.status !== 404 && r.status !== 410) throw new Error("retomada");
            esquecerLead(salvo, armazenamentoRef.current);
            limparRascunho(salvo, armazenamentoRef.current);
            leadRef.current = null;
            return;
          }
          lead = await r.json();
        }
        if (cancelado) return;

        if (!isCategoria(lead.categoria)) throw new Error("categoria inválida");
        const base: EstadoFormulario = {
          categoria: lead.categoria, respostas: lead.respostas ?? {}, passo_atual: lead.passo_atual ?? null,
        };
        let local = lerRascunho(lead.id, armazenamentoRef.current);
        const desejadoCriacao = confirmada?.rascunho ?? confirmada?.estado;
        const inicialDivergente = !local && desejadoCriacao && !respostasIniciaisPreservadas(desejadoCriacao, base)
          ? desejadoCriacao : null;
        if (confirmada) {
          leadRef.current = lead.id;
          if (!guardarLead(lead.id, armazenamentoRef.current)) setArmazenamentoIndisponivel(true);
          if (criouAgora) rastrear(EVENTO.lead, { content_category: lead.categoria }, idEvento("lead", lead.id));
        }
        const encerrado = lead.status !== "incompleto";
        // Uma outra aba pode ter enviado respostas diferentes das pendentes
        // deste aparelho. Fechado só libera o UUID se nenhum rascunho se perder.
        if (encerrado && !inicialDivergente && (!local || respostasIguais(local.estado, base))) {
          if (concluirLeadLocal(salvo, base, armazenamentoRef.current)) {
            if (confirmada) {
              criacao.confirmar(confirmada);
              setCategoria(base.categoria);
              setTela("confirmacao");
            }
            leadRef.current = null;
            return;
          }
          local = lerRascunho(lead.id, armazenamentoRef.current);
        }
        const estado = local?.estado ?? inicialDivergente ?? base;
        const fila = prepararFila(lead.id, base);
        if (encerrado) fila.reter(estado, { tipo: "encerrado", mensagem: "Esse formulário já foi enviado em outra aba. Seu rascunho contém respostas diferentes e continua neste aparelho." });
        else if (local) fila.restaurar(local);
        else if (inicialDivergente) {
          if (confirmada && estadosIguais(confirmada.estado, base)) fila.enfileirar(estado);
          else fila.reter(estado, { tipo: "conflito", mensagem: "Essa tentativa já foi recuperada com outras respostas. Seus dados iniciais continuam aqui; confira as respostas salvas antes de continuar." });
        }
        if (confirmada) criacao.confirmar(confirmada);

        setLeadId(lead.id);
        leadRef.current = lead.id;
        // Lead que já existe passou do degrau numa visita anterior: voltar até a
        // escolha do evento não conta outro começo.
        iniciouOrcamento.current = true;
        // Lead retomado volta para a tela de categoria, nunca para as portas:
        // de la, "Quero um orcamento" com `?evento=` trocaria a categoria dele
        // em silencio -- e a troca apaga as respostas do fluxo e grava no banco.
        abrirEstado(estado);
      } catch {
        if (!cancelado) {
          setFalhaRetomada(true);
          setErro("Não consegui recuperar seu orçamento agora. Tente carregar novamente para continuar sem criar outro.");
        }
      } finally {
        if (!cancelado) setRetomando(false);
      }
    })();

    return () => {
      cancelado = true;
      montadoRef.current = false;
      filaRef.current?.parar();
    };
  }, [abrirEstado, prepararFila]);

  useEffect(() => {
    const tentar = () => { void filaRef.current?.tentarNovamente(true); };
    const aoMostrar = () => { if (document.visibilityState === "visible") tentar(); };
    window.addEventListener("online", tentar);
    document.addEventListener("visibilitychange", aoMostrar);
    return () => {
      window.removeEventListener("online", tentar);
      document.removeEventListener("visibilitychange", aoMostrar);
    };
  }, []);

  // ------------------------------------------------------------- persistencia

  /**
   * Envia SEMPRE o conjunto completo de respostas, nao o delta. Assim, se o
   * lead ficar sem sinal por tres perguntas dentro do navegador do WhatsApp, o
   * primeiro autosave que voltar a funcionar recupera tudo sozinho.
   */
  function salvar(rec: Respostas, proximo: string | null, cat: Categoria, id: string) {
    const fila = filaRef.current;
    if (!fila || fila.leadId !== id) return;
    fila.enfileirar({ categoria: cat, respostas: rec, passo_atual: proximo });
  }

  /**
   * Cria o lead. Devolve o id, ou null se a rede falhou.
   *
   * Nasce ja com as respostas do primeiro passo -- ou seja, com o WhatsApp
   * dentro. Um POST vazio seguido de PATCH deixaria, no intervalo, exatamente o
   * registro que este desenho existe para nao criar.
   */
  const criarLead = useCallback(
    async (cat: Categoria, rec: Respostas, proximo: string | null) => {
      if (leadRef.current) return leadRef.current;
      const criacao = criacaoRef.current;
      if (!criacao) return null;
      const desejado: EstadoFormulario = { categoria: cat, respostas: rec, passo_atual: proximo };
      try {
        const resultado = await criacao.enviar(desejado);
        if (!criacao.estaSalvoNoAparelho()) setArmazenamentoIndisponivel(true);
        if (!resultado.ok) {
          setErro(resultado.falha.mensagem);
          setOffline(resultado.falha.tipo === "conexao");
          return null;
        }
        const criado = resultado.lead;
        const id = criado.id;
        if (criacaoAplicadaRef.current === id) return leadRef.current === id ? id : null;
        criacaoAplicadaRef.current = id;
        // Confirmado pelo servidor ANTES de qualquer escrita no aparelho.
        leadRef.current = id;
        setLeadId(id);
        if (!guardarLead(id, armazenamentoRef.current)) setArmazenamentoIndisponivel(true);
        const base: EstadoFormulario = { categoria: criado.categoria, respostas: criado.respostas, passo_atual: criado.passo_atual };
        const fila = prepararFila(id, base);
        setOffline(false);
        // Recuperação não é um nascimento novo: só HTTP 201 autoriza o Pixel
        // Lead. A entrega da cópia pelo servidor continua best-effort.
        if (resultado.criadoAgora) rastrear(EVENTO.lead, { content_category: criado.categoria }, idEvento("lead", id));
        if (criado.status !== "incompleto") {
          if (respostasIniciaisPreservadas(desejado, base)) confirmarEnvio(id, base);
          else {
            fila.reter(desejado, { tipo: "encerrado", mensagem: "Esse formulário já foi enviado com outras respostas. Seu rascunho continua neste aparelho." });
            abrirEstado(desejado);
          }
          criacao.confirmar(resultado.tentativa);
          return null;
        }
        if (!respostasIniciaisPreservadas(desejado, base)) {
          if (estadosIguais(resultado.tentativa.estado, base)) fila.enfileirar(desejado);
          else fila.reter(desejado, { tipo: "conflito", mensagem: "Essa tentativa foi recuperada com outras respostas. Seu rascunho continua aqui; confira as respostas salvas antes de continuar." });
          abrirEstado(desejado);
          criacao.confirmar(resultado.tentativa);
          return null;
        }
        criacao.confirmar(resultado.tentativa);
        if (!estadosIguais(desejado, base)) {
          abrirEstado(base);
          return null;
        }
        return id;
      } catch {
        setErro("Não consegui conectar para iniciar seu orçamento. Confira a conexão e tente novamente.");
        setOffline(true);
        return null;
      }
    },
    [abrirEstado, confirmarEnvio, prepararFila],
  );

  // ------------------------------------------------------------------ navegar

  /**
   * Escolher a categoria NAO cria mais o lead -- so muda de tela. O registro
   * nasce no primeiro avanco, ja com o WhatsApp (ver `avancar`). Quem toca numa
   * categoria e fecha a aba nao vira linha no painel: sem telefone a Mel nao
   * tem o que fazer com o lead, e a coluna "Novo" so acumularia gente
   * inalcancavel.
   *
   * `pelaPorta`: chamada pela porta "Quero um orcamento" com a categoria da
   * URL, sem passar pela tela de categoria. Escolher na tela zera a marca.
   */
  function escolherCategoria(valor: string, pelaPorta = false) {
    if (!isCategoria(valor) || ocupado || retomando || falhaRetomada) return;
    setErro(null);
    setPulouCategoria(pelaPorta);

    // O degrau entre a visita e o `Lead`: entrou no orçamento. Quem para aqui
    // começou e desistiu antes de deixar o WhatsApp.
    if (!iniciouOrcamento.current) {
      iniciouOrcamento.current = true;
      rastrearComCopia("trackCustom", EVENTO_FORMULARIO.iniciouOrcamento, { content_category: valor });
    }

    // Trocar de categoria preserva o contato ja digitado: quem voltou para
    // trocar nao deve redigitar o proprio telefone.
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

    // Se o lead JA existe (voltou e trocou de categoria), o autosave precisa
    // acompanhar a troca -- senao o painel mostra a categoria velha.
    if (leadId) salvar(base, primeiro?.id ?? null, valor, leadId);
  }

  async function avancar(valorOverride?: string) {
    if (!passo || !categoria || ocupado) return;

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

    // PRIMEIRO avanco: e aqui que o lead nasce, com a resposta ja dentro. E o
    // unico avanco que ESPERA a rede -- sem id nao existe o que salvar depois, e
    // seguir otimista deixaria a resposta orfa se a criacao falhasse.
    if (!leadId) {
      setOcupado(true);
      const id = await criarLead(categoria, atualizadas, prox?.id ?? null);
      setOcupado(false);

      if (!id) {
        return;
      }
      if (!prox) return submeter(atualizadas, categoria, id, passo.id);

      setPassoId(prox.id);
      setRascunho(atualizadas[prox.id] ?? "");
      return;
    }

    if (prox) {
      // Avanco otimista: a tela nao espera a rede. O PATCH carrega o estado
      // inteiro, entao uma falha isolada se resolve no proximo passo.
      setPassoId(prox.id);
      setRascunho(atualizadas[prox.id] ?? "");
      salvar(atualizadas, prox.id, categoria, leadId);
      return;
    }

    await submeter(atualizadas, categoria, leadId, passo.id);
  }

  async function submeter(rec: Respostas, cat: Categoria, id: string, passoFinal: string) {
    if (enviandoFinalRef.current) return;
    enviandoFinalRef.current = true;
    setOcupado(true);
    setErro(null);
    let respostasConfirmadas = false;

    try {
      // Aqui o await e obrigatorio: e a ultima chance de o servidor receber
      // tudo antes da transicao de status.
      //
      // passoFinal (e nao null) de proposito: se o submit falhar logo depois, a
      // retomada precisa voltar na ULTIMA pergunta, nao na primeira. Passar null
      // faria o handler cair no primeiro passo visivel.
      const fila = filaRef.current;
      if (!fila || fila.leadId !== id) return;
      salvar(rec, passoFinal, cat, id);
      if (!await fila.confirmarTudo()) {
        // O submit anterior pode ter fechado o formulário e perdido só a resposta.
        if (fila.obterFalha()?.tipo === "encerrado") {
          const atual = await fetch(`/api/leads/${id}`, { cache: "no-store" });
          if (atual.ok) {
            const fechado = await atual.json();
            if (fechado.status !== "incompleto" && respostasIguais(
              { categoria: cat, respostas: rec },
              { categoria: fechado.categoria, respostas: fechado.respostas ?? {} },
            )) confirmarEnvio(id, { categoria: fechado.categoria, respostas: fechado.respostas ?? {} });
          }
        }
        return;
      }
      respostasConfirmadas = true;

      const r = await fetch(`/api/leads/${id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: fila.obterBase() }),
      });
      if (!r.ok) {
        const falha = await falhaDaResposta(r);
        if (falha.tipo === "conflito" || falha.tipo === "encerrado") {
          fila.reter({ categoria: cat, respostas: rec, passo_atual: passoFinal }, falha);
        } else {
          const faltante = Object.keys(falha.campos ?? {}).find((chave) => passosVisiveis(cat, rec).some((p) => p.id === chave));
          if (faltante) {
            setPassoId(faltante);
            setRascunho(rec[faltante] ?? "");
          }
          setErro(faltante ? falha.campos![faltante] : falha.mensagem);
        }
        setOffline(false);
        return;
      }

      confirmarEnvio(id, fila.obterBase());
    } catch {
      setErro(respostasConfirmadas
        ? "Não consegui conectar para enviar. Suas respostas já foram salvas; confira a conexão e tente novamente."
        : "Não consegui conectar para conferir o envio. Seu rascunho continua aqui; confira a conexão e tente novamente.");
      setOffline(true);
    } finally {
      setOcupado(false);
      enviandoFinalRef.current = false;
    }
  }

  async function usarRespostasSalvas() {
    const id = leadRef.current;
    if (!id || ocupado) return;
    const snapshotDescartado = filaRef.current?.obterSnapshotPendenteId();
    setOcupado(true);
    try {
      const r = await fetch(`/api/leads/${id}`, { cache: "no-store" });
      if (!r.ok) {
        setErro((await falhaDaResposta(r)).mensagem);
        return;
      }
      const lead = await r.json();
      if (lead.status !== "incompleto") {
        if (isCategoria(lead.categoria)) confirmarEnvio(id, { categoria: lead.categoria, respostas: lead.respostas ?? {} }, snapshotDescartado);
        return;
      }
      if (!isCategoria(lead.categoria)) return;
      const base: EstadoFormulario = { categoria: lead.categoria, respostas: lead.respostas ?? {}, passo_atual: lead.passo_atual ?? null };
      const visiveis = passosVisiveis(base.categoria, base.respostas);
      const alvo = visiveis.find((p) => p.id === base.passo_atual) ?? visiveis[0];
      prepararFila(id, base);
      // Só o clique explícito escolhe substituir o rascunho pelas respostas salvas.
      if (snapshotDescartado) limparRascunho(id, armazenamentoRef.current, snapshotDescartado);
      setCategoria(base.categoria);
      setRespostas(base.respostas);
      setPassoId(alvo?.id ?? null);
      setRascunho(alvo ? (base.respostas[alvo.id] ?? "") : "");
      setPulouCategoria(false);
      setErro(null);
      setOffline(false);
    } catch {
      setErro("Não consegui carregar as respostas salvas agora. Seu rascunho continua neste aparelho.");
    } finally { setOcupado(false); }
  }

  function voltar() {
    if (!passo || !categoria) return;
    setErro(null);
    setDirecao(-1);

    const anterior = passoAnterior(categoria, respostas, passo.id);
    if (!anterior) {
      // Quem pulou a categoria volta para as portas: a tela de categoria seria
      // uma pergunta que a pessoa nunca viu, no caminho de volta.
      setTela(pulouCategoria ? "boas_vindas" : "categoria");
      return;
    }
    setPassoId(anterior.id);
    setRascunho(respostas[anterior.id] ?? "");
  }

  // ------------------------------------------------------------------ animacao

  const desloc = semMovimento ? 0 : 24;
  const transicao = { duration: semMovimento ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] as const };
  // Deslize VERTICAL, como no Typeform: avancar traz a proxima pergunta de
  // baixo para cima; voltar, de cima para baixo. E o mesmo eixo das setas de
  // navegacao no canto da tela.
  const variantes = {
    entra: { opacity: 0, y: direcao * desloc },
    ativo: { opacity: 1, y: 0 },
    sai: { opacity: 0, y: direcao * -desloc },
  };

  const marcador =
    categoria && passo ? progresso(categoria, respostas, passo.id) : { atual: 1, total: 1 };

  // Na ultima pergunta avancar() significa SUBMETER. A seta "Proxima pergunta"
  // do cluster fixo e navegacao, nao envio: fica desabilitada ali, como no
  // Typeform. Enviar continua sendo so o botao "Enviar" e o Enter no campo.
  const ehUltimoPasso =
    tela === "pergunta" && !!categoria && !!passo
      ? !proximoPasso(categoria, respostas, passo.id)
      : false;
  const temAvisoRodape = falhaRetomada || !!persistencia.falha || offline ||
    (tela === "pergunta" && (persistencia.pendente || armazenamentoIndisponivel));

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={cn(
        "mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pt-5",
        // A navegação fixa ocupa uma faixa própria abaixo dos avisos e ações.
        temAvisoRodape
          ? "pb-[calc(5rem_+_env(safe-area-inset-bottom))]"
          : "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
      )}>
        {tela === "pergunta" && (
          <header className="mb-8 flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={voltar}
              disabled={ocupado}
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

        {/* Persistente fora do AnimatePresence: o conteudo muda a cada passo e
            o role="status" anuncia a nova pergunta ao leitor de tela, que de
            outro modo nao percebe a troca de tela animada. */}
        {tela === "pergunta" && passo && (
          <span className="sr-only" role="status">
            Pergunta {marcador.atual} de {marcador.total}: {passo.pergunta}
          </span>
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
                <div className="flex flex-col gap-8">
                  <div className="flex flex-col gap-4 text-center">
                    <h1 className="text-4xl leading-tight font-semibold text-balance">
                      {arvore.boas_vindas.titulo}
                    </h1>
                    <p className="text-lg text-pretty text-muted-foreground">
                      {(categoriaInicial &&
                        arvore.boas_vindas.por_categoria?.[categoriaInicial]?.subtitulo) ??
                        arvore.boas_vindas.texto}
                    </p>
                  </div>

                  {/* Duas portas lado a lado. Quem ja sabe o que quer fala com
                      a Mel na hora; quem quer numero segue no formulario.
                      grid-cols-2 e nao flex: o grid iguala a altura das duas
                      sozinho, mesmo com rotulos de tamanhos diferentes. */}
                  <div className="grid w-full max-w-md grid-cols-2 gap-3 self-center">
                    {temWhatsapp && (
                      <a
                        href={linkPrimeiroContato(whatsappMel, categoriaInicial)}
                        target="_blank"
                        rel="noopener noreferrer"
                        // Quem sai por esta porta nao vira lead no banco: o
                        // `Contact` da Meta e o unico registro de que o anuncio
                        // trouxe uma conversa. Com o evento da URL, ele vai
                        // junto, como no `Lead`.
                        // Com cópia pelo servidor: quem só chama no WhatsApp
                        // nunca chega às rotas do lead, que mandam as outras.
                        onClick={() =>
                          rastrearComCopia(
                            "track",
                            EVENTO.contato,
                            {
                              ...(categoriaInicial && { content_category: categoriaInicial }),
                              canal: "whatsapp",
                            },
                            { urgente: true },
                          )
                        }
                        className={cn(
                          PORTA,
                          "border border-foreground/25 bg-card hover:border-foreground",
                        )}
                      >
                        <MessageCircle className="size-7" strokeWidth={1.75} aria-hidden="true" />
                        <span className="flex flex-col gap-1">
                          <span className="text-base leading-tight font-bold sm:text-lg">
                            {arvore.boas_vindas.cta_whatsapp.rotulo}
                          </span>
                          <span className="text-xs leading-snug text-muted-foreground">
                            {arvore.boas_vindas.cta_whatsapp.detalhe}
                          </span>
                        </span>
                      </a>
                    )}

                    <button
                      type="button"
                      // Enquanto a retomada esta em voo, entrar aqui criaria um
                      // lead novo por cima de um que ja existe.
                      disabled={retomando || falhaRetomada}
                      onClick={() => {
                        // Com o evento da URL, direto para o fluxo dele (cai na
                        // pergunta do WhatsApp; o lead continua nascendo so no
                        // primeiro avanco). A segunda condicao e cinto de
                        // seguranca: um lead de OUTRA categoria ja em memoria
                        // nunca e trocado por esta porta -- vai para a tela de
                        // categoria, onde a troca e escolha explicita.
                        if (categoriaInicial && (!categoria || categoria === categoriaInicial)) {
                          escolherCategoria(categoriaInicial, true);
                          return;
                        }
                        setDirecao(1);
                        setTela("categoria");
                      }}
                      className={cn(
                        PORTA,
                        "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60",
                        // Sem MEL_WHATSAPP configurado nao ha porta da esquerda:
                        // um link wa.me sem numero abriria o seletor de conversas
                        // do proprio lead, que nao leva a lugar nenhum.
                        !temWhatsapp && "col-span-2",
                      )}
                    >
                      {retomando ? (
                        <Loader2 className="size-7 animate-spin" />
                      ) : (
                        <Sparkles className="size-7" strokeWidth={1.75} aria-hidden="true" />
                      )}
                      <span className="flex flex-col gap-1">
                        <span className="text-base leading-tight font-bold sm:text-lg">
                          {arvore.boas_vindas.cta_formulario.rotulo}
                        </span>
                        <span className="text-xs leading-snug text-primary-foreground/70">
                          {arvore.boas_vindas.cta_formulario.detalhe}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {tela === "categoria" && (
                <div className="flex flex-col gap-7">
                  <h2 className="text-2xl leading-snug font-normal text-balance md:text-3xl">
                    {arvore.categoria.pergunta}
                  </h2>
                  <div className="flex w-full max-w-md flex-col gap-2.5">
                    {normalizarOpcoes(arvore.categoria.opcoes).map((opcao, i) => (
                      <OpcaoEscolha
                        key={opcao.valor}
                        letra={String.fromCharCode(65 + i)}
                        rotulo={opcao.rotulo}
                        // Em /orcamento esta e a PRIMEIRA tela, e a retomada
                        // pode estar em voo: a mesma trava da porta "Quero um
                        // orcamento", pelo mesmo motivo.
                        disabled={ocupado || retomando || falhaRetomada}
                        onClick={() => escolherCategoria(opcao.valor)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {tela === "pergunta" && passo && (
                // items-baseline alinha o numero com a PRIMEIRA linha da
                // pergunta em qualquer tamanho de fonte -- e o layout do
                // Typeform: "3 ->" a esquerda, conteudo indentado a direita.
                <div className="flex items-baseline gap-2.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium tabular-nums"
                  >
                    {marcador.atual}
                    <ArrowRight className="size-3.5 translate-y-px" />
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-7">
                    <h2 className="text-2xl leading-snug font-normal text-balance md:text-3xl">
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
                      <div className="flex items-center gap-3">
                        <Button
                          size="lg"
                          disabled={ocupado}
                          onClick={() => avancar()}
                          className="h-11 px-6 text-base font-bold"
                        >
                          {ocupado && <Loader2 className="size-4 animate-spin" />}
                          {proximoPasso(categoria!, respostas, passo.id) ? "OK" : "Enviar"}
                          <Check className="size-4" strokeWidth={3.5} />
                        </Button>
                        {/* So onde ha teclado fisico; no toque a dica nao significa nada. */}
                        <span className="hidden text-sm text-muted-foreground md:inline">
                          pressione <span className="font-semibold text-foreground">Enter</span> ↵
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tela === "confirmacao" && (
                <div className="flex flex-col gap-6 text-center">
                  <h1 className="text-4xl leading-tight font-semibold text-balance">
                    {arvore.confirmacao.titulo}
                  </h1>
                  {/* text-balance, nao text-pretty: distribui as linhas por igual e
                      evita a ultima linha com uma palavra sozinha. */}
                  <p className="text-lg text-balance text-muted-foreground">
                    {arvore.confirmacao.texto}
                  </p>
                  <a
                    href={`https://wa.me/${whatsappMel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ size: "lg" }), "mt-2 h-12 self-center px-8 text-lg font-bold")}
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

        {tela === "pergunta" && (
          <nav
            aria-label="Navegar entre as perguntas"
            className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex"
          >
            {/* Raio por lado em vez de overflow-hidden no pai: overflow-hidden
                clipava o anel de foco dos botoes. size-11 = alvo de 44px. */}
            <button
              type="button"
              onClick={voltar}
              disabled={ocupado}
              aria-label="Pergunta anterior"
              className="flex size-11 items-center justify-center rounded-l-md bg-primary text-primary-foreground transition-opacity focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 active:opacity-70 disabled:opacity-40"
            >
              <ChevronUp className="size-5" />
            </button>
            <span aria-hidden="true" className="w-px bg-primary-foreground/30" />
            <button
              type="button"
              onClick={() => avancar()}
              disabled={ocupado || ehUltimoPasso}
              aria-label="Próxima pergunta"
              className="flex size-11 items-center justify-center rounded-r-md bg-primary text-primary-foreground transition-opacity focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 active:opacity-70 disabled:opacity-40"
            >
              <ChevronDown className="size-5" />
            </button>
          </nav>
        )}

        {falhaRetomada && (
          <Button variant="outline" onClick={() => window.location.reload()} className="mt-4 self-center">
            Carregar meu orçamento novamente
          </Button>
        )}
        {persistencia.falha && (
          <div role="alert" className="mt-4 flex flex-col items-center gap-2 text-center text-sm text-destructive">
            <p>{persistencia.falha.mensagem}</p>
            {permiteNovaTentativa(persistencia.falha) && (
              <Button variant="outline" disabled={ocupado} onClick={() => { void filaRef.current?.tentarNovamente(); }}>
                Tentar salvar novamente
              </Button>
            )}
            {persistencia.falha.tipo === "conflito" && (
              <>
                <p className="text-xs text-muted-foreground">Ao continuar com as respostas já salvas, você substitui o rascunho deste aparelho.</p>
                <Button variant="outline" disabled={ocupado} onClick={() => { void usarRespostasSalvas(); }}>
                  Continuar com as respostas salvas
                </Button>
              </>
            )}
            {persistencia.falha.tipo === "encerrado" && (
              <>
                <p className="text-xs text-muted-foreground">O formulário já foi enviado. Seu rascunho permanece aqui; ao continuar, você descarta esse rascunho e confirma as respostas já enviadas.</p>
                <Button variant="outline" disabled={ocupado} onClick={() => { void usarRespostasSalvas(); }}>
                  Descartar rascunho e ver confirmação
                </Button>
              </>
            )}
          </div>
        )}
        {offline && !erro && !persistencia.falha && (
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <WifiOff className="size-3.5" /> Não consegui conectar. Confira a conexão e tente novamente.
          </p>
        )}
        {tela === "pergunta" && persistencia.pendente && persistencia.salvoNoAparelho && (
          <p role="status" className="mt-3 text-center text-xs text-muted-foreground">
            {persistencia.enviando ? "Salvando suas respostas…" : "Rascunho salvo neste aparelho, aguardando envio."}
          </p>
        )}
        {tela === "pergunta" && (armazenamentoIndisponivel || (persistencia.pendente && !persistencia.salvoNoAparelho)) && (
          <p role="status" className="mt-3 text-center text-xs text-muted-foreground">
            Este navegador não permite guardar a retomada. Mantenha a página aberta até enviar suas respostas.
          </p>
        )}
      </div>
    </LazyMotion>
  );
}
