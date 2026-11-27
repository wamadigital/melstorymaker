"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ClipboardCheck, Megaphone, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CATEGORIAS, STATUS, type Categoria, type Status } from "@/lib/form/types";
import { ROTULO_STATUS, rotuloCategoria } from "@/lib/admin/rotulos";
import { dataCurta } from "@/lib/pdf/formatadores";
import {
  chaveModeloCampanha, LIMITE_PAGINA_CAMPANHAS, MAX_IMAGEM_CAMPANHA,
  type FiltrosCampanha, type ItemPublico, type ModeloCampanha, type ModoCampanha,
  type OpcoesCampanha, type PublicoCampanha,
} from "@/lib/campanhas/contrato";
import { API_CAMPANHAS, consultarCampanhas, enviarJson, erroCampanha } from "./consulta";
import { Campo, Paginacao, Selecao } from "./PartesCampanhas";

export const CHAVE_INICIO_CAMPANHA = "mel.campanha.inicio";

const INICIAIS: FiltrosCampanha = { categoria: null, inicio: null, fim: null, status: null, excluirStatus: null, qualificado: null };
const MODO: Record<ModoCampanha, string> = {
  simulacao: "Simulação sem envio · Henrique",
  teste: "Envio de teste · Henrique",
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
  const [modo, definirModo] = useState<ModoCampanha>("simulacao");
  const [filtros, definirFiltros] = useState(INICIAIS);
  const [mensagens, definirMensagens] = useState([{ id: 0, texto: "", modelo: null as string | null }]);
  const ultimaVariacao = useRef(0);
  const [imagem, definirImagem] = useState<File | null>(null);
  const [previaImagem, mostrarImagem] = useState("");
  const [intervalo, definirIntervalo] = useState("");
  const [pagina, paginar] = useState(0);
  const [publico, mostrarPublico] = useState<{ chave: string; dados: PublicoCampanha }>();
  const [falhaPublico, mostrarFalhaPublico] = useState<{ chave: string; erro: string }>();
  const [catalogo, mostrarCatalogo] = useState<ModeloCampanha[] | null>(null);
  const [falhaCatalogo, mostrarFalhaCatalogo] = useState("");
  const [revisando, revisar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [erro, mostrarErro] = useState("");
  const [recarregar, recarga] = useState(0);
  const idTentativa = useRef<string | null>(null);
  const iniciando = useRef(false);
  const campoImagem = useRef<HTMLInputElement>(null);

  const consulta = JSON.stringify({ filtros, modo, pagina });
  const chave = `${recarregar}:${consulta}`;
  const publicoAtual = publico?.chave === chave ? publico.dados : null;
  const erroPublico = falhaPublico?.chave === chave ? falhaPublico.erro : "";
  const preenchidas = mensagens.filter(({ texto }) => texto.trim());
  const textos = preenchidas.map(({ texto }) => texto.trim());
  const intervaloMin = intervalo === "" ? null : Number(intervalo);
  const intervaloValido = intervaloMin === null || Number.isInteger(intervaloMin) && intervaloMin >= 1 && intervaloMin <= 30;
  const modelos = catalogo?.filter((modelo) => modelo.imagem === !!imagem) ?? [];
  const usaProvedor = modo !== "simulacao" && opcoes.provedorConfigurado;
  const podeIniciar = opcoes.workerAtivo && (modo === "simulacao" || opcoes.provedorConfigurado);
  const mensagensValidas = !usaProvedor || preenchidas.every(({ texto, modelo }) => {
    const candidatos = modelos.filter((m) => m.texto === texto.trim());
    return modelo ? candidatos.some((m) => chaveModeloCampanha(m) === modelo) : candidatos.length === 1;
  });
  const aptos = publicoAtual?.aptos ?? 0;

  useEffect(() => {
    if (!imagem) return;
    const url = URL.createObjectURL(imagem);
    mostrarImagem(url);
    return () => URL.revokeObjectURL(url);
  }, [imagem]);

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

  useEffect(() => {
    if (modo === "simulacao" || !opcoes.provedorConfigurado) return;
    const controle = new AbortController();
    consultarCampanhas<{ modelos: ModeloCampanha[] }>(`${API_CAMPANHAS}?modelos`, { signal: controle.signal })
      .then(({ modelos }) => {
        if (!controle.signal.aborted) { mostrarCatalogo(modelos); mostrarFalhaCatalogo(""); }
      })
      .catch((e) => {
        if (!controle.signal.aborted) { mostrarCatalogo(null); mostrarFalhaCatalogo(erroCampanha(e)); }
      });
    return () => controle.abort();
  }, [modo, opcoes.provedorConfigurado]);

  function mudarFiltro<K extends keyof FiltrosCampanha>(campo: K, valor: FiltrosCampanha[K]) {
    definirFiltros((atual) => ({ ...atual, [campo]: valor }));
    paginar(0);
  }

  function mudarMensagem(id: number, texto: string, modelo: string | null = null) {
    definirMensagens((atual) => atual.map((mensagem) => mensagem.id === id ? { ...mensagem, texto, modelo } : mensagem));
  }

  function anexar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > MAX_IMAGEM_CAMPANHA || !["image/jpeg", "image/png"].includes(arquivo.type)) {
      mostrarErro("Use uma imagem PNG ou JPEG de até 3 MB.");
      if (campoImagem.current) campoImagem.current.value = "";
      return;
    }
    mostrarErro("");
    definirImagem(arquivo);
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
      const body = new FormData();
      body.set("campanha", JSON.stringify({
        id: idTentativa.current, nome, modo, filtros, intervalo: intervaloMin, mensagens: textos,
        modelosEscolhidos: preenchidas.map(({ modelo }) => modelo), revisao: publicoAtual.revisao,
      }));
      if (imagem) body.set("imagem", imagem);
      const { id } = await consultarCampanhas<{ id: string }>(API_CAMPANHAS, { method: "POST", body });
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
      <Button variant="ghost" onClick={sair} disabled={ocupado}><ArrowLeft /> Campanhas</Button>
      <h1 className="text-2xl font-semibold">{revisando ? "Revisar campanha" : "Nova campanha"}</h1>
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
              <p className="text-xs text-muted-foreground">Estimativa sem atrasos do worker nem limites adicionais do provedor.</p>
            </> : <>
              <Campo titulo="Nome da campanha"><Input value={nome} onChange={(e) => nomear(e.target.value)} maxLength={120} required /></Campo>
              <Campo titulo="Modo de envio">
                <Selecao value={modo} onChange={(e) => { definirModo(e.target.value as ModoCampanha); paginar(0); }}>
                  <option value="simulacao">{MODO.simulacao}</option>
                  <option value="teste">{MODO.teste}</option>
                  <option value="real">{MODO.real}</option>
                </Selecao>
              </Campo>
              {!opcoes.provedorConfigurado && <p className="text-xs text-muted-foreground">A prévia está disponível. Os envios de teste e reais exigem a configuração da API oficial do WhatsApp.</p>}
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
                <Campo titulo="Status a excluir">
                  <Selecao value={filtros.excluirStatus ?? ""} onChange={(e) => mudarFiltro("excluirStatus", (e.target.value || null) as Status | null)}>
                    <option value="">Nenhum</option>
                    {STATUS.map((status) => <option key={status} value={status}>{ROTULO_STATUS[status]}</option>)}
                  </Selecao>
                </Campo>
              </div>
              <p className="text-xs text-muted-foreground">O período usa a data do evento preenchida no formulário, incluindo as duas datas. Cards sem data ficam de fora.</p>
            </>}
          </section>

          <section className="space-y-4 rounded-md border bg-card p-4 sm:p-5">
            <h2 className="font-semibold">Mensagens e imagem</h2>
            {revisando ? textos.map((texto, i) => (
              <div key={i} className="rounded-md border bg-background p-3">
                <h3 className="mb-1 text-sm font-medium">Mensagem {i + 1}</h3>
                <p className="whitespace-pre-wrap wrap-break-word text-sm">{texto}</p>
              </div>
            )) : <>
              {usaProvedor && <p className="text-sm text-muted-foreground">
                {falhaCatalogo || (!catalogo ? "Carregando modelos da Meta…" : modelos.length
                  ? "Selecione um modelo aprovado ou use o texto exato dele."
                  : "Nenhum modelo aprovado disponível para este formato. Confira a opção de imagem.")}
              </p>}
              {mensagens.map(({ id, texto, modelo: escolha }, i) => (
                <div key={id} className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium" htmlFor={`campanha-texto-${id}`}>Mensagem {i + 1}</label>
                    {mensagens.length > 1 && <Button variant="ghost" size="icon-sm" aria-label={`Remover mensagem ${i + 1}`}
                      onClick={() => definirMensagens((atual) => atual.filter((mensagem) => mensagem.id !== id))}><X /></Button>}
                  </div>
                  {usaProvedor && modelos.length > 0 && <Selecao aria-label={`Modelo da mensagem ${i + 1}`}
                    value={escolha ?? ""}
                    onChange={(e) => {
                      const modelo = modelos.find((m) => chaveModeloCampanha(m) === e.target.value);
                      mudarMensagem(id, modelo?.texto ?? texto, modelo ? chaveModeloCampanha(modelo) : null);
                    }}>
                    <option value="">Escolher modelo aprovado</option>
                    {modelos.map((modelo) => <option key={chaveModeloCampanha(modelo)} value={chaveModeloCampanha(modelo)}>{modelo.nome} ({modelo.idioma})</option>)}
                  </Selecao>}
                  <Textarea id={`campanha-texto-${id}`} rows={3} value={texto} maxLength={1024}
                    onChange={(e) => mudarMensagem(id, e.target.value)} />
                </div>
              ))}
              <Button variant="outline"
                onClick={() => { const id = ++ultimaVariacao.current; definirMensagens((atual) => [...atual, { id, texto: "", modelo: null }]); }}>
                <Plus /> Adicionar variação
              </Button>
              <p className="text-xs text-muted-foreground">Cada contato recebe uma das mensagens preenchidas, sorteada uma vez.</p>
              {usaProvedor && textos.length > 0 && !mensagensValidas && !!catalogo &&
                <p className="text-sm text-destructive">Confira o texto e o formato dos modelos aprovados.</p>}
            </>}
            {imagem ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- Prévia local de um arquivo escolhido no navegador. */}
                {previaImagem && <img src={previaImagem} alt="Imagem anexada à campanha" className="max-h-60 w-auto max-w-full rounded-md border object-contain" />}
                {!revisando && <Button variant="outline" onClick={() => { definirImagem(null); mostrarImagem(""); }}><X /> Remover imagem</Button>}
              </div>
            ) : revisando ? <p className="text-sm text-muted-foreground">Sem imagem anexada.</p> : (
              <Campo titulo="Imagem opcional · PNG ou JPEG até 3 MB" htmlFor="campanha-imagem">
                <Input id="campanha-imagem" type="file" accept="image/png,image/jpeg" ref={campoImagem}
                  onChange={(e) => anexar(e.target.files?.[0])} />
              </Campo>
            )}
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

      {revisando && modo !== "simulacao" && !opcoes.provedorConfigurado &&
        <p className="text-sm text-muted-foreground">Configure a API oficial do WhatsApp para iniciar este envio.</p>}
      {!opcoes.workerAtivo && <p className="text-sm text-muted-foreground">O worker está desativado. A prévia está disponível.</p>}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        {revisando ? <>
          <Button variant="outline" disabled={ocupado} onClick={() => { revisar(false); recarga((n) => n + 1); mostrarErro(""); }}>Editar campanha</Button>
          <Button disabled={ocupado || !podeIniciar || !aptos} onClick={iniciar}><Megaphone />{ocupado ? "Iniciando…" : "Iniciar campanha"}</Button>
        </> : <Button disabled={!nome.trim() || !textos.length || !aptos || !intervaloValido || !mensagensValidas}
          onClick={() => { revisar(true); mostrarErro(""); window.scrollTo(0, 0); }}>
          <ClipboardCheck /> Revisar campanha
        </Button>}
      </div>
    </div>
  );
}
