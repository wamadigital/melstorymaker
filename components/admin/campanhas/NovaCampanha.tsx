"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ClipboardCheck, Megaphone, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CATEGORIAS, STATUS, type Categoria, type Status } from "@/lib/form/types";
import { ROTULO_STATUS, rotuloCategoria } from "@/lib/admin/rotulos";
import { dataCurta } from "@/lib/pdf/formatadores";
import {
  LIMITE_PAGINA_CAMPANHAS, type FiltrosCampanha, type ItemPublico,
  type OpcoesCampanha, type PublicoCampanha,
} from "@/lib/campanhas/contrato";
import { API_CAMPANHAS, consultarCampanhas, enviarJson, erroCampanha } from "./consulta";
import { Campo, Paginacao, Selecao } from "./PartesCampanhas";
import { TesteCampanha } from "./TesteCampanha";

export const CHAVE_INICIO_CAMPANHA = "mel.campanha.inicio";

const INICIAIS: FiltrosCampanha = { categoria: null, inicio: null, fim: null, status: null, excluirStatus: [], qualificado: null };
const MODO = {
  simulacao: "Simulação sem envio · Henrique",
  real: "Envio real · contatos autorizados",
};
const PUBLICO: Record<ItemPublico["resultado"], string> = {
  apto: "Apto", invalido: "Telefone inválido", sem_consentimento: "Sem consentimento",
  duplicado: "Telefone duplicado", fora_do_teste: "Fora do público de teste",
};

function duracao(segundos: number) {
  const minutos = Math.floor(segundos / 60);
  return [minutos && `${minutos} min`, segundos % 60 && `${segundos % 60} s`].filter(Boolean).join(" ") || "0 min";
}

export function NovaCampanha({ opcoes, sair, iniciada }: {
  opcoes: OpcoesCampanha; sair: () => void; iniciada: (id: string) => void;
}) {
  const [nome, nomear] = useState("");
  const [modo, definirModo] = useState<keyof typeof MODO>("simulacao");
  const [filtros, definirFiltros] = useState(INICIAIS);
  const [mensagens, definirMensagens] = useState([{ id: 0, texto: "" }]);
  const ultimaVariacao = useRef(0);
  const [intervalo, definirIntervalo] = useState("");
  const [pagina, paginar] = useState(0);
  const [publico, mostrarPublico] = useState<{ chave: string; dados: PublicoCampanha }>();
  const [falhaPublico, mostrarFalhaPublico] = useState<{ chave: string; erro: string }>();
  const [revisando, revisar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [erro, mostrarErro] = useState("");
  const [recarregar, recarga] = useState(0);
  const idTentativa = useRef<string | null>(null);
  const iniciando = useRef(false);

  const consulta = JSON.stringify({ filtros, modo, pagina });
  const chave = `${recarregar}:${consulta}`;
  const publicoAtual = publico?.chave === chave ? publico.dados : null;
  const erroPublico = falhaPublico?.chave === chave ? falhaPublico.erro : "";
  const preenchidas = mensagens.map(({ id, texto }, i) => ({ id, texto: texto.trim(), numero: i + 1 }))
    .filter(({ texto }) => texto);
  const textos = preenchidas.map(({ texto }) => texto);
  const intervaloMin = intervalo === "" ? null : Number(intervalo);
  const intervaloValido = intervaloMin === null || Number.isInteger(intervaloMin) && intervaloMin >= 1 && intervaloMin <= 30;
  const podeIniciar = modo === "simulacao" ? opcoes.workerAtivo : opcoes.enviosAtivos;
  const aptos = publicoAtual?.aptos ?? 0;

  useEffect(() => {
    const controle = new AbortController();
    const atraso = window.setTimeout(async () => {
      try {
        const dados = await consultarCampanhas<PublicoCampanha>(API_CAMPANHAS, enviarJson("POST", JSON.parse(consulta), controle.signal));
        if (!controle.signal.aborted) mostrarPublico({ chave, dados });
      } catch (e) {
        if (!controle.signal.aborted) mostrarFalhaPublico({ chave, erro: erroCampanha(e) });
      }
    }, 220);
    return () => { clearTimeout(atraso); controle.abort(); };
  }, [chave, consulta]);

  function mudarFiltro<K extends keyof FiltrosCampanha>(campo: K, valor: FiltrosCampanha[K]) {
    definirFiltros((atual) => ({ ...atual, [campo]: valor }));
    paginar(0);
  }

  function mudarMensagem(id: number, texto: string) {
    definirMensagens((atual) => atual.map((mensagem) => mensagem.id === id ? { ...mensagem, texto } : mensagem));
  }

  function excluirStatus(status: Status, excluir: boolean) {
    definirFiltros((atual) => ({ ...atual, excluirStatus: excluir
      ? [...atual.excluirStatus, status]
      : atual.excluirStatus.filter((item) => item !== status) }));
    paginar(0);
  }

  async function iniciar() {
    if (iniciando.current || !podeIniciar || !publicoAtual?.aptos) return;
    iniciando.current = true;
    ocupar(true);
    mostrarErro("");
    try {
      try { idTentativa.current ??= sessionStorage.getItem(CHAVE_INICIO_CAMPANHA); } catch {}
      idTentativa.current ??= crypto.randomUUID();
      try { sessionStorage.setItem(CHAVE_INICIO_CAMPANHA, idTentativa.current); } catch {}
      const { id } = await consultarCampanhas<{ id: string }>(API_CAMPANHAS, enviarJson("POST", {
        acao: "iniciar", id: idTentativa.current, nome, modo, filtros, intervalo: intervaloMin,
        mensagens: textos, revisao: publicoAtual.revisao,
      }));
      try { sessionStorage.removeItem(CHAVE_INICIO_CAMPANHA); } catch {}
      iniciada(id);
    } catch (e) {
      mostrarErro(erroCampanha(e));
    } finally {
      iniciando.current = false;
      ocupar(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col items-start justify-between gap-3 lg:flex-row">
        <div className="space-y-3">
          <Button variant="ghost" onClick={sair} disabled={ocupado}><ArrowLeft /> Campanhas</Button>
          <h1 className="text-2xl font-semibold">{revisando ? "Revisar campanha" : "Nova campanha"}</h1>
        </div>
        <TesteCampanha nome={nome} mensagens={preenchidas} ativo={opcoes.enviosAtivos} />
      </header>
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="space-y-5">
          <section className="space-y-4 rounded-md border bg-card p-4 sm:p-5">
            {revisando ? <>
              <h2 className="wrap-break-word text-lg font-semibold">{nome.trim()}</h2>
              <p className="text-sm text-muted-foreground">{MODO[modo]}</p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Intervalo definido</dt><dd>{intervaloMin ? `${intervaloMin} min` : "Sem intervalo adicional"}</dd></div>
                <div><dt className="text-muted-foreground">Do primeiro ao último envio</dt><dd>
                  Cerca de {duracao(Math.max(0, aptos - 1) * Math.max((intervaloMin ?? 0) * 60, modo === "simulacao" ? 10 : opcoes.cadencia))}
                </dd></div>
              </dl>
              <p className="text-xs text-muted-foreground">Estimativa sem atrasos do worker nem o limite diário de envios.</p>
            </> : <>
              <Campo titulo="Nome da campanha"><Input value={nome} onChange={(e) => nomear(e.target.value)} maxLength={120} required /></Campo>
              <Campo titulo="Modo de envio">
                <Selecao value={modo} onChange={(e) => { definirModo(e.target.value as keyof typeof MODO); paginar(0); }}>
                  <option value="simulacao">{MODO.simulacao}</option>
                  <option value="real">{MODO.real}</option>
                </Selecao>
              </Campo>
              <h2 className="pt-1 font-semibold">Filtros do Kanban</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo titulo="Tipo de festa">
                  <Selecao value={filtros.categoria ?? ""} onChange={(e) => mudarFiltro("categoria", (e.target.value || null) as Categoria | null)}>
                    <option value="">Todos</option>
                    {CATEGORIAS.map((categoria) => <option key={categoria} value={categoria}>{rotuloCategoria(categoria)}</option>)}
                  </Selecao>
                </Campo>
                <Campo titulo="Qualificação">
                  <Selecao value={String(filtros.qualificado ?? "")} onChange={(e) => mudarFiltro("qualificado", e.target.value ? e.target.value === "true" : null)}>
                    <option value="">Tanto faz</option><option value="true">Qualificado</option><option value="false">Não qualificado</option>
                  </Selecao>
                </Campo>
                <Campo titulo="Data inicial do evento"><Input type="date" value={filtros.inicio ?? ""} onChange={(e) => mudarFiltro("inicio", e.target.value || null)} /></Campo>
                <Campo titulo="Data final do evento"><Input type="date" value={filtros.fim ?? ""} onChange={(e) => mudarFiltro("fim", e.target.value || null)} /></Campo>
                <Campo titulo="Status do lead">
                  <Selecao value={filtros.status ?? ""} onChange={(e) => mudarFiltro("status", (e.target.value || null) as Status | null)}>
                    <option value="">Todos</option>
                    {STATUS.map((status) => <option key={status} value={status}>{ROTULO_STATUS[status]}</option>)}
                  </Selecao>
                </Campo>
                <fieldset className="grid min-w-0 gap-1.5 text-sm font-medium">
                  <legend className="mb-1.5">Status a excluir</legend>
                  <details className="relative min-w-0">
                    <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md border bg-background px-2">
                      {!filtros.excluirStatus.length ? "Nenhum" : filtros.excluirStatus.length === 1
                        ? ROTULO_STATUS[filtros.excluirStatus[0]] : `${filtros.excluirStatus.length} status excluídos`}
                      <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
                    </summary>
                    <div className="absolute z-10 mt-1 grid w-full gap-1 rounded-md border bg-popover p-1 shadow-md">
                      {STATUS.map((status) => <label key={status} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                        <input type="checkbox" className="accent-primary" checked={filtros.excluirStatus.includes(status)}
                          onChange={(e) => excluirStatus(status, e.target.checked)} />
                        {ROTULO_STATUS[status]}
                      </label>)}
                    </div>
                  </details>
                </fieldset>
              </div>
              <p className="text-xs text-muted-foreground">O período usa a data do evento preenchida no formulário, incluindo as duas datas. Cards sem data ficam de fora.</p>
            </>}
          </section>

          <section className="space-y-4 rounded-md border bg-card p-4 sm:p-5">
            <h2 className="font-semibold">Mensagens</h2>
            {revisando ? textos.map((texto, i) => (
              <div key={i} className="rounded-md border bg-background p-3">
                <h3 className="mb-1 text-sm font-medium">Mensagem {i + 1}</h3>
                <p className="whitespace-pre-wrap wrap-break-word text-sm">{texto}</p>
              </div>
            )) : <>
              {mensagens.map(({ id, texto }, i) => (
                <div key={id} className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium" htmlFor={`campanha-texto-${id}`}>Mensagem {i + 1}</label>
                    {mensagens.length > 1 && <Button variant="ghost" size="icon-sm" aria-label={`Remover mensagem ${i + 1}`}
                      onClick={() => definirMensagens((atual) => atual.filter((mensagem) => mensagem.id !== id))}><X /></Button>}
                  </div>
                  <Textarea id={`campanha-texto-${id}`} rows={3} value={texto} maxLength={1024}
                    onChange={(e) => mudarMensagem(id, e.target.value)} />
                </div>
              ))}
              <Button variant="outline"
                onClick={() => { const id = ++ultimaVariacao.current; definirMensagens((atual) => [...atual, { id, texto: "" }]); }}>
                <Plus /> Adicionar variação
              </Button>
              <p className="text-xs text-muted-foreground">Cada contato recebe uma das mensagens preenchidas, sorteada uma vez.</p>
            </>}
            {!revisando && <Campo titulo="Intervalo entre contatos em minutos (opcional)">
              <Input type="number" min={1} max={30} step={1} value={intervalo} placeholder="1 a 30" onChange={(e) => definirIntervalo(e.target.value)}
                aria-invalid={!intervaloValido} />
            </Campo>}
          </section>
        </div>

        <section className="min-w-0 space-y-4 rounded-md border bg-card p-4 sm:p-5" aria-labelledby="publico-campanha">
          <h2 id="publico-campanha" className="font-semibold">{revisando ? "Público final" : "Prévia do público"}</h2>
          {erroPublico && <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{erroPublico}</p>
            <Button variant="outline" onClick={() => recarga((n) => n + 1)}>Atualizar prévia</Button>
          </div>}
          {!publicoAtual && !erroPublico && <p role="status" className="text-sm text-muted-foreground">Calculando público…</p>}
          {publicoAtual && <>
            <div className="grid grid-cols-2 gap-2" aria-live="polite">
              <div className="min-w-0 rounded-md border bg-background p-3"><strong className="text-xl tabular-nums">{publicoAtual.cards}</strong><p className="text-xs text-muted-foreground">Cards selecionados</p></div>
              <div className="min-w-0 rounded-md border bg-background p-3"><strong className="text-xl tabular-nums">{aptos}</strong><p className="text-xs text-muted-foreground">Contatos únicos aptos</p></div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {publicoAtual.invalidos > 0 && <Badge variant="outline">{publicoAtual.invalidos} telefone(s) inválido(s)</Badge>}
              {publicoAtual.duplicados > 0 && <Badge variant="outline">{publicoAtual.duplicados} duplicado(s)</Badge>}
              {publicoAtual.semConsentimento > 0 && <Badge variant="outline">{publicoAtual.semConsentimento} sem consentimento</Badge>}
              {publicoAtual.foraDoTeste > 0 && <Badge variant="outline">{publicoAtual.foraDoTeste} fora do teste</Badge>}
            </div>
            {publicoAtual.itens.length ? <ul className="divide-y border-y">
              {publicoAtual.itens.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/admin/leads/${item.id}`} target="_blank" rel="noopener" className="block wrap-break-word text-sm font-medium hover:underline">
                      {item.nome || "Card sem nome"}
                    </Link>
                    <p className="wrap-break-word text-xs text-muted-foreground">
                      {item.telefone ? `+${item.telefone}` : item.telefone_original || "Sem telefone"} · {dataCurta(item.data_evento)} · {ROTULO_STATUS[item.status]}
                    </p>
                  </div>
                  <Badge variant={item.resultado === "apto" ? "secondary" : "outline"}>{PUBLICO[item.resultado]}</Badge>
                </li>
              ))}
            </ul> : <p className="text-sm text-muted-foreground">Nenhum card corresponde a estes filtros.</p>}
          </>}
          <Paginacao pagina={pagina} mais={!!publicoAtual && (pagina + 1) * LIMITE_PAGINA_CAMPANHAS < publicoAtual.cards} mudar={paginar} />
        </section>
      </div>

      {!podeIniciar && <p className="text-sm text-muted-foreground">Os envios estão pausados. A prévia está disponível.</p>}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        {revisando ? <>
          <Button variant="outline" disabled={ocupado} onClick={() => { revisar(false); recarga((n) => n + 1); mostrarErro(""); }}>Editar campanha</Button>
          <Button disabled={ocupado || !podeIniciar || !aptos} onClick={iniciar}><Megaphone />{ocupado ? "Iniciando…" : "Iniciar campanha"}</Button>
        </> : <Button disabled={!nome.trim() || !textos.length || !aptos || !intervaloValido}
          onClick={() => { revisar(true); mostrarErro(""); window.scrollTo(0, 0); }}>
          <ClipboardCheck /> Revisar campanha
        </Button>}
      </div>
    </div>
  );
}
