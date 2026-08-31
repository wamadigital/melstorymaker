"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";

// O mesmo `sm` do Tailwind: acima disso vale o <iframe>, abaixo o nosso.
const LARGURA_SM = 640;

/**
 * Previa da proposta no painel.
 *
 * No desktop continua o <iframe>: o visualizador nativo do navegador da rolagem
 * continua, zoom e impressao de graca, e ali ele funciona.
 *
 * No celular ele NAO funciona: o WebKit desenha o PDF dentro do iframe como uma
 * miniatura de uma pagina so, com barra de rolagem propria e sem jeito de
 * chegar nas outras paginas. Por isso abaixo de 640px a previa e desenhada por
 * nos, pagina inteira e uma de cada vez, com paginacao embaixo.
 */
export function PreviaProposta({ url }: { url: string }) {
  const [celular, setCelular] = useState<boolean | null>(null);

  useEffect(() => {
    const raiz = document.documentElement;
    const aplicar = () => setCelular(raiz.clientWidth < LARGURA_SM);
    aplicar();

    // Dois gatilhos de proposito. O matchMedia e o caminho canonico, mas o
    // `change` dele nao chega em todo lugar (emulacao de dispositivo e parte
    // dos WebView nao reavaliam a media); o ResizeObserver pega a mudanca de
    // tamanho de fato. Quem decide e sempre o clientWidth, entao os dois
    // chegando juntos so recalculam o mesmo valor.
    const mq = window.matchMedia(`(max-width: ${LARGURA_SM - 1}px)`);
    mq.addEventListener("change", aplicar);
    const ro = new ResizeObserver(aplicar);
    ro.observe(raiz);

    return () => {
      mq.removeEventListener("change", aplicar);
      ro.disconnect();
    };
  }, []);

  // Enquanto nao sabemos a largura, uma caixa do tamanho certo: evita o pulo do
  // layout e impede que o iframe carregue o PDF a toa no celular.
  if (celular === null) {
    return <div className="aspect-[595/842] w-full rounded-lg border bg-muted sm:aspect-auto sm:h-[70vh]" />;
  }

  if (celular) return <VisualizadorPaginado url={url} />;

  return (
    <iframe
      key={url}
      src={url}
      title="Prévia da proposta"
      className="h-[70vh] w-full rounded-lg border bg-muted"
    />
  );
}

// Acima disso a memoria do canvas cresce sem ninguem enxergar diferenca: a arte
// ja e um JPEG de ~2,4 px/pt, entao passar de 3x so gasta RAM do aparelho.
const DPR_MAX = 3;

// Curto de proposito: e o bastante para separar arrastar de tocar, e baixo o
// bastante para o gesto nao parecer preso.
const ARRASTE_MINIMO = 48;

function VisualizadorPaginado({ url }: { url: string }) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  // A carga e quem sabe destruir (e derrubar o worker); o documento nao.
  const cargaRef = useRef<PDFDocumentLoadingTask | null>(null);
  const tarefaRef = useRef<RenderTask | null>(null);
  const toqueRef = useRef<{ x: number; y: number } | null>(null);

  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [largura, setLargura] = useState(0);
  const [pintando, setPintando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // ------------------------------------------------------------ carregamento
  useEffect(() => {
    let vivo = true;
    setErro(null);
    setPintando(true);
    setTotal(0);
    setPagina(1);

    (async () => {
      try {
        // Import dinamico: o pdf.js e grande e so a tela de detalhe do lead o
        // usa -- ele nunca pode entrar no bundle do formulario.
        // Build `legacy`: ja vem transpilado, entao roda tambem em WebView e
        // Safari antigos, que e onde a Mel abre o painel.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        // Baixa de uma vez e entrega os bytes prontos. Solto, o pdf.js fatia o
        // arquivo em varios range requests, e /p/{slug} tem limite de 30/min
        // por IP -- abrir tres leads seguidos ja bateria no teto.
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const bytes = new Uint8Array(await resposta.arrayBuffer());
        if (!vivo) return;

        const carga = pdfjs.getDocument({ data: bytes });
        cargaRef.current = carga;
        const doc = await carga.promise;
        if (!vivo) {
          void carga.destroy();
          return;
        }
        docRef.current = doc;
        setTotal(doc.numPages);
      } catch (e) {
        console.error("[previa] falha ao abrir o PDF", e);
        if (vivo) {
          setErro("Não consegui abrir a prévia aqui. Toque em Baixar PDF para ver a proposta.");
          setPintando(false);
        }
      }
    })();

    return () => {
      vivo = false;
      tarefaRef.current?.cancel();
      tarefaRef.current = null;
      void cargaRef.current?.destroy();
      cargaRef.current = null;
      docRef.current = null;
    };
  }, [url]);

  // ----------------------------------------------------------------- medicao
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;

    setLargura(caixa.clientWidth);
    const ro = new ResizeObserver(([entrada]) => setLargura(entrada.contentRect.width));
    ro.observe(caixa);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------ pintura
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || total === 0 || largura <= 0) return;

    let vivo = true;
    setPintando(true);

    (async () => {
      try {
        // Cancela e ESPERA a anterior: duas render() na mesma canvas ao mesmo
        // tempo saem uma por cima da outra quando se passa pagina depressa.
        const anterior = tarefaRef.current;
        if (anterior) {
          anterior.cancel();
          await anterior.promise.catch(() => {});
        }
        if (!vivo) return;

        const page = await doc.getPage(pagina);
        if (!vivo) return;

        const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (largura / base.width) * dpr });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);

        const tarefa = page.render({ canvas, viewport });
        tarefaRef.current = tarefa;
        await tarefa.promise;
        if (vivo) setPintando(false);
      } catch (e) {
        // Cancelamento e o caminho normal de quem passa pagina: nao e erro.
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        console.error("[previa] falha ao desenhar a página", e);
        if (vivo) {
          setErro("Não consegui desenhar esta página. Toque em Baixar PDF para ver a proposta.");
          setPintando(false);
        }
      }
    })();

    return () => {
      vivo = false;
    };
  }, [total, pagina, largura]);

  const ir = useCallback(
    (passo: number) => setPagina((p) => Math.min(Math.max(p + passo, 1), total || 1)),
    [total],
  );

  function iniciarToque(e: React.TouchEvent) {
    const t = e.touches[0];
    toqueRef.current = { x: t.clientX, y: t.clientY };
  }

  function terminarToque(e: React.TouchEvent) {
    const inicio = toqueRef.current;
    toqueRef.current = null;
    if (!inicio) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - inicio.x;
    const dy = t.clientY - inicio.y;
    // O eixo dominante decide: sem isso, rolar a pagina para baixo com o dedo
    // meio torto virava troca de pagina.
    if (Math.abs(dx) < ARRASTE_MINIMO || Math.abs(dx) <= Math.abs(dy)) return;
    ir(dx < 0 ? 1 : -1);
  }

  if (erro) {
    return (
      <p role="status" className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground">
        {erro}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* A caixa tem a proporcao da pagina e o canvas usa object-contain: a
          pagina aparece inteira, sem rolagem propria e sem corte. */}
      <div
        ref={caixaRef}
        onTouchStart={iniciarToque}
        onTouchEnd={terminarToque}
        className="relative aspect-[595/842] w-full overflow-hidden rounded-lg border bg-muted"
      >
        <canvas ref={canvasRef} className="size-full object-contain" />

        {pintando && (
          <div className="absolute inset-0 grid place-items-center bg-muted/70">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {total > 1 && (
        <nav aria-label="Páginas da proposta" className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="icon-lg"
            onClick={() => ir(-1)}
            disabled={pagina <= 1}
            aria-label="Página anterior"
          >
            <ChevronLeft />
          </Button>

          <span aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
            Página {pagina} de {total}
          </span>

          <Button
            variant="outline"
            size="icon-lg"
            onClick={() => ir(1)}
            disabled={pagina >= total}
            aria-label="Próxima página"
          >
            <ChevronRight />
          </Button>
        </nav>
      )}
    </div>
  );
}
