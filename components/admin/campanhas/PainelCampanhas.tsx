"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CirclePause, Play, Plus, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dataHoraLocal } from "@/lib/pdf/formatadores";
import {
  LIMITE_PAGINA_CAMPANHAS, type AcaoCampanha, type Campanha, type DestinatarioCampanha, type OpcoesCampanha,
} from "@/lib/campanhas/contrato";
import { CHAVE_INICIO_CAMPANHA, NovaCampanha } from "./NovaCampanha";
import { API_CAMPANHAS, consultarCampanhas, enviarJson, erroCampanha } from "./consulta";
import { Paginacao } from "./PartesCampanhas";

const STATUS_CAMPANHA: Record<Campanha["status"], string> = {
  ativa: "Em andamento", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada",
};
const STATUS_ENVIO: Record<DestinatarioCampanha["status"], string> = {
  pendente: "Pendente", processando: "Em processamento", enviado: "Enviado", simulado: "Simulado", falha: "Falha", ignorado: "Ignorado",
};
const MOTIVOS: Record<string, string> = {
  cancelado: "Campanha cancelada",
  formato_anterior: "A campanha anterior tinha um anexo",
  reserva_expirada: "O prazo da reserva venceu antes do envio",
  consentimento_revogado: "Consentimento retirado",
  resultado_indeterminado: "Aceite não confirmado. Reenvio automático bloqueado.",
  limite_provedor: "Limite do provedor",
};

function rotuloMotivo(motivo: string) {
  return MOTIVOS[motivo] ?? motivo;
}

type Lista = { campanhas: Campanha[]; mais: boolean; opcoes: OpcoesCampanha };
type Consulta = { campanhas: Campanha[]; mais: boolean; opcoes?: OpcoesCampanha };

function Progresso({ campanha }: { campanha: Campanha }) {
  const { total, pendentes } = campanha.contadores;
  const processados = total - pendentes;
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm tabular-nums">{processados} de {total} contatos processados</p>
      <progress aria-label="Progresso da campanha" value={processados} max={total || 1}
        className="block h-2 w-full overflow-hidden rounded-md bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary" />
    </div>
  );
}

export function PainelCampanhas({ idInicial }: { idInicial: string | null }) {
  const [id, escolher] = useState(idInicial);
  const [nova, criar] = useState(false);
  const [pagina, paginar] = useState(0);
  const [consulta, mostrar] = useState<{ chave: string; dados: Consulta }>();
  const [opcoes, mostrarOpcoes] = useState<OpcoesCampanha>();
  const [falha, mostrarFalha] = useState<{ chave: string; erro: string }>();
  const [recarga, recarregar] = useState(0);
  const [recuperando, recuperar] = useState(true);
  const alterando = useRef(false);
  const [ocupada, ocupar] = useState(false);
  const [confirmarCancelamento, confirmar] = useState(false);
  const [erroAcao, mostrarErroAcao] = useState("");
  const chave = `${id ?? "lista"}:${pagina}`;
  const atual = consulta?.chave === chave ? consulta.dados : undefined;
  const erro = falha?.chave === chave ? falha.erro : "";

  function mudar(idCampanha: string | null) {
    const destino = new URL(window.location.href);
    if (idCampanha) destino.searchParams.set("id", idCampanha);
    else destino.searchParams.delete("id");
    window.history.replaceState(null, "", destino);
    escolher(idCampanha);
    paginar(0);
    confirmar(false);
    mostrarErroAcao("");
    criar(false);
  }

  useEffect(() => {
    let pendente: string | null = null;
    try { pendente = sessionStorage.getItem(CHAVE_INICIO_CAMPANHA); } catch {}
    if (idInicial || !pendente) {
      recuperar(false);
      return;
    }
    const controle = new AbortController();
    consultarCampanhas<{ campanha: Campanha }>(`${API_CAMPANHAS}/${pendente}`, { signal: controle.signal })
      .then(({ campanha }) => {
        if (!controle.signal.aborted) {
          try { sessionStorage.removeItem(CHAVE_INICIO_CAMPANHA); } catch {}
          mudar(campanha.id);
        }
      }).catch(() => {}).finally(() => {
        if (!controle.signal.aborted) recuperar(false);
      });
    return () => controle.abort();
  }, [idInicial]);

  useEffect(() => {
    if (nova || recuperando) return;
    const controle = new AbortController();
    let temporizador: number;
    const url = `${API_CAMPANHAS}${id ? `/${id}` : ""}?pagina=${pagina}`;

    async function atualizar() {
      try {
        let dados: Lista;
        if (id) {
          const detalhe = await consultarCampanhas<{ campanha: Campanha; opcoes: OpcoesCampanha }>(url, { signal: controle.signal });
          dados = { campanhas: [detalhe.campanha], mais: false, opcoes: detalhe.opcoes };
        } else {
          dados = await consultarCampanhas<Lista>(url, { signal: controle.signal });
        }
        if (controle.signal.aborted) return;
        mostrar({ chave, dados });
        mostrarOpcoes(dados.opcoes);
        mostrarFalha(undefined);
      } catch (e) {
        if (!controle.signal.aborted) {
          mostrarFalha({ chave, erro: erroCampanha(e) });
        }
      } finally {
        if (!controle.signal.aborted) temporizador = window.setTimeout(atualizar, 5000);
      }
    }
    void atualizar();
    return () => { clearTimeout(temporizador); controle.abort(); };
  }, [id, pagina, chave, recarga, nova, recuperando]);

  async function controlar(acao: AcaoCampanha) {
    if (!id || alterando.current) return;
    alterando.current = true;
    ocupar(true);
    mostrarErroAcao("");
    try {
      await consultarCampanhas(`${API_CAMPANHAS}/${id}`, enviarJson("PATCH", { acao }));
      recarregar((n) => n + 1);
      confirmar(false);
    } catch (e) {
      mostrarErroAcao(erroCampanha(e));
    } finally {
      ocupar(false);
      alterando.current = false;
    }
  }

  const campanha = id ? atual?.campanhas[0] : null;
  const contadores = campanha?.contadores;
  return (
    <div className="mx-auto w-full max-w-5xl">
      {nova && opcoes ? <NovaCampanha opcoes={opcoes} sair={() => mudar(null)} iniciada={mudar} /> : (
        <div className="space-y-5">
          {id && <Button variant="ghost" disabled={ocupada} onClick={() => mudar(null)}><ArrowLeft /> Campanhas</Button>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="min-w-0 wrap-break-word text-2xl font-semibold">{campanha?.nome ?? "Campanhas"}</h1>
            {!id && <Button onClick={() => criar(true)} disabled={!opcoes || recuperando}><Plus /> Nova campanha</Button>}
          </div>
          {erro && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            <TriangleAlert className="size-4" /> {erro}
            <Button variant="outline" onClick={() => recarregar((n) => n + 1)}>Atualizar</Button>
          </div>}
          {!atual && !erro && <p role="status" className="text-sm text-muted-foreground">Carregando campanhas…</p>}
          {!id && atual && (atual.campanhas.length ? <>
            <ul className="space-y-3">
              {atual.campanhas.map((item) => (
                <li key={item.id} className="grid items-center gap-4 rounded-md border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)_auto]">
                  <div className="min-w-0 space-y-1">
                    <h2 className="wrap-break-word font-semibold">{item.nome}</h2>
                    <p className="text-xs text-muted-foreground">{dataHoraLocal(item.criada_em)}{item.modo !== "real" && ` · ${item.modo === "simulacao" ? "Simulação" : "Teste"}`}</p>
                    <Badge variant="secondary">{STATUS_CAMPANHA[item.status]}</Badge>
                  </div>
                  <Progresso campanha={item} />
                  <Button variant="outline" onClick={() => mudar(item.id)}>Acompanhar</Button>
                </li>
              ))}
            </ul>
            <Paginacao pagina={pagina} mais={atual.mais} mudar={paginar} />
          </> : <div className="space-y-3 rounded-md border bg-card p-5">
            <p className="text-sm text-muted-foreground">{pagina ? "Nenhuma campanha nesta página." : "Nenhuma campanha criada ainda."}</p>
            <Paginacao pagina={pagina} mais={false} mudar={paginar} />
          </div>)}

          {campanha && contadores && <>
            <section className="space-y-4 rounded-md border bg-card p-4 sm:p-5" aria-label="Progresso">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{STATUS_CAMPANHA[campanha.status]}</Badge>
                {campanha.modo !== "real" && <Badge variant="outline">{campanha.modo === "simulacao" ? "Simulação" : "Envio de teste"}</Badge>}
              </div>
              <Progresso campanha={campanha} />
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Enviados", contadores.enviados], ["Pendentes", contadores.pendentes], ["Falhas", contadores.falhas],
                  ["Ignorados", contadores.ignorados], ...(campanha.modo === "simulacao" ? [["Simulados", contadores.simulados]] : []),
                ].map(([rotulo, n]) => (
                  <div key={rotulo} className="rounded-md border bg-background p-3">
                    <dt className="text-xs text-muted-foreground">{rotulo}</dt><dd className="text-xl font-semibold tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
              {campanha.status === "ativa" && contadores.pendentes > 0 && <p className="text-sm">
                {!opcoes?.workerAtivo ? "Fila indisponível · worker desativado"
                  : !campanha.proximo_em ? "Envios de campanha pausados"
                  : contadores.pendentes === contadores.processando ? "Último envio em processamento"
                  : `Próximo envio previsto · ${dataHoraLocal(campanha.proximo_em)}${contadores.processando > 0 ? " · 1 em processamento" : ""}`}
              </p>}
              {contadores.processando > 0 && campanha.status !== "ativa" &&
                <p className="text-sm text-muted-foreground">O envio que já estava em processamento ainda pode terminar.</p>}
              {erroAcao && <p role="alert" className="text-sm text-destructive">{erroAcao}</p>}
              {(campanha.status === "ativa" || campanha.status === "pausada") && <div className="flex flex-wrap gap-2">
                {campanha.status === "ativa" ? <Button variant="outline" disabled={ocupada} onClick={() => controlar("pausar")}><CirclePause /> Pausar</Button>
                  : <Button variant="outline" disabled={ocupada} onClick={() => controlar("retomar")}><Play /> Retomar</Button>}
                <Button variant="destructive" disabled={ocupada || confirmarCancelamento} onClick={() => confirmar(true)}>
                  <Square /> Cancelar pendentes
                </Button>
              </div>}
              {confirmarCancelamento && <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm">Cancelar os envios pendentes desta campanha?</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" disabled={ocupada} onClick={() => controlar("cancelar")}>Confirmar cancelamento</Button>
                  <Button variant="outline" disabled={ocupada} onClick={() => confirmar(false)}>Voltar</Button>
                </div>
              </div>}
            </section>
            <section className="space-y-3 rounded-md border bg-card p-4 sm:p-5">
              <h2 className="font-semibold">Histórico por destinatário</h2>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Contato</TableHead><TableHead>Versão</TableHead><TableHead>Horário</TableHead>
                  <TableHead>Resultado</TableHead><TableHead>Motivo</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {campanha.historico.map((destino) => (
                    <TableRow key={destino.id}>
                      <TableCell className="max-w-48 whitespace-normal wrap-break-word">
                        {destino.nome ?? "Contato sem nome"}<br /><span className="text-xs text-muted-foreground">+{destino.telefone}</span>
                      </TableCell>
                      <TableCell>Mensagem {campanha.filtros.mensagem_teste ?? destino.variante}</TableCell>
                      <TableCell>{destino.atualizado_em ? dataHoraLocal(destino.atualizado_em) : "—"}</TableCell>
                      <TableCell>{STATUS_ENVIO[destino.status]}{destino.tentativas > 1 && <span className="text-xs text-muted-foreground"> · {destino.tentativas} tentativas</span>}</TableCell>
                      <TableCell className="max-w-56 whitespace-normal">
                        {destino.motivo ? rotuloMotivo(destino.motivo) : "—"}
                        {destino.eventos.length > 1 && <details className="mt-1 text-xs">
                          <summary>Tentativas</summary>
                          <ul className="space-y-1 py-1">
                            {destino.eventos.map((evento) => (
                              <li key={evento.tentativa}>{dataHoraLocal(evento.iniciada_em)} · {evento.motivo
                                ? rotuloMotivo(evento.motivo)
                                : evento.resultado === "enviado" ? "Enviado" : "Em processamento"}</li>
                            ))}
                          </ul>
                        </details>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Paginacao pagina={pagina} mais={(pagina + 1) * LIMITE_PAGINA_CAMPANHAS < contadores.total} mudar={paginar} />
            </section>

            <details className="space-y-3 rounded-md border bg-card p-4 sm:p-5">
              <summary className="font-semibold">Mensagens da campanha</summary>
              {campanha.mensagens.map((mensagem, i) => (
                <div key={i} className="rounded-md border bg-background p-3">
                  <h3 className="mb-1 text-sm font-medium">Mensagem {campanha.filtros.mensagem_teste ?? i + 1}</h3>
                  <p className="whitespace-pre-wrap wrap-break-word text-sm">{mensagem}</p>
                </div>
              ))}
            </details>
          </>}
        </div>
      )}
    </div>
  );
}
