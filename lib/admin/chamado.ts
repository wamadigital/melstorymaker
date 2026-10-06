import { dataHoraLocal } from "@/lib/pdf/formatadores";

/**
 * "Ja chamei no WhatsApp": a caixa ao lado do "Chamar no WhatsApp" nos cartoes
 * de "Novo", pedido do owner em 06/10/2026.
 *
 * E uma MARCA da Mel, separada do botao: o clique no botao continua sem
 * carimbar nada -- o wa.me abre a conversa vazia, e o sistema nao tem como
 * saber se ela escreveu (regra 3). Ela marca depois de chamar, o botao apaga e
 * para de pedir acao enquanto o lead nao responde. Para chamar de novo,
 * desmarca.
 */

/**
 * Nome acessivel e `title` da caixa. Marcada, diz QUANDO -- e o que responde
 * "ja faz quanto tempo que eu chamei?" sem abrir o lead. `chamadoEm` falta no
 * instante entre o clique e o refresh trazer o carimbo do banco.
 */
export function rotuloCaixaChamado(marcado: boolean, chamadoEm: string | null): string {
  if (!marcado) return "Marcar como já chamado no WhatsApp";
  const quando = chamadoEm ? ` em ${dataHoraLocal(chamadoEm)}` : "";
  return `Já chamado no WhatsApp${quando}. Desmarque para chamar de novo.`;
}
