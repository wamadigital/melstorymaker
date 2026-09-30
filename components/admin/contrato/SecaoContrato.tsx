"use client";

// Secao "Contrato" do detalhe do lead: um cartao so, com os dados (quem
// assina, evento, servico, pagamento, observacoes), o texto gerado, o PDF e a
// assinatura eletronica.
//
// Estado e orquestracao moram aqui; os formularios sao componentes burros que
// recebem um pedaco dos dados e devolvem o pedaco alterado.
//
// Regras que atravessam a secao inteira:
// - Tudo que a Mel preenche fica LOCAL ate um clique explicito ("Salvar
//   rascunho" ou "Gerar texto do contrato"). Sair com alteracao nao salva
//   pede confirmacao: do navegador (recarregar, fechar, outro site) e nossa
//   nos links internos, que o App Router navega sem `beforeunload`.
// - Recado aparece junto do controle que o disparou, e rola ate ficar
//   visivel: no celular a secao tem milhares de pixels, e um "Texto salvo."
//   no topo do texto nao era visto por quem salvou a Cláusula 12.
// - Uma trava so (`acao`), como no DetalheLead: dois cliques nunca disparam
//   duas requisicoes, e a redacao com IA (1 a 3 minutos) nao pode ser pedida
//   duas vezes.
// - Erro nunca aparece cru: a rota ja responde texto humano, e o que nao vier
//   dela vira uma frase fixa aqui.
// - Nada de `Date.now()` na renderizacao: "hoje" chega do servidor
//   (`hojeISO`), senao servidor e navegador discordariam na virada do dia.

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Save, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PreviaProposta } from "@/components/admin/PreviaProposta";
import {
  contextoDoLead,
  dadosIniciais,
  ehEventoDeMenor,
  ROTULO_STATUS_CONTRATO,
} from "@/lib/contrato/regras";
import { escopoEfetivo, faltantes, totalContrato, type ContextoMontagem } from "@/lib/contrato/montar";
import { formatarInteiro } from "@/lib/contrato/extenso";
import {
  dadosContratoSchema,
  textoTravado,
  type DadosContrato,
  type DocumentoContrato,
  type RegistroContrato,
  type StatusContrato,
} from "@/lib/contrato/tipos";
import { validarDocumento } from "@/lib/contrato/validar";
import type { Lead, Status } from "@/lib/form/types";
import { TABELA_BASE } from "@/lib/pdf/precos";
import { dataHoraLocal } from "@/lib/pdf/formatadores";
import { cn } from "@/lib/utils";
import {
  Bloco,
  Campo,
  CLASSE_LINK_BOTAO,
  Recado,
  type TomRecado,
} from "@/components/admin/contrato/campos-ui";
import { campoDoFaltante, ID, idClausula } from "@/components/admin/contrato/campos";
import {
  avisosParaExibir,
  bloqueioDoEnvio,
  chaveDoCronometro,
  chaveEstavel,
  dadosDoRegistro,
  linkSaiDaPagina,
  mesclarContratante,
  recadoDoCancelamento,
  recolhimentoDoFormulario,
  textoDaConsultaQueFalhou,
  textoDesatualizado,
} from "@/components/admin/contrato/estado";
import { FormQuemAssina } from "@/components/admin/contrato/FormQuemAssina";
import { FormEvento } from "@/components/admin/contrato/FormEvento";
import { FormServico } from "@/components/admin/contrato/FormServico";
import { FormPagamento } from "@/components/admin/contrato/FormPagamento";
import { ListaAvisos } from "@/components/admin/contrato/ListaAvisos";
import { EditorClausulas } from "@/components/admin/contrato/EditorClausulas";
import { PainelAssinatura } from "@/components/admin/contrato/PainelAssinatura";

/** Limite das observacoes (schema). */
const MAXIMO_OBSERVACOES = 6000;

/** Badge do status do contrato. Ambar = a Mel tem o que fazer; ceu = esperando os outros; verde = fechado. */
const CLASSE_STATUS_CONTRATO: Record<StatusContrato, string> = {
  rascunho: "bg-slate-100 text-slate-700 border-slate-200",
  redigido: "bg-amber-100 text-amber-900 border-amber-200",
  pdf_gerado: "bg-amber-100 text-amber-900 border-amber-200",
  enviado: "bg-sky-100 text-sky-900 border-sky-200",
  assinado: "bg-emerald-100 text-emerald-900 border-emerald-200",
};

export type PropsSecaoContrato = {
  lead: Lead;
  /** A linha de `contratos`, ou null se o contrato deste lead ainda nao foi salvo. */
  registro: RegistroContrato | null;
  /** "Hoje" em America/Sao_Paulo, calculado NO SERVIDOR. */
  hojeISO: string;
  iaDisponivel: boolean;
  assinaturaConfigurada: boolean;
  assinaturaDryRun: boolean;
  /**
   * A leitura do registro falhou no servidor. A secao NAO abre o formulario
   * pre-preenchido nesse caso: um "Salvar rascunho" ali sobrescreveria o
   * contrato que ja existe com os dados do formulario do lead.
   */
  falhaAoCarregar?: boolean;
  /** Status do lead no quadro (para o "Mover lead para Virou cliente"). */
  statusLead: Status;
  onStatusLead?: (s: Status) => void;
  /** O DetalheLead usa para a confirmacao do "Excluir lead". */
  onStatusContrato?: (s: StatusContrato | null) => void;
  /** Alguma acao do contrato em andamento: o DetalheLead trava o "Excluir lead". */
  onOcupado?: (ocupado: boolean) => void;
};

type Acao =
  | "salvar"
  | "extrair"
  | "redigir"
  | "revisar"
  | "documento"
  | "pdf"
  | "enviar"
  | "consultar"
  | "cancelar"
  | "mover";

type Lugar = "quem" | "dados" | "texto" | "pdf" | "assinatura";

/** `clausula`: o recado e daquela clausula do texto (salvar, remover), e aparece nela. */
type RecadoSecao = { lugar: Lugar; clausula?: string; tom: TomRecado; texto: string; lista?: string[] };

/** `pedidoInexistente`: o envio sumiu da plataforma (ou o token nao se le), e a saida e o "Cancelar envio". */
type Falha = { ok: false; status: number; erro: string; campos?: string[]; pedidoInexistente?: boolean };
type RespostaApi<T> = { ok: true; json: T } | Falha;

// ------------------------------------------------------------------ fetch --

function erroPadrao(status: number): string {
  if (status === 404) return "Não encontrei este lead. Ele pode ter sido excluído.";
  if (status === 409) return "O contrato mudou de estado (talvez em outra aba). Atualizei a tela.";
  if (status === 413) return "O conteúdo ficou grande demais para salvar.";
  if (status === 429) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  if (status === 503) return "Esse recurso não está configurado neste ambiente.";
  if (status === 504) return "O servidor demorou demais para responder. Tente de novo em instantes.";
  return "Algo deu errado do lado do servidor. Tente de novo em instantes.";
}

/**
 * Uma chamada a API do contrato. Nunca lanca: devolve o JSON ou uma falha com
 * texto humano (o `erro` da rota quando ela manda um, senao uma frase fixa).
 */
async function chamar<T>(url: string, metodo = "GET", corpo?: unknown): Promise<RespostaApi<T>> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: metodo,
      cache: "no-store",
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      erro: "Não consegui falar com o servidor. Confira a internet e tente de novo.",
    };
  }

  const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.ok && json) return { ok: true, json: json as T };

  if (r.status === 401) {
    return {
      ok: false,
      status: 401,
      erro: "Sua sessão expirou. Entre de novo no painel em outra aba e volte aqui: o que está nesta tela não se perde.",
    };
  }
  const erro = typeof json?.erro === "string" && json.erro.trim() ? json.erro : erroPadrao(r.status);
  const campos = Array.isArray(json?.campos)
    ? (json.campos as unknown[]).filter((c): c is string => typeof c === "string")
    : undefined;
  const pedidoInexistente = json?.pedidoInexistente === true ? true : undefined;
  return { ok: false, status: r.ok ? 500 : r.status, erro, campos, pedidoInexistente };
}

// ------------------------------------------------------------- utilidades --

function plural(n: number, um: string, varios: string): string {
  return `${formatarInteiro(n)} ${n === 1 ? um : varios}`;
}

/** "45s", "1min 05s". */
function tempoDecorrido(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  return `${Math.floor(segundos / 60)}min ${String(segundos % 60).padStart(2, "0")}s`;
}

/**
 * Segundos desde que a `chave` apareceu ou MUDOU (`chaveDoCronometro`): a
 * revisao comeca do zero, e nao do tempo que a redacao ja tinha gasto. O zero
 * e ajustado durante a renderizacao, para nem um quadro mostrar o tempo velho.
 * Relogio so no navegador, dentro de efeito.
 */
function useCronometro(chave: string | null): number {
  const [estado, setEstado] = useState({ chave, segundos: 0 });
  if (estado.chave !== chave) setEstado({ chave, segundos: 0 });
  useEffect(() => {
    if (chave === null) return;
    const t = window.setInterval(() => setEstado((e) => ({ ...e, segundos: e.segundos + 1 })), 1000);
    return () => window.clearInterval(t);
  }, [chave]);
  return chave !== null && estado.chave === chave ? estado.segundos : 0;
}

/**
 * Rola ate o campo (ou o bloco), abrindo o <details> que o esconde, e poe o
 * foco nele. Campo vai para o meio da tela; bloco inteiro, para o topo -- o
 * meio de um bloco alto deixaria o titulo dele acima da tela.
 */
function irPara(id: string, onde: "center" | "start" = "center") {
  const el = document.getElementById(id);
  if (!el) return;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  el.scrollIntoView({ behavior: "smooth", block: onde });
  el.focus({ preventScroll: true });
}

/** Texto do confirm dos links internos com algo por salvar. */
const CONFIRMA_SAIR =
  "Há alterações no contrato que ainda não foram salvas (ou uma ação em andamento). Sair desta página e perdê-las?";

/**
 * O recado da secao, que rola ate ficar visivel quando aparece. Componente de
 * modulo (tipo estavel): so rola quando o RECADO muda, nao a cada renderizacao
 * -- o cronometro renderiza a secao a cada segundo.
 */
function RecadoVisivel({ recado }: { recado: RecadoSecao }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [recado]);
  return (
    <div ref={ref} className="scroll-my-6">
      <Recado tom={recado.tom}>
        <p>{recado.texto}</p>
        {recado.lista && (
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {recado.lista.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </Recado>
    </div>
  );
}

function dadosDoInicio(registro: RegistroContrato | null, lead: Lead, hojeISO: string): DadosContrato {
  const salvos = registro ? dadosDoRegistro(registro.dados) : null;
  if (salvos) return salvos;
  try {
    return dadosIniciais(lead, hojeISO);
  } catch (e) {
    // Resposta do lead fora do previsto nao pode derrubar o detalhe inteiro:
    // abre em branco e a Mel preenche.
    console.error("[contrato] falha no pre-preenchimento", (e as Error).name);
    return dadosContratoSchema.parse({ servico: { tabela: TABELA_BASE } });
  }
}

// ----------------------------------------------------------------- secao --

export function SecaoContrato(props: PropsSecaoContrato) {
  if (props.falhaAoCarregar) {
    return (
      <section aria-labelledby="ct-titulo" className="space-y-4 rounded-lg border bg-card p-5">
        <h2 id="ct-titulo" className="font-medium">
          Contrato
        </h2>
        <Recado tom="erro">
          Não consegui carregar o contrato deste lead agora. Recarregue a página em instantes: nada do que já
          foi salvo se perdeu.
        </Recado>
      </section>
    );
  }
  return <SecaoCarregada {...props} />;
}

function SecaoCarregada({
  lead,
  registro: registroInicial,
  hojeISO,
  iaDisponivel,
  assinaturaConfigurada,
  assinaturaDryRun,
  statusLead,
  onStatusLead,
  onStatusContrato,
  onOcupado,
}: PropsSecaoContrato) {
  const router = useRouter();
  const base = `/api/admin/leads/${lead.id}/contrato`;

  const [registro, setRegistro] = useState<RegistroContrato | null>(registroInicial);
  const [inicio] = useState(() => dadosDoInicio(registroInicial, lead, hojeISO));
  const [dados, setDados] = useState<DadosContrato>(inicio);
  // O que o servidor tem salvo, para saber se ha alteracao pendente. Sem
  // registro, o pre-preenchimento conta como "salvo": so mexer nele e alteracao.
  const [salvoChave, setSalvoChave] = useState(() => chaveEstavel(inicio));

  const [acao, setAcao] = useState<Acao | null>(null);
  const acaoRef = useRef<Acao | null>(null);
  const [recado, setRecado] = useState<RecadoSecao | null>(null);
  const [progresso, setProgresso] = useState<{ lugar: Lugar; texto: string } | null>(null);
  const [faltando, setFaltando] = useState<string[] | null>(null);
  const [forcarValidacao, setForcarValidacao] = useState(false);
  const [observacoesExtracao, setObservacoesExtracao] = useState<string[]>([]);
  const [editandoClausula, setEditandoClausula] = useState(false);
  // O <details> dos dados (PDF gerado ou texto travado) aberto pela Mel.
  const [dadosAbertos, setDadosAbertos] = useState(false);

  // Os dados mais recentes, para uma resposta que chega depois saber se a Mel
  // continuou digitando enquanto ela viajava.
  const dadosRef = useRef(dados);
  useEffect(() => {
    dadosRef.current = dados;
  }, [dados]);

  // ------------------------------------------------------------ derivados
  const { ctxLead, ctx } = useMemo(() => {
    const c = contextoDoLead(lead, hojeISO);
    const montagem: ContextoMontagem | null = c.templateId ? { ...c, templateId: c.templateId } : null;
    return { ctxLead: c, ctx: montagem };
  }, [lead, hojeISO]);

  // As comparacoes pesadas (remontar o contrato) andam um passo atras da
  // digitacao: a tela nao engasga a cada tecla.
  const dadosAdiados = useDeferredValue(dados);

  const documento = registro?.documento ?? null;
  const travado = registro ? textoTravado(registro.status) : false;
  const sujo = useMemo(() => chaveEstavel(dados) !== salvoChave, [dados, salvoChave]);
  const desatualizado = useMemo(
    () => !travado && textoDesatualizado(documento, dadosAdiados, ctx),
    [travado, documento, dadosAdiados, ctx],
  );
  const problemasDocumento = useMemo(() => (documento ? validarDocumento(documento) : []), [documento]);
  const avisos = useMemo(
    () =>
      avisosParaExibir({
        documento,
        avisosSalvos: registro?.avisos ?? [],
        dados: dadosAdiados,
        ctx,
        desatualizado,
      }),
    [documento, registro?.avisos, dadosAdiados, ctx, desatualizado],
  );
  const listaFaltantes = useMemo(() => {
    if (!faltando) return null;
    // Com a arte conhecida, a lista e recalculada ao vivo: cada item some
    // quando a Mel o resolve. Sem arte, vale a do servidor.
    return ctx ? faltantes(dadosAdiados, ctx) : faltando;
  }, [faltando, ctx, dadosAdiados]);

  const menor = ehEventoDeMenor(lead.categoria, ctxLead.idadeHomenageado);
  const escopo = escopoEfetivo(dados.servico, ctxLead.templateId ?? undefined);
  const temMakingOf = escopo.minutosMakingOf > 0;
  const temEnsaio = escopo.minutosEnsaio > 0;
  const total = totalContrato(dados.servico);
  const formularioTravado = travado || acao === "extrair" || acao === "redigir" || acao === "revisar";
  const cronometro = useCronometro(chaveDoCronometro(progresso));

  // ------------------------------------------------------------- efeitos
  const statusContrato = registro?.status ?? null;
  useEffect(() => {
    onStatusContrato?.(statusContrato);
  }, [statusContrato, onStatusContrato]);

  useEffect(() => {
    onOcupado?.(acao !== null);
  }, [acao, onOcupado]);

  // Sair da pagina com alteracao nao salva (ou com uma acao no meio) pede
  // confirmacao. Recarregar, fechar e ir para outro site: `beforeunload`, e so
  // o navegador mostra o texto. Link INTERNO ("Voltar para a lista", o logo):
  // o App Router troca de pagina sem `beforeunload`, entao o clique e pego na
  // fase de captura, antes do onClick do <Link>, e o confirm e nosso.
  // Os dois saem quando nao ha mais o que perder (salvou) ou a secao sai.
  const precisaAvisar = sujo || editandoClausula || acao !== null;
  useEffect(() => {
    if (!precisaAvisar) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const aoClicar = (e: MouseEvent) => {
      if (e.defaultPrevented || !(e.target instanceof Element)) return;
      const a = e.target.closest("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      const sai = linkSaiDaPagina({
        href: a.getAttribute("href"),
        target: a.getAttribute("target"),
        download: a.hasAttribute("download"),
        atual: window.location.href,
        botao: e.button,
        modificador: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
      });
      if (!sai || window.confirm(CONFIRMA_SAIR)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", avisar);
    document.addEventListener("click", aoClicar, true);
    return () => {
      window.removeEventListener("beforeunload", avisar);
      document.removeEventListener("click", aoClicar, true);
    };
  }, [precisaAvisar]);

  // ------------------------------------------------------------ registro
  const aplicarRegistro = useCallback((reg: RegistroContrato, enviados?: DadosContrato) => {
    // Resposta sem registro (rota fora do contrato) nao pode derrubar a tela:
    // fica o que estava, e a proxima leitura acerta.
    if (!reg || typeof reg !== "object" || typeof reg.status !== "string") return;
    setRegistro(reg);
    const salvos = dadosDoRegistro(reg.dados);
    if (!salvos) return;
    setSalvoChave(chaveEstavel(salvos));
    // Troca os dados da tela pelos do servidor (normalizados: aparados, e-mail
    // minusculo) SO se a Mel nao mexeu em nada enquanto a resposta viajava.
    if (enviados && chaveEstavel(enviados) === chaveEstavel(dadosRef.current)) setDados(salvos);
  }, []);

  const recarregar = useCallback(
    async (enviados?: DadosContrato) => {
      const r = await chamar<{ registro: RegistroContrato | null }>(base);
      if (r.ok && r.json.registro) aplicarRegistro(r.json.registro, enviados);
    },
    [base, aplicarRegistro],
  );

  function falhou(lugar: Lugar, r: Falha, clausula?: string) {
    setRecado({
      lugar,
      clausula,
      tom: r.status === 409 || r.status === 422 || r.status === 503 ? "atencao" : "erro",
      texto: r.erro,
      lista: r.campos?.length ? r.campos : undefined,
    });
    if (r.status === 409) void recarregar();
  }

  /** Trava unica: uma acao por vez, com o ref barrando o duplo clique antes do re-render. */
  async function executar(qual: Acao, lugar: Lugar, fn: () => Promise<void>) {
    if (acaoRef.current) return;
    acaoRef.current = qual;
    setAcao(qual);
    setRecado(null);
    try {
      await fn();
    } catch (e) {
      console.error("[contrato] falha inesperada na tela", qual, (e as Error).name);
      setRecado({
        lugar,
        tom: "erro",
        texto: "Algo deu errado aqui na tela. Recarregue a página e tente de novo.",
      });
    } finally {
      acaoRef.current = null;
      setAcao(null);
      setProgresso(null);
    }
  }

  function trocarAcao(qual: Acao) {
    acaoRef.current = qual;
    setAcao(qual);
  }

  // ---------------------------------------------------------------- acoes
  function salvarRascunho() {
    void executar("salvar", "dados", async () => {
      const enviados = dados;
      const r = await chamar<{ registro: RegistroContrato }>(base, "PUT", { dados: enviados });
      if (!r.ok) return falhou("dados", r);
      aplicarRegistro(r.json.registro, enviados);
      setRecado({ lugar: "dados", tom: "ok", texto: "Rascunho salvo." });
    });
  }

  async function extrair(texto: string): Promise<boolean> {
    let preencheu = false;
    await executar("extrair", "quem", async () => {
      setObservacoesExtracao([]);
      setProgresso({ lugar: "quem", texto: "Lendo os dados com IA…" });
      const r = await chamar<{ contratante: unknown; observacoes: unknown }>(`${base}/extrair`, "POST", {
        texto,
      });
      if (!r.ok) return falhou("quem", r);

      const { contratante, preenchidos } = mesclarContratante(
        dadosRef.current.contratante,
        r.json.contratante,
      );
      setDados((d) => ({ ...d, contratante }));
      const obs = Array.isArray(r.json.observacoes)
        ? (r.json.observacoes as unknown[]).filter(
            (o): o is string => typeof o === "string" && o.trim() !== "",
          )
        : [];
      setObservacoesExtracao(obs);
      setForcarValidacao(true);
      preencheu = preenchidos > 0;
      setRecado(
        preencheu
          ? {
              lugar: "quem",
              tom: "ok",
              texto: `Preenchi ${plural(preenchidos, "campo", "campos")} com o que encontrei no texto. Confira tudo, escolha o tratamento (Sr. ou Sra.) e salve.`,
            }
          : {
              lugar: "quem",
              tom: "atencao",
              texto: "Não encontrei dados para o contrato nesse texto. Confira se colou a mensagem certa.",
            },
      );
    });
    return preencheu;
  }

  function gerarTexto() {
    // Refazer o texto descarta o que foi mexido nele: pergunta antes.
    if (documento) {
      const editadas = documento.clausulas.filter((c) => c.origem === "editada");
      const partes = ["O texto é refeito a partir dos dados."];
      if (editadas.length > 0) {
        partes.push(
          `As cláusulas que você editou à mão (${editadas.map((c) => c.titulo).join("; ")}) voltam ao texto montado pelo sistema.`,
        );
      }
      if (registro?.status === "pdf_gerado") partes.push("O PDF gerado deixa de valer até você gerar outro.");
      if (!window.confirm(`Gerar o texto do contrato de novo?\n\n${partes.join("\n\n")}`)) return;
    }

    void executar("redigir", "dados", async () => {
      setFaltando(null);
      const comIa = iaDisponivel && dados.observacoes.trim() !== "";
      setProgresso({
        lugar: "dados",
        texto: comIa
          ? "Escrevendo o contrato com IA… isso pode levar até 3 minutos. Não feche esta página."
          : "Montando o texto do contrato…",
      });

      const enviados = dados;
      const r = await chamar<{ registro: RegistroContrato }>(`${base}/redigir`, "POST", { dados: enviados });
      if (!r.ok) {
        if (r.status === 422 && r.campos?.length) {
          setFaltando(r.campos);
          setForcarValidacao(true);
          // A rota salva os dados antes de conferir o que falta: sincroniza.
          void recarregar(enviados);
          window.setTimeout(() => irPara(ID.faltantes), 50);
          return;
        }
        return falhou("dados", r);
      }
      aplicarRegistro(r.json.registro, enviados);

      let final: RecadoSecao = {
        lugar: "texto",
        tom: "ok",
        texto: "Texto do contrato pronto. Confira abaixo, cláusula por cláusula.",
      };
      if (iaDisponivel) {
        trocarAcao("revisar");
        setProgresso({ lugar: "dados", texto: "Revisando com IA… isso pode levar até 3 minutos." });
        const rv = await chamar<{ registro: RegistroContrato }>(`${base}/revisar`, "POST");
        if (rv.ok) {
          aplicarRegistro(rv.json.registro);
          final = {
            lugar: "texto",
            tom: "ok",
            texto: "Texto pronto e revisado pela IA. Confira os pontos para conferir e o texto abaixo.",
          };
        } else {
          final = {
            lugar: "texto",
            tom: "atencao",
            texto: `O texto ficou pronto, mas a revisão da IA não terminou: ${rv.erro} Use “Revisar de novo com IA” quando quiser.`,
          };
        }
      }
      setRecado(final);
      window.setTimeout(() => irPara(ID.texto), 50);
    });
  }

  function revisar() {
    void executar("revisar", "texto", async () => {
      setProgresso({ lugar: "texto", texto: "Revisando com IA… isso pode levar até 3 minutos." });
      const r = await chamar<{ registro: RegistroContrato }>(`${base}/revisar`, "POST");
      if (!r.ok) return falhou("texto", r);
      aplicarRegistro(r.json.registro);
      const n = (r.json.registro?.avisos ?? []).filter((a) => a.origem === "ia").length;
      setRecado({
        lugar: "texto",
        tom: "ok",
        texto: n
          ? `Revisão concluída: ${plural(n, "ponto", "pontos")} da IA para conferir.`
          : "Revisão concluída: a IA não encontrou nada a apontar.",
      });
    });
  }

  /** `clausula`: onde o recado aparece (a que foi salva, ou a vizinha da removida). */
  async function salvarDocumento(doc: DocumentoContrato, clausula: string | null): Promise<boolean> {
    let salvou = false;
    const tinhaPdf = registro?.status === "pdf_gerado";
    const alvo = clausula ?? undefined;
    await executar("documento", "texto", async () => {
      const r = await chamar<{ registro: RegistroContrato }>(`${base}/documento`, "PUT", { documento: doc });
      if (!r.ok) return falhou("texto", r, alvo);
      aplicarRegistro(r.json.registro);
      salvou = true;
      setRecado({
        lugar: "texto",
        clausula: alvo,
        tom: "ok",
        texto: tinhaPdf ? "Texto salvo. Gere o PDF de novo para ele entrar no arquivo." : "Texto salvo.",
      });
    });
    return salvou;
  }

  function gerarPdf() {
    void executar("pdf", "pdf", async () => {
      const r = await chamar<{ registro: RegistroContrato; paginas: number; usouFallbackDeFonte: boolean }>(
        `${base}/pdf`,
        "POST",
      );
      if (!r.ok) return falhou("pdf", r);
      aplicarRegistro(r.json.registro);
      const paginas =
        typeof r.json.paginas === "number" ? ` (${plural(r.json.paginas, "página", "páginas")})` : "";
      setRecado(
        r.json.usouFallbackDeFonte
          ? {
              lugar: "pdf",
              tom: "atencao",
              texto: `PDF gerado${paginas}, mas com a fonte reserva: as fontes da marca não foram encontradas no servidor.`,
            }
          : { lugar: "pdf", tom: "ok", texto: `PDF gerado${paginas}. Confira a prévia antes de enviar.` },
      );
    });
  }

  async function enviarAssinatura(): Promise<boolean> {
    let enviou = false;
    await executar("enviar", "assinatura", async () => {
      const r = await chamar<{ registro: RegistroContrato; dryRun?: boolean }>(`${base}/assinatura`, "POST");
      if (!r.ok) return falhou("assinatura", r);
      aplicarRegistro(r.json.registro);
      enviou = true;
      // Em dry run o proprio painel ja mostra "Envio de teste": um segundo
      // aviso ambar dizendo o mesmo com outras palavras so empilhava recados.
      if (!r.json.dryRun) {
        setRecado({
          lugar: "assinatura",
          tom: "ok",
          texto: "Contrato enviado para assinatura. Cada pessoa recebe o link por e-mail.",
        });
      }
    });
    return enviou;
  }

  function consultarAssinatura(silencioso: boolean) {
    return executar("consultar", "assinatura", async () => {
      const r = await chamar<{ registro: RegistroContrato }>(`${base}/assinatura`);
      if (!r.ok) {
        setRecado({
          lugar: "assinatura",
          tom: "atencao",
          texto: textoDaConsultaQueFalhou({ silencioso, erro: r.erro, pedidoInexistente: r.pedidoInexistente }),
        });
        return;
      }
      const novo = r.json.registro;
      aplicarRegistro(novo);
      if (!novo) return;
      if (novo.status === "assinado") {
        setRecado({
          lugar: "assinatura",
          tom: "ok",
          texto: "Todos assinaram! O contrato assinado foi guardado.",
        });
      } else if (
        novo.status === "pdf_gerado" &&
        novo.assinatura_status &&
        novo.assinatura_status !== "enviado"
      ) {
        // O motivo (e o que fazer) o painel mostra logo acima, com o tom certo
        // para cada um: aqui so o que mudou.
        setRecado({
          lugar: "assinatura",
          tom: "info",
          texto: "Status atualizado: o envio não está mais aguardando assinaturas, e o texto foi destravado.",
        });
      } else if (!silencioso) {
        setRecado({ lugar: "assinatura", tom: "ok", texto: "Status atualizado." });
      }
    });
  }

  // Abrindo a pagina com o contrato na assinatura, confere o status uma vez
  // sozinho: a Mel entra para saber se assinaram, nao para clicar num botao.
  // A funcao vai por ref para o efeito rodar uma vez so, e nao a cada render.
  const consultarRef = useRef(consultarAssinatura);
  useEffect(() => {
    consultarRef.current = consultarAssinatura;
  });
  const conferiuRef = useRef(false);
  const statusInicial = registroInicial?.status;
  useEffect(() => {
    if (conferiuRef.current) return;
    conferiuRef.current = true;
    if (statusInicial === "enviado") void consultarRef.current(true);
  }, [statusInicial]);

  function cancelarAssinatura() {
    const certeza = window.confirm(
      "Cancelar o envio para assinatura?\n\nOs links que as pessoas receberam deixam de valer, e o texto é destravado para correção.",
    );
    if (!certeza) return;
    void executar("cancelar", "assinatura", async () => {
      const r = await chamar<{ registro: RegistroContrato; pedidoInexistente?: boolean; aviso?: string }>(
        `${base}/assinatura`,
        "DELETE",
      );
      if (!r.ok) return falhou("assinatura", r);
      aplicarRegistro(r.json.registro);
      setRecado({ lugar: "assinatura", ...recadoDoCancelamento(r.json) });
    });
  }

  function moverLead() {
    void executar("mover", "assinatura", async () => {
      const r = await chamar<{ ok: boolean; status: Status }>(`/api/admin/leads/${lead.id}/status`, "PATCH", {
        status: "virou_cliente",
        de: statusLead,
      });
      if (!r.ok) {
        setRecado({ lugar: "assinatura", tom: "atencao", texto: r.erro });
        if (r.status === 409) router.refresh();
        return;
      }
      onStatusLead?.("virou_cliente");
      toast.success("Lead movido para Virou cliente.");
      router.refresh();
    });
  }

  // ------------------------------------------------------------ pedacos
  const set = <K extends keyof DadosContrato>(chave: K, valor: DadosContrato[K]) =>
    setDados((d) => ({ ...d, [chave]: valor }));

  // Funcoes que devolvem JSX, e nao componentes: definidos aqui dentro, seriam
  // um TIPO novo a cada render (o cronometro renderiza a cada segundo), e o
  // leitor de tela reanunciaria o role="status" remontado.
  function recadoEm(lugar: Lugar) {
    if (!recado || recado.lugar !== lugar || recado.clausula) return null;
    return <RecadoVisivel recado={recado} />;
  }

  /** O recado que e DESTA clausula do texto (salvar, remover). */
  function recadoDaClausula(id: string) {
    if (!recado || recado.clausula !== id) return null;
    return <RecadoVisivel recado={recado} />;
  }

  function progressoEm(lugar: Lugar) {
    if (!progresso || progresso.lugar !== lugar) return null;
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border bg-muted p-3 text-sm">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
        <div className="min-w-0 space-y-0.5">
          <p>{progresso.texto}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{tempoDecorrido(cronometro)}</p>
        </div>
      </div>
    );
  }

  const clausulaIaComProblema = documento?.clausulas.find((c) => c.origem === "ia" && c.problemas.length > 0);
  const motivoSemPdf = !documento
    ? "Gere o texto do contrato primeiro."
    : editandoClausula
      ? "Salve ou cancele a cláusula que você está editando."
      : desatualizado
        ? "Os dados mudaram depois que o texto foi gerado. Gere o texto de novo antes do PDF."
        : problemasDocumento.length > 0
          ? "Corrija os problemas do texto (acima) antes do PDF."
          : clausulaIaComProblema
            ? `A cláusula “${clausulaIaComProblema.titulo}”, escrita pela IA, tem problemas: edite o texto para liberar o PDF.`
            : null;

  const temPdf =
    !!registro?.pdf_gerado_em &&
    (registro.status === "pdf_gerado" || registro.status === "enviado" || registro.status === "assinado");
  // Enviar ou cancelar troca o <details> de "editar" para "so ler" (e
  // vice-versa): comeca fechado de novo, como era antes de haver PDF.
  const [travadoAntes, setTravadoAntes] = useState(travado);
  if (travadoAntes !== travado) {
    setTravadoAntes(travado);
    setDadosAbertos(false);
  }
  const recolhimento = recolhimentoDoFormulario({
    travado,
    temPdf,
    sujo,
    pendencias: (listaFaltantes?.length ?? 0) > 0,
  });

  const urlArquivo = `${base}/arquivo`;
  const urlRascunho = `${urlArquivo}?tipo=rascunho&v=${encodeURIComponent(registro?.pdf_gerado_em ?? "")}`;
  const urlPrevia =
    registro?.status === "assinado"
      ? `${urlArquivo}?tipo=assinado&v=${encodeURIComponent(registro.assinado_em ?? "")}`
      : urlRascunho;

  const tituloDaClausula = (id: string) => {
    const i = documento ? documento.clausulas.findIndex((c) => c.id === id) : -1;
    return i >= 0 ? `a Cláusula ${i + 1}` : null;
  };

  // ------------------------------------------------------------- formulario
  const formulario = (
    <fieldset disabled={formularioTravado} className="min-w-0 space-y-5">
      <legend className="sr-only">Dados do contrato</legend>

      <Bloco id={ID.blocoQuem} titulo="Quem assina">
        <FormQuemAssina
          categoria={lead.categoria}
          homenageado={dados.evento.homenageado}
          menor={menor}
          contratante={dados.contratante}
          onContratante={(c) => set("contratante", c)}
          anuente={dados.anuente}
          onAnuente={(a) => set("anuente", a)}
          iaDisponivel={iaDisponivel}
          extraindo={acao === "extrair"}
          ocupado={acao !== null}
          onExtrair={extrair}
          observacoesExtracao={observacoesExtracao}
          forcarValidacao={forcarValidacao}
          retornoExtracao={
            <>
              {progressoEm("quem")}
              {recadoEm("quem")}
            </>
          }
        />
      </Bloco>

      <Bloco id={ID.blocoEvento} titulo="Evento">
        <FormEvento
          categoria={lead.categoria}
          evento={dados.evento}
          onEvento={(e) => set("evento", e)}
          temMakingOf={temMakingOf}
          temEnsaio={temEnsaio}
          hojeISO={hojeISO}
        />
      </Bloco>

      <Bloco id={ID.blocoServico} titulo="Serviço">
        <FormServico
          templateId={ctxLead.templateId}
          servico={dados.servico}
          onServico={(s) => set("servico", s)}
          dataEvento={dados.evento.data}
        />
      </Bloco>

      <Bloco id={ID.blocoPagamento} titulo="Pagamento">
        <FormPagamento
          pagamento={dados.pagamento}
          onPagamento={(p) => set("pagamento", p)}
          total={total}
          dataEvento={dados.evento.data}
          hojeISO={hojeISO}
        />
      </Bloco>

      <Bloco titulo="Observações">
        <Campo
          id={ID.observacoes}
          rotulo="Observações para o contrato"
          dica={
            iaDisponivel
              ? "A IA transforma isto numa cláusula no estilo dos seus contratos. Mudou as observações depois de gerar o texto? Gere o texto de novo para a cláusula acompanhar."
              : "A IA não está configurada neste ambiente: as observações ficam salvas, mas não viram cláusula sozinhas. Você pode escrever a cláusula no texto do contrato."
          }
        >
          <Textarea
            id={ID.observacoes}
            value={dados.observacoes}
            onChange={(e) => set("observacoes", e.target.value.slice(0, MAXIMO_OBSERVACOES))}
            placeholder="Condições especiais, pedidos do cliente, forma de pagamento diferente, local diferente…"
            aria-describedby={`${ID.observacoes}-dica`}
            className="min-h-36"
          />
        </Campo>
        <p className="text-right text-xs tabular-nums text-muted-foreground">
          {formatarInteiro(dados.observacoes.length)}/{formatarInteiro(MAXIMO_OBSERVACOES)}
        </p>
      </Bloco>
    </fieldset>
  );

  return (
    <section id={ID.secao} aria-labelledby="ct-titulo" className="space-y-5 rounded-lg border bg-card p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="ct-titulo" className="font-medium">
          Contrato
        </h2>
        {registro ? (
          <span
            className={cn(
              "rounded-md border px-2.5 py-0.5 text-xs font-medium",
              CLASSE_STATUS_CONTRATO[registro.status],
            )}
          >
            {ROTULO_STATUS_CONTRATO[registro.status]}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">ainda não salvo</span>
        )}
      </header>

      {travado && (
        <Recado tom="info">
          {registro?.status === "assinado"
            ? "Contrato assinado: o texto e os dados não mudam mais."
            : "O texto está travado enquanto o contrato estiver na assinatura."}
        </Recado>
      )}

      {recolhimento.recolhido ? (
        // Um <details> so para travado e PDF gerado: enviar e cancelar trocam
        // o resumo sem remontar o formulario. `open` so empurra para ABRIR
        // (alteracao nao salva, pendencia); fechar e sempre a Mel.
        <details
          className="group rounded-lg border"
          open={recolhimento.abrir || dadosAbertos}
          onToggle={(e) => setDadosAbertos(e.currentTarget.open)}
        >
          <summary className="px-3 py-2.5 text-sm font-medium">{recolhimento.resumo}</summary>
          <div className="border-t p-3">{formulario}</div>
        </details>
      ) : (
        formulario
      )}

      {/* ------------------------------------------------------ salvar e gerar */}
      {!travado && (
        <div className="space-y-3 border-t pt-5">
          {listaFaltantes && (
            <div
              id={ID.faltantes}
              tabIndex={-1}
              role="status"
              className="scroll-mt-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 outline-none"
            >
              {listaFaltantes.length > 0 ? (
                <>
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 font-medium">
                      Faltam alguns dados para gerar o contrato. Toque em cada item para ir até o campo:
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Fechar a lista"
                      onClick={() => setFaltando(null)}
                    >
                      <X />
                    </Button>
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {listaFaltantes.map((f) => {
                      const alvo = campoDoFaltante(f, dados);
                      return (
                        <li key={f}>
                          {alvo ? (
                            <button
                              type="button"
                              onClick={() => irPara(alvo)}
                              className="text-left underline underline-offset-2 hover:text-amber-950"
                            >
                              {f}
                            </button>
                          ) : (
                            f
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p>Tudo preenchido. Agora é só tocar em “Gerar texto do contrato”.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={salvarRascunho}
              disabled={acao !== null || (!!registro && !sujo)}
            >
              {acao === "salvar" ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar rascunho
            </Button>
            <Button type="button" size="lg" onClick={gerarTexto} disabled={acao !== null || editandoClausula}>
              {acao === "redigir" || acao === "revisar" ? <Loader2 className="animate-spin" /> : <FileText />}
              {documento ? "Gerar o texto de novo" : "Gerar texto do contrato"}
            </Button>
            <span className={cn("text-xs", sujo ? "text-amber-800" : "text-muted-foreground")}>
              {sujo
                ? "Alterações não salvas"
                : registro
                  ? "Tudo salvo"
                  : "Pré-preenchido com o formulário; ainda não salvo"}
            </span>
          </div>
          {editandoClausula && (
            <p className="text-xs text-muted-foreground">
              Salve ou cancele a cláusula aberta antes de gerar o texto de novo.
            </p>
          )}
          {progressoEm("dados")}
          {recadoEm("dados")}
        </div>
      )}

      {/* -------------------------------------------------------------- avisos */}
      {/* Com o texto travado os avisos nao tem mais o que mudar ("corrija
          antes de enviar" depois de enviado so confunde): saem de cena. */}
      {!travado && avisos.length > 0 && (
        <Bloco
          titulo="Pontos para conferir"
          descricao={
            documento && !desatualizado
              ? registro?.revisado_em
                ? `Do sistema e da revisão da IA (${dataHoraLocal(registro.revisado_em)}).`
                : "Do sistema, sobre o texto gerado."
              : "Calculados agora, sobre os dados na tela."
          }
        >
          <ListaAvisos
            avisos={avisos}
            tituloDaClausula={tituloDaClausula}
            onIrParaClausula={(id) => irPara(idClausula(id))}
            onIrParaSecao={(id) => irPara(id, "start")}
          />
        </Bloco>
      )}

      {/* --------------------------------------------------------------- texto */}
      {documento && (
        <Bloco
          id={ID.texto}
          titulo="Texto do contrato"
          descricao={registro?.redigido_em ? `Gerado em ${dataHoraLocal(registro.redigido_em)}.` : undefined}
          acoes={
            iaDisponivel && !travado ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={revisar}
                disabled={acao !== null || editandoClausula || desatualizado}
              >
                {acao === "revisar" && progresso?.lugar === "texto" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <WandSparkles />
                )}
                Revisar de novo com IA
              </Button>
            ) : undefined
          }
        >
          {desatualizado && (
            <Recado tom="atencao">
              Os dados mudaram depois que este texto foi gerado. Toque em “Gerar o texto de novo” para refazer
              o texto com os dados atuais.
            </Recado>
          )}
          {progressoEm("texto")}
          {recadoEm("texto")}
          {travado ? (
            <details className="group rounded-lg border">
              <summary className="px-3 py-2.5 text-sm font-medium">Ler o texto do contrato</summary>
              <div className="border-t p-3">
                <EditorClausulas
                  documento={documento}
                  travado
                  ocupado={acao !== null}
                  salvando={false}
                  onSalvar={salvarDocumento}
                  recadoDaClausula={recadoDaClausula}
                />
              </div>
            </details>
          ) : (
            <EditorClausulas
              documento={documento}
              travado={false}
              ocupado={acao !== null}
              salvando={acao === "documento"}
              onSalvar={salvarDocumento}
              onEditando={setEditandoClausula}
              recadoDaClausula={recadoDaClausula}
            />
          )}
        </Bloco>
      )}

      {/* ----------------------------------------------------------------- PDF */}
      {documento && (
        <Bloco titulo="PDF">
          <div className="flex flex-wrap items-center gap-2">
            {!travado && (
              <Button
                type="button"
                size="lg"
                variant={temPdf ? "outline" : "default"}
                onClick={gerarPdf}
                disabled={acao !== null || motivoSemPdf !== null}
              >
                {acao === "pdf" ? <Loader2 className="animate-spin" /> : <FileText />}
                {temPdf ? "Gerar o PDF de novo" : "Gerar PDF"}
              </Button>
            )}
            {temPdf && (
              <a
                href={urlRascunho}
                download
                target="_blank"
                rel="noopener noreferrer"
                className={CLASSE_LINK_BOTAO}
              >
                <Download className="mr-1.5 size-4" />
                Baixar PDF
              </a>
            )}
          </div>
          {!travado && motivoSemPdf && <p className="text-xs text-muted-foreground">{motivoSemPdf}</p>}
          {!temPdf && registro?.pdf_gerado_em && !travado && (
            <p className="text-xs text-muted-foreground">
              O PDF anterior não tem as últimas mudanças do texto: gere de novo.
            </p>
          )}
          {temPdf && registro?.pdf_gerado_em && (
            <p className="text-xs text-muted-foreground">
              Gerado em {dataHoraLocal(registro.pdf_gerado_em)}.
            </p>
          )}
          {recadoEm("pdf")}
          {temPdf && <PreviaProposta url={urlPrevia} documento="contrato" />}
        </Bloco>
      )}

      {/* ---------------------------------------------------------- assinatura */}
      {registro &&
        (registro.status === "pdf_gerado" ||
          registro.status === "enviado" ||
          registro.status === "assinado") && (
          <Bloco titulo="Assinatura eletrônica">
            <PainelAssinatura
              registro={registro}
              documento={documento}
              urlArquivo={urlArquivo}
              statusLead={statusLead}
              assinaturaConfigurada={assinaturaConfigurada}
              assinaturaDryRun={assinaturaDryRun}
              bloqueioEnvio={bloqueioDoEnvio({ editandoClausula, desatualizado, sujo })}
              acao={
                acao === "enviar" || acao === "consultar" || acao === "cancelar" || acao === "mover"
                  ? acao
                  : null
              }
              ocupado={acao !== null}
              onEnviar={enviarAssinatura}
              onConsultar={() => void consultarAssinatura(false)}
              onCancelar={cancelarAssinatura}
              onMoverLead={moverLead}
            />
            {recadoEm("assinatura")}
          </Bloco>
        )}
    </section>
  );
}
