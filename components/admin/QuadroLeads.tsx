"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { CartaoLead, ColunaVazia } from "@/components/admin/CartaoLead";
import { ColunaKanban } from "@/components/admin/ColunaKanban";
import { FaixaDestinos } from "@/components/admin/FaixaDestinos";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";
import { MENSAGEM_RECUSA, recusarMovimento } from "@/lib/admin/status";
import type { LeadCartao } from "@/lib/admin/tipos";
import { STATUS, type Status } from "@/lib/form/types";

export type Coluna = { cartoes: LeadCartao[]; total: number; erro: string | null };

/** O padrao do dnd-kit e em ingles, e toda string visivel do projeto e pt-BR. */
const INSTRUCOES = {
  draggable:
    "Aperte espaço para pegar o cartão. Use as setas para escolher a coluna e espaço de novo para soltar. Esc cancela.",
};

export function QuadroLeads({
  colunas,
  termo,
}: {
  colunas: Record<Status, Coluna>;
  termo: string;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();

  // Override otimista `id -> Status`. Cobre os dois momentos com um mecanismo
  // so: a previa enquanto o cartao esta no ar e o otimismo depois do drop.
  const [otimista, setOtimista] = useState<Record<string, Status>>({});
  const [movendo, setMovendo] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STATUS.map((s) => [s, true])),
  );

  const porId = useMemo(() => {
    const m = new Map<string, LeadCartao>();
    for (const s of STATUS) for (const c of colunas[s].cartoes) m.set(c.id, c);
    return m;
  }, [colunas]);

  // Auto-curativo: a entrada otimista some no instante em que o servidor
  // concorda com ela. Sem isso o router.refresh() chega e o override velho
  // continua mascarando o dado real -- o cartao nunca mais obedeceria o banco.
  useEffect(() => {
    setOtimista((atual) => {
      const restante = Object.fromEntries(
        Object.entries(atual).filter(([id, s]) => porId.get(id)?.status !== s),
      );
      // Compara o tamanho antes de setar, senao vira laco de render.
      return Object.keys(restante).length === Object.keys(atual).length ? atual : restante;
    });
  }, [porId]);

  const colunaDe = useCallback(
    (lead: LeadCartao): Status => otimista[lead.id] ?? lead.status,
    [otimista],
  );

  /** Agrupa considerando o override: e isso que faz o cartao "pular" de coluna. */
  const agrupadas = useMemo(() => {
    const saida = Object.fromEntries(STATUS.map((s) => [s, [] as LeadCartao[]])) as Record<
      Status,
      LeadCartao[]
    >;
    for (const s of STATUS) for (const c of colunas[s].cartoes) saida[colunaDe(c)].push(c);
    return saida;
  }, [colunas, colunaDe]);

  const leadArrastado = arrastando ? (porId.get(arrastando) ?? null) : null;

  // MouseSensor e TouchSensor separados, NAO PointerSensor: o PointerSensor
  // aceita UMA activationConstraint para os dois, e mouse quer `distance`
  // (arrasta na hora) enquanto toque quer `delay` -- sem o delay, o swipe
  // vertical da pagina viraria arraste.
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // delay 180 + tolerance 6: uma rolagem move mais de 6px antes dos 180ms e o
    // sensor CANCELA, deixando o navegador rolar nativamente. Em vez de brigar
    // com o gesto ambiguo, devolve ele para o navegador.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const nomeDe = useCallback(
    (id: string | number) => porId.get(String(id))?.nome_display || "lead sem nome",
    [porId],
  );

  const anuncios = useMemo(
    () => ({
      onDragStart: ({ active }: { active: { id: string | number } }) =>
        `Peguei o cartão de ${nomeDe(active.id)}.`,
      onDragOver: ({ over }: { over: { id: string | number } | null }) => {
        const alvo = alvoDe(over?.id);
        return alvo ? `Sobre a coluna ${ROTULO_STATUS[alvo]}.` : "Fora das colunas.";
      },
      onDragEnd: ({ over }: { over: { id: string | number } | null }) => {
        const alvo = alvoDe(over?.id);
        return alvo ? `Soltei em ${ROTULO_STATUS[alvo]}.` : "Solto fora das colunas: nada mudou.";
      },
      onDragCancel: () => "Movimentação cancelada.",
    }),
    [nomeDe],
  );

  const mover = useCallback(
    async (id: string, para: Status) => {
      const lead = porId.get(id);
      if (!lead) return;
      const de = otimista[id] ?? lead.status;

      const recusa = recusarMovimento(de, para, { temProposta: !!lead.pdf_url });
      if (recusa) {
        // Recusa local: nem chega a sair request.
        if (recusa !== "mesmo_status") toast.error(MENSAGEM_RECUSA[recusa]);
        return;
      }

      const nome = lead.nome_display || "o lead";

      // Marcar como enviada sem que e-mail nenhum tenha saido e uma decisao, nao
      // um efeito colateral: pergunta. So quando nunca foi enviado de verdade --
      // cartao voltando para a coluna nao repergunta nada.
      if (para === "enviado" && !lead.enviado_em) {
        const certeza = window.confirm(
          `Marcar a proposta de ${nome} como enviada?\n\nIsso só muda a coluna. Nenhum e-mail sai daqui.`,
        );
        if (!certeza) return;
      }

      setOtimista((o) => ({ ...o, [id]: para }));
      setMovendo(id);
      try {
        const r = await fetch(`/api/admin/leads/${id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: para, de }),
        });
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json.erro ?? "Não consegui mover.");

        // refresh DENTRO da transition: o override otimista segura a posicao ate
        // o payload novo chegar, entao o cartao nao pisca de volta no caminho.
        iniciar(() => router.refresh());
        toast.success(`${nome} → ${ROTULO_STATUS[para]}.`);
      } catch (e) {
        // Rollback: derruba o override e o cartao volta sozinho para a origem.
        setOtimista((o) => {
          const resto = { ...o };
          delete resto[id];
          return resto;
        });
        toast.error((e as Error).message);
        router.refresh(); // 409 = a aba estava velha; puxa o estado real
      } finally {
        setMovendo(null);
      }
    },
    [porId, otimista, router],
  );

  function aoSoltar(e: DragEndEvent) {
    setArrastando(null);
    const destino = alvoDe(e.over?.id);
    if (!destino) return;
    void mover(String(e.active.id), destino);
  }

  const vazio = STATUS.every((s) => colunas[s].cartoes.length === 0);
  const colunaArrastada = leadArrastado ? colunaDe(leadArrastado) : null;

  return (
    <DndContext
      // id explicito: sem ele o dnd-kit gera ids no cliente e esta pagina
      // (force-dynamic, renderizada no servidor) acusa hydration mismatch.
      id="quadro-leads"
      sensors={sensores}
      // closestCorners e nao pointerWithin: coluna VAZIA nao tem retangulo de
      // cartao para intersectar, e no toque o dedo fica embaixo do overlay.
      // closestCorners sempre devolve o droppable mais proximo -- e o que torna
      // coluna vazia alcancavel.
      collisionDetection={closestCorners}
      // Always: as colunas mudam de altura enquanto o cartao entra e sai. Sem
      // isto o dnd-kit mede os retangulos no dragStart e o drop cai na coluna
      // errada. E o bug numero 1 de quadro multi-coluna -- nao remover.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{ announcements: anuncios, screenReaderInstructions: INSTRUCOES }}
      onDragStart={(e: DragStartEvent) => setArrastando(String(e.active.id))}
      onDragEnd={aoSoltar}
      onDragCancel={() => setArrastando(null)}
    >
      {vazio && !termo && (
        <p className="mb-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum lead por aqui ainda.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATUS.map((status) => (
          <Raia
            key={status}
            status={status}
            coluna={colunas[status]}
            cartoes={agrupadas[status]}
            termo={termo}
            aberta={aberta[status]}
            onAlternar={() => setAberta((a) => ({ ...a, [status]: !a[status] }))}
            arrastandoDe={colunaArrastada}
            temProposta={!!leadArrastado?.pdf_url}
            movendo={movendo}
            onMover={mover}
          />
        ))}
      </div>

      <FaixaDestinos
        visivel={!!leadArrastado}
        de={colunaArrastada}
        temProposta={!!leadArrastado?.pdf_url}
      />

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {leadArrastado && colunaArrastada && (
          <CartaoLead lead={leadArrastado} coluna={colunaArrastada} sobreposto />
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Uma coluna, com o droppable e os cartoes arrastaveis. */
function Raia({
  status,
  coluna,
  cartoes,
  termo,
  aberta,
  onAlternar,
  arrastandoDe,
  temProposta,
  movendo,
  onMover,
}: {
  status: Status;
  coluna: Coluna;
  cartoes: LeadCartao[];
  termo: string;
  aberta: boolean;
  onAlternar: () => void;
  arrastandoDe: Status | null;
  temProposta: boolean;
  movendo: string | null;
  onMover: (id: string, para: Status) => void;
}) {
  const router = useRouter();
  const recusa = arrastandoDe ? recusarMovimento(arrastandoDe, status, { temProposta }) : null;
  const proibida = !!recusa && recusa !== "mesmo_status";

  // O droppable NUNCA e desabilitado, mesmo na coluna proibida. Com `disabled`,
  // o closestCorners simplesmente elege o proximo droppable mais perto -- e o
  // cartao mirado em "Novo" era solto em "Aguardando revisao", em silencio.
  // Recebendo o drop, `mover()` recusa e explica o porque num toast.
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <ColunaKanban
      status={status}
      total={coluna.total}
      mostrando={coluna.cartoes.length}
      aberta={aberta}
      onAlternar={onAlternar}
      // Realce so quando o drop e legitimo: apagada + sem anel ja dizem "aqui
      // nao", e quem insistir recebe a explicacao no toast.
      alvo={isOver && !proibida}
      apagada={proibida}
      refDrop={setNodeRef}
    >
      {coluna.erro ? (
        // Botao em vez de so a mensagem: a falha e transitoria (ver
        // lib/supabase/consulta.ts), entao tentar de novo costuma resolver na
        // hora -- e refresh() recarrega so os dados, sem perder a busca digitada.
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{coluna.erro}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-xs font-medium text-destructive underline underline-offset-2"
          >
            Tentar de novo
          </button>
        </div>
      ) : cartoes.length === 0 ? (
        <ColunaVazia status={status} termo={termo} />
      ) : (
        cartoes.map((lead) => (
          <Arrastavel
            key={lead.id}
            lead={lead}
            coluna={status}
            movendo={movendo === lead.id}
            onMover={onMover}
          />
        ))
      )}
    </ColunaKanban>
  );
}

function Arrastavel({
  lead,
  coluna,
  movendo,
  onMover,
}: {
  lead: LeadCartao;
  coluna: Status;
  movendo: boolean;
  onMover: (id: string, para: Status) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });

  return (
    <div ref={setNodeRef}>
      <CartaoLead
        lead={lead}
        coluna={coluna}
        movendo={movendo}
        arrastando={isDragging}
        onMover={onMover}
        handle={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/** `over.id` pode ser a coluna ou um chip da faixa mobile (`destino:<status>`). */
function alvoDe(id: string | number | undefined): Status | null {
  if (id === undefined) return null;
  const bruto = String(id);
  const limpo = bruto.startsWith("destino:") ? bruto.slice(8) : bruto;
  return (STATUS as readonly string[]).includes(limpo) ? (limpo as Status) : null;
}
