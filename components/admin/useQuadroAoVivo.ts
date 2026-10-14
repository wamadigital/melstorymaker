import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { AUSENCIA_MAX_MS, EVENTO_QUADRO, JANELA_AVISO_MS, TOPICO_QUADRO } from "@/lib/admin/tempo-real";

/**
 * Mantem o quadro em dia sozinho: escuta o aviso do banco (lib/admin/tempo-real.ts)
 * e chama `atualizar` -- o router.refresh() do quadro, que rele os leads pelo
 * servidor. O aviso nao traz dado; e so a campainha.
 *
 * `pausado` segura o refresh enquanto um cartao esta no ar ou o PATCH de um
 * movimento nao voltou: o payload novo no meio do arraste mexeria as colunas
 * embaixo do dedo. O aviso nao se perde; sai quando a pausa acaba.
 *
 * Falhar aqui so deixa o quadro como era antes: sem o SQL aplicado, sem rede ou
 * com a sessao vencida, a pagina continua funcionando com o refresh manual.
 */
export function useQuadroAoVivo({ pausado, atualizar }: { pausado: boolean; atualizar: () => void }) {
  const atualizarRef = useRef(atualizar);
  const pausadoRef = useRef(pausado);
  const pendenteRef = useRef(false);

  useEffect(() => {
    atualizarRef.current = atualizar;
  });

  useEffect(() => {
    pausadoRef.current = pausado;
    if (!pausado && pendenteRef.current) {
      pendenteRef.current = false;
      atualizarRef.current();
    }
  }, [pausado]);

  useEffect(() => {
    const supabase = criarClienteNavegador();
    let canal: RealtimeChannel | null = null;
    let encerrado = false;
    let jaInscrito = false;
    let janela: ReturnType<typeof setTimeout> | null = null;
    let escondidoEm: number | null = null;

    // O primeiro aviso abre a janela e os seguintes caem nela: no pior caso, um
    // refresh por segundo, e o lead aparece no maximo um segundo depois.
    const pedirRefresh = () => {
      if (janela) return;
      janela = setTimeout(() => {
        janela = null;
        if (pausadoRef.current) pendenteRef.current = true;
        else atualizarRef.current();
      }, JANELA_AVISO_MS);
    };

    void (async () => {
      try {
        // Canal privado exige o JWT da Mel no join. Sem isto o primeiro join
        // pode sair com a chave anon, antes de o cliente ler a sessao do cookie.
        await supabase.realtime.setAuth();
        // Conferido ANTES de mexer em canal: a montagem que o StrictMode
        // descarta acorda depois da que fica e nao pode remover o canal dela.
        if (encerrado) return;
        // Voltar ao quadro logo depois de sair dele acha o canal da montagem
        // anterior ainda saindo, e `channel()` devolveria aquele mesmo, que nao
        // aceita um segundo subscribe.
        for (const velho of supabase.getChannels()) {
          if (velho.topic === `realtime:${TOPICO_QUADRO}`) await supabase.removeChannel(velho);
        }
        if (encerrado) return;

        canal = supabase
          .channel(TOPICO_QUADRO, { config: { private: true } })
          .on("broadcast", { event: EVENTO_QUADRO }, pedirRefresh)
          .subscribe((status) => {
            if (status !== "SUBSCRIBED") return;
            // SUBSCRIBED de novo = o socket caiu e voltou. O que mudou no
            // intervalo nao e reenviado: puxa o estado inteiro.
            if (jaInscrito) pedirRefresh();
            jaInscrito = true;
          });
      } catch (e) {
        console.warn("[quadro ao vivo] não consegui assinar o canal", (e as Error)?.message ?? e);
      }
    })();

    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "hidden") {
        escondidoEm = Date.now();
        return;
      }
      if (escondidoEm !== null && Date.now() - escondidoEm > AUSENCIA_MAX_MS) pedirRefresh();
      escondidoEm = null;
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      encerrado = true;
      if (janela) clearTimeout(janela);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      if (canal) void supabase.removeChannel(canal);
    };
  }, []);
}
