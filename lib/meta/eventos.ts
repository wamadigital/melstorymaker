// Mapa de eventos do Meta Pixel / Conversions API. Sem "server-only": o
// formulario usa os mesmos nomes e ids no navegador, e e essa igualdade que faz
// a Meta deduplicar o evento que chega pelos dois caminhos (ver `idEvento`).
import type { Status } from "@/lib/form/types";

/**
 * Eventos que o LEAD dispara, no formulario e na LP. Todos PADRAO da Meta: aparecem
 * como coluna no Gerenciador de Anuncios e servem de meta de otimizacao sem
 * conversao personalizada.
 *
 * - `Contact`: tocou em "Falar com a Mel" na abertura (a porta da esquerda).
 * - `Lead`: respondeu o WhatsApp e apertou OK -- e o momento em que o lead
 *   NASCE no banco (CLAUDE.md 5d). Lead e ter como falar com a pessoa, nao
 *   terminar o formulario; o evento segue a mesma definicao.
 * - `SubmitApplication`: terminou o formulario (`incompleto` ->
 *   `aguardando_revisao`), o pedido de proposta completo.
 * - `ViewContent`: abriu a LP `/casamento` (disparado junto com o PageView,
 *   pelo `PixelMeta`). Padrao, serve de meta de otimizacao do anuncio.
 */
export const EVENTO = {
  contato: "Contact",
  lead: "Lead",
  submit: "SubmitApplication",
  conteudo: "ViewContent",
} as const;

/**
 * Eventos PERSONALIZADOS da LP `/casamento` (`rastrearPersonalizado`, so no
 * navegador). Existem para publico de remarketing e diagnostico do anuncio.
 *
 * - `CliqueCTA` `{pagina, posicao}`: tocou num botao que leva ao formulario.
 *   Sai por imagem logo antes da navegacao e pode se perder; a conversao do
 *   clique, no Gerenciador, se monta no PageView do formulario com
 *   `evento=casamento` na URL, que sempre chega.
 * - `AssistiuReel` `{reel, marco}`: abriu um Reel em tela cheia (`abriu`) e
 *   passou da metade (`metade`).
 */
export const EVENTO_LP = {
  cliqueCta: "CliqueCTA",
  assistiuReel: "AssistiuReel",
} as const;

/**
 * Eventos do QUADRO: a Mel move o cartao e o lead nao esta na pagina, entao
 * estes saem so pelo servidor (Conversions API).
 *
 * Personalizados, e nao `Purchase`, de proposito: `Purchase` exige valor e
 * moeda, e este sistema nao sabe quanto o cliente fechou (regra 6: sem logica
 * de preco). Mandar `Purchase` com valor inventado estragaria o ROAS de
 * qualquer campanha. Para virarem coluna no Gerenciador, cria-se uma conversao
 * personalizada em cima de cada um.
 *
 * `incompleto` e `aguardando_revisao` nao estao aqui: nascem de acao do proprio
 * lead e ja tem evento (`Lead` e `SubmitApplication`), disparado nas rotas
 * publicas. Voltar um cartao para revisao e organizacao de trabalho da Mel, nao
 * fato de funil.
 */
export const EVENTO_DO_STATUS: Partial<Record<Status, string>> = {
  enviado: "PropostaEnviada",
  virou_cliente: "VirouCliente",
  perdido: "LeadPerdido",
};

/**
 * Id deterministico por lead e por etapa. Dois usos:
 *
 * 1. Deduplicacao navegador x servidor: `Lead` e `SubmitApplication` saem pelo
 *    Pixel E pela Conversions API. A Meta conta um so quando nome + id batem.
 * 2. Idempotencia: a Mel reenviar o e-mail, ou tirar e devolver o cartao de
 *    "Enviado", repete o mesmo id e a Meta descarta a copia (janela de 48h).
 */
export function idEvento(etapa: "lead" | "submit" | Status, leadId: string): string {
  return `${etapa}_${leadId}`;
}
