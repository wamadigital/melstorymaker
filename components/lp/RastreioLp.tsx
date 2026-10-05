"use client";

import { useEffect } from "react";
import { PROFUNDIDADES, SEGUNDOS, marcosAlcancados, profundidadeVista, secaoVista } from "@/lib/meta/engajamento";
import { EVENTO, EVENTO_LP } from "@/lib/meta/eventos";
import { rastrearComCopia } from "@/lib/meta/pixel";

const PAGINA = "casamento";
/** Mais pontos do que os marcos, para o observer avisar enquanto a seção alta entra. */
const LIMIARES = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * O que a LP conta além dos cliques nos CTAs e dos Reels (que moram nos
 * próprios componentes): rolagem, seção vista, tempo com a aba visível, FAQ
 * aberto e links de saída do rodapé. Pedido do owner em 05/10/2026 (ver
 * `EVENTO_LP`). Não desenha nada.
 *
 * Tudo por delegação e por atributo, para a página continuar server component:
 * as seções têm `data-secao`, as perguntas `data-duvida`, os links
 * `data-link`. Cada marco sai uma vez por visita.
 */
export function RastreioLp() {
  useEffect(() => {
    const feitos = new Set<string>();
    const uma = (chave: string, disparar: () => void) => {
      if (feitos.has(chave)) return;
      feitos.add(chave);
      disparar();
    };

    // Rolagem: medida no próximo quadro, no máximo uma vez por quadro.
    let medindo = false;
    const medir = () => {
      medindo = false;
      const vista = profundidadeVista(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
      for (const p of marcosAlcancados(vista, PROFUNDIDADES)) {
        uma(`rolou:${p}`, () =>
          rastrearComCopia("trackCustom", EVENTO_LP.rolou, { pagina: PAGINA, profundidade: String(p) }),
        );
      }
    };
    const aoRolar = () => {
      if (medindo) return;
      medindo = true;
      requestAnimationFrame(medir);
    };
    window.addEventListener("scroll", aoRolar, { passive: true });
    // A página é estática e rola antes de o React acordar (4G), e o navegador
    // restaura a rolagem no recarregar: o que já foi alcançado conta agora,
    // sem esperar o próximo `scroll`.
    aoRolar();

    // Seção vista.
    const secoes = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          const alvo = e.target as HTMLElement;
          const secao = alvo.dataset.secao;
          if (!secao || !secaoVista(e.intersectionRect.height, e.boundingClientRect.height, window.innerHeight)) continue;
          secoes.unobserve(alvo);
          uma(`secao:${secao}`, () => rastrearComCopia("trackCustom", EVENTO_LP.viuSecao, { pagina: PAGINA, secao }));
        }
      },
      { threshold: LIMIARES },
    );
    document.querySelectorAll<HTMLElement>("[data-secao]").forEach((el) => secoes.observe(el));

    // Tempo com a aba visível: aba em segundo plano não conta.
    let segundos = 0;
    const ultimo = SEGUNDOS[SEGUNDOS.length - 1];
    const relogio = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      segundos += 1;
      for (const s of SEGUNDOS) {
        if (segundos === s) rastrearComCopia("trackCustom", EVENTO_LP.tempo, { pagina: PAGINA, segundos: String(s) });
      }
      if (segundos >= ultimo) window.clearInterval(relogio);
    }, 1000);

    // FAQ: o `toggle` do <details> não sobe na árvore, mas passa pela captura.
    const aoAbrir = (ev: Event) => {
      const d = ev.target;
      if (!(d instanceof HTMLDetailsElement) || !d.open) return;
      const pergunta = d.dataset.duvida;
      if (pergunta) {
        uma(`duvida:${pergunta}`, () =>
          rastrearComCopia("trackCustom", EVENTO_LP.abriuDuvida, { pagina: PAGINA, pergunta }),
        );
      }
    };
    document.addEventListener("toggle", aoAbrir, true);

    // Links de saída do rodapé. Não é "uma vez": cada toque é uma ida.
    const aoClicar = (ev: MouseEvent) => {
      const link = (ev.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-link]");
      const destino = link?.dataset.link;
      if (!destino) return;
      if (destino === "email") {
        rastrearComCopia("track", EVENTO.contato, { content_category: PAGINA, canal: "email" }, { urgente: true });
      } else {
        rastrearComCopia("trackCustom", EVENTO_LP.cliqueLink, { pagina: PAGINA, destino }, { urgente: true });
      }
    };
    document.addEventListener("click", aoClicar, true);

    return () => {
      window.removeEventListener("scroll", aoRolar);
      secoes.disconnect();
      window.clearInterval(relogio);
      document.removeEventListener("toggle", aoAbrir, true);
      document.removeEventListener("click", aoClicar, true);
    };
  }, []);

  return null;
}
