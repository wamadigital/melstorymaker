import type { Passo } from "@/lib/form/types";

/**
 * Contrato unico de todo componente de pergunta. Um componente por tipo
 * (`texto`, `data`, `hora`, `escolha_unica`, `email`, `telefone`), todos
 * consumindo o schema do arvore.json -- nunca uma pergunta hardcoded.
 */
export type CampoProps = {
  passo: Passo;
  valor: string;
  onChange: (valor: string) => void;
  /**
   * Avanca de tela. Recebe o valor explicitamente porque escolha_unica avanca
   * no mesmo clique que responde, e o estado do React ainda nao atualizou.
   */
  onAvancar: (valorOverride?: string) => void;
  erro?: string | null;
  autoFocus?: boolean;
};

/**
 * Foco automatico so onde existe teclado fisico. No navegador in-app do
 * WhatsApp, abrir o teclado sozinho empurra o layout e esconde o botao.
 */
export function devoFocarSozinho(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
