"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { rotuloCaixaChamado } from "@/lib/admin/chamado";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  /** wa.me do lead, ja montado por `linkConversaLead`. */
  link: string;
  /** Quando a Mel marcou "ja chamei", ou null. */
  chamadoEm: string | null;
};

const BOTAO =
  "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-semibold";

/**
 * "Chamar no WhatsApp" do cartao de "Novo", com a caixa "ja chamei" ao lado.
 *
 * Marcada, o botao APAGA e perde o link: a Mel ja chamou e espera a resposta, e
 * o cartao para de pedir acao. Para chamar de novo, ela desmarca -- e a caixa,
 * nao o botao, que decide, porque o clique no wa.me nao prova que a mensagem
 * saiu (ver `lib/admin/chamado.ts`).
 */
export function ChamarWhatsApp({ id, link, chamadoEm }: Props) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [atualizando, iniciar] = useTransition();

  // A caixa responde na hora, sem esperar a rede. Quando o banco muda por fora
  // -- o refresh depois do clique, outra aba --, a tela volta a seguir o banco.
  const doBanco = !!chamadoEm;
  const [marcado, setMarcado] = useState(doBanco);
  const [vistoDoBanco, setVistoDoBanco] = useState(doBanco);
  if (doBanco !== vistoDoBanco) {
    setVistoDoBanco(doBanco);
    setMarcado(doBanco);
  }

  const rotulo = rotuloCaixaChamado(marcado, chamadoEm);

  async function alternar(proximo: boolean) {
    setMarcado(proximo);
    setSalvando(true);
    try {
      const r = await fetch(`/api/admin/leads/${id}/chamado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chamado: proximo }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 409 = o lead saiu de "Novo" enquanto o quadro estava aberto.
        if (r.status === 409) iniciar(() => router.refresh());
        throw new Error(json.erro ?? "Não consegui marcar.");
      }
      iniciar(() => router.refresh());
    } catch (e) {
      setMarcado(!proximo);
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  // "Chamar no WhatsApp" com o icone mede ~162px: a linha INTEIRA do cartao no
  // quadro de cinco colunas. Com a caixa ao lado, o rotulo inteiro so cabe no
  // celular e nas duas colunas do tablet; mais estreito, o botao diz so
  // "WhatsApp" e, perto de 1024px, perde o icone -- em vez de quebrar em duas
  // linhas. Container query e nao breakpoint de tela: quem manda e a largura do
  // cartao, que muda com o numero de colunas. O "Chamar no " escondido continua
  // no leitor de tela (`sr-only`).
  const conteudo = (
    <>
      <MessageCircle className="hidden size-3.5 shrink-0 @min-[8rem]:block" />
      <span className="whitespace-nowrap">
        <span className="sr-only @min-[12.5rem]:not-sr-only">Chamar no </span>
        WhatsApp
      </span>
    </>
  );

  return (
    <div className="@container">
      <div className="flex items-center gap-1.5">
        {marcado ? (
          // Apagado e sem link: um segundo clique por engano abriria de novo a
          // conversa de quem ja foi chamado.
          <span aria-disabled="true" className={cn(BOTAO, "border-border/60 text-muted-foreground/70")}>
            {conteudo}
          </span>
        ) : (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(BOTAO, "border-border bg-background transition-colors hover:bg-muted")}
          >
            {conteudo}
          </a>
        )}

        {/* Mesmo desenho do `CaixaMarcacao` do formulario: input nativo com
            `appearance-none`, para teclado e leitor de tela funcionarem sem JS
            a mais. Sem rotulo visivel -- nao cabe no cartao --, entao o nome vai
            em aria-label e no title, com a data de quando foi marcado. O
            <label> em volta aumenta a area de toque. */}
        <label title={rotulo} className="relative flex shrink-0 items-center justify-center p-1">
          <input
            type="checkbox"
            checked={marcado}
            disabled={salvando || atualizando}
            onChange={(e) => alternar(e.target.checked)}
            aria-label={rotulo}
            className="peer size-5 appearance-none rounded-md border-2 border-foreground/40 bg-card transition-colors outline-none hover:border-foreground checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          />
          <Check
            aria-hidden="true"
            strokeWidth={3.5}
            className="pointer-events-none absolute inset-0 m-auto size-3.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
          />
        </label>
      </div>
    </div>
  );
}
