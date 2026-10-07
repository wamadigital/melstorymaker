"use client";

import Link from "next/link";
import { Check, FileText, GripVertical, Mail, MessageCircle } from "lucide-react";
import { AcoesLead } from "@/components/admin/AcoesLead";
import { BotaoLembrete } from "@/components/admin/BotaoLembrete";
import { BotaoLembreteEmail } from "@/components/admin/BotaoLembreteEmail";
import { ChamarWhatsApp } from "@/components/admin/ChamarWhatsApp";
import { estadoLembrete, SELO_LEMBRETE, temaCobranca } from "@/lib/admin/lembretes";
import { estadoLembreteEmail } from "@/lib/admin/lembrete-email";
import { linkConversaLead } from "@/lib/whatsapp";
import { DESCRICAO_COLUNA, TEMA_COLUNA, rotuloCategoria, rotuloPasso } from "@/lib/admin/rotulos";
import type { LeadCartao } from "@/lib/admin/tipos";
import type { Status } from "@/lib/form/types";
import { dataCurta, dataHoraLocal } from "@/lib/pdf/formatadores";
import { cn } from "@/lib/utils";

type Props = {
  lead: LeadCartao;
  /** Coluna em que o cartao esta sendo desenhado (pode ser a otimista). */
  coluna: Status;
  onMover?: (id: string, para: Status) => void;
  /** Request de movimentacao em voo: trava o cartao e mostra o spinner. */
  movendo?: boolean;
  /** Copia flutuante dentro do DragOverlay. */
  sobreposto?: boolean;
  /** O original, enquanto a copia flutua. */
  arrastando?: boolean;
  /** Props do handle de arraste. Sem elas o cartao nao mostra o grip. */
  handle?: React.HTMLAttributes<HTMLElement>;
  /**
   * "Agora" em ms, carimbado pelo SERVIDOR e descido como prop.
   *
   * Nao e `Date.now()` aqui dentro: o painel e renderizado no servidor e o
   * cartao e hidratado no navegador. Dois relogios diferentes na mesma arvore
   * dariam hydration mismatch justamente na fronteira do 7o dia.
   */
  agoraMs: number;
};

/**
 * Cartao do quadro. Visual puro: nao chama nenhum hook do dnd-kit, para poder
 * ser reusado dentro do DragOverlay -- o overlay ja aplica o transform, e um
 * useDraggable aqui aplicaria um segundo, fazendo o cartao tremer.
 */
export function CartaoLead({
  lead,
  coluna,
  onMover,
  movendo = false,
  sobreposto = false,
  arrastando = false,
  handle,
  agoraMs,
}: Props) {
  const tema = TEMA_COLUNA[coluna];
  const nome = lead.nome_display ?? "";
  // "Parou em: Local da festa" (RF-09) so faz sentido em quem nao terminou.
  const parouEm = coluna === "incompleto" ? rotuloPasso(lead.categoria, lead.passo_atual) : null;

  // `coluna` e nao `lead.status`: arrastar um cartao com cobranca para "Virou
  // cliente" apaga a cobranca na hora, sem esperar o servidor responder. A cor
  // tambem sai da coluna: azul-claro em "Enviado", cinza em "Esfriou".
  const lembrete = estadoLembrete(lead, coluna, agoraMs);
  const alerta = temaCobranca(coluna, lembrete);

  // Quem parou no meio do formulario mas deixou telefone: da para puxar a
  // conversa. So em "Novo" -- de `aguardando_revisao` em diante a acao certa e
  // gerar a proposta, nao conversar. Sem telefone nao ha botao, porque desde
  // 03/09/2026 o lead so nasce COM ele: quem nao tem e registro antigo.
  //
  // Abre a conversa VAZIA: a mensagem quem escreve e a Mel (ver
  // `linkConversaLead`). Ao lado vai a caixa "ja chamei", que apaga o botao
  // enquanto o lead nao responde (ver `ChamarWhatsApp`).
  const chamar = coluna === "incompleto" ? linkConversaLead(lead.whatsapp) : null;

  // Logo abaixo, o lembrete por e-mail: tambem so em "Novo", e so com e-mail.
  // O clique envia e o botao trava por 7 dias (ver `lib/admin/lembrete-email.ts`).
  const lembreteEmail = estadoLembreteEmail(lead, coluna, agoraMs);

  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-lg border bg-card transition-shadow",
        "shadow-[0_1px_2px_rgb(0_0_0/6%)]",
        // Cobranca vencida pinta o cartao inteiro: dentro de uma coluna azul,
        // um cartao ambar ou vermelho e a unica coisa que a Mel precisa ver.
        alerta?.cartao,
        !sobreposto && "hover:border-black/15 hover:shadow-[0_2px_8px_rgb(0_0_0/8%)]",
        arrastando && "opacity-40",
        sobreposto && "rotate-2 shadow-lg",
        movendo && "pointer-events-none opacity-60",
      )}
    >
      {/* Barra de acento: mantem a leitura de qual coluna o cartao veio mesmo
          flutuando no overlay, onde ele perde o fundo colorido da coluna. */}
      <span aria-hidden className={cn("w-1 shrink-0", alerta?.barra ?? tema.barra)} />

      {handle && (
        <button
          type="button"
          {...handle}
          aria-label={`Arrastar ${nome || "lead sem nome"}`}
          // touch-manipulation ESTATICO, nunca condicional: o Chrome le
          // touch-action no pointerdown, entao trocar por estado de React chega
          // tarde e o arraste morre em silencio. `manipulation` e nao `none`
          // porque a ativacao no toque e por DELAY -- durante os 180ms o
          // navegador ainda precisa poder rolar a pagina.
          className={cn(
            "hidden w-7 shrink-0 items-center justify-center text-muted-foreground/50 sm:flex",
            "touch-manipulation cursor-grab transition-colors hover:text-foreground",
            "active:cursor-grabbing active:bg-accent",
          )}
        >
          <GripVertical className="size-4" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <Link
          href={`/admin/leads/${lead.id}`}
          className="block min-w-0 space-y-1 py-3 pr-9 pl-3"
          // No overlay o cartao e so pintura: navegar dali nao faz sentido.
          tabIndex={sobreposto ? -1 : undefined}
        >
          <p className="truncate text-sm font-medium">
            {nome || <span className="text-muted-foreground">Sem nome</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {rotuloCategoria(lead.categoria)}
            {lead.data_evento && <> · {dataCurta(lead.data_evento)}</>}
          </p>
          {parouEm && <p className="truncate text-xs text-muted-foreground">Parou em: {parouEm}</p>}

          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[0.6875rem] text-muted-foreground/80">
              {dataHoraLocal(lead.created_at)}
            </span>
            {/* Sinais do que da para fazer sem abrir o lead. */}
            <span className="ml-auto flex items-center gap-1 text-muted-foreground/60">
              {lead.pdf_url && <FileText className="size-3" aria-label="Tem proposta" />}
              {lead.email && <Mail className="size-3" aria-label="Tem e-mail" />}
              {lead.whatsapp && <MessageCircle className="size-3" aria-label="Tem WhatsApp" />}
            </span>
          </div>
        </Link>

        {/* Rodape de cobranca. Fora do <Link> pelo mesmo motivo do menu: botao
            dentro de <a> e HTML invalido. So aparece quando ha o que dizer --
            um cartao de dois dias nao ganha linha nenhuma. */}
        {!sobreposto && (chamar || lembreteEmail.visivel) && (
          <div className="space-y-2 px-3 pb-3">
            {chamar && (
              <ChamarWhatsApp id={lead.id} link={chamar} chamadoEm={lead.chamado_whatsapp_em} />
            )}
            {lembreteEmail.visivel && lead.email && (
              <BotaoLembreteEmail id={lead.id} email={lead.email} estado={lembreteEmail} />
            )}
          </div>
        )}

        {!sobreposto && (lembrete.pendente || lembrete.cobrado) && (
          <div className="@container px-3 pb-3">
            {lembrete.pendente ? (
              <BotaoLembrete
                id={lead.id}
                nome={nome}
                marco={lembrete.pendente}
                classeTexto={alerta?.texto}
                whatsapp={lead.whatsapp}
                pdfUrl={lead.pdf_url}
              />
            ) : (
              <p className="flex items-center gap-1 text-[0.6875rem] whitespace-nowrap text-muted-foreground">
                {/* Sem o check abaixo de ~132px: "Lembrado aos 30 dias" so cabe
                    numa linha do cartao de seis colunas sem ele. */}
                <Check className="hidden size-3 shrink-0 @min-[8.25rem]:block" strokeWidth={3} />
                {SELO_LEMBRETE[lembrete.cobrado!]}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Fora do <Link>: botao dentro de <a> e HTML invalido, e o clique no menu
          navegaria para o detalhe. Absoluto porque o cartao e vertical e o menu
          precisa ficar no canto, sem empurrar o texto. */}
      {!sobreposto && onMover && (
        <div className="absolute top-1.5 right-1">
          <AcoesLead
            id={lead.id}
            nome={nome}
            pdfUrl={lead.pdf_url}
            whatsapp={lead.whatsapp}
            temEmail={!!lead.email}
            status={coluna}
            ocupadoExterno={movendo}
            onMover={(para) => onMover(lead.id, para)}
          />
        </div>
      )}
    </div>
  );
}

/** Bloco tracejado que ocupa a coluna vazia -- e tambem o alvo de drop visivel. */
export function ColunaVazia({ status, termo }: { status: Status; termo: string }) {
  return (
    <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
      {termo ? `Nada com “${termo}” aqui.` : DESCRICAO_COLUNA[status]}
    </p>
  );
}
