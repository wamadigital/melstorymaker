import { arvore, normalizarOpcoes, passoPorId } from "@/lib/form/engine";
import type { Categoria, Status } from "@/lib/form/types";
import type { AtalhoStatus } from "@/lib/admin/status";

// Rotulos de categoria saem do proprio arvore.json: o painel e o formulario
// nunca podem divergir no nome de uma categoria.
const CATEGORIA_POR_VALOR = new Map(
  normalizarOpcoes(arvore.categoria.opcoes).map((o) => [o.valor, o.rotulo]),
);

export function rotuloCategoria(categoria: Categoria): string {
  return CATEGORIA_POR_VALOR.get(categoria) ?? categoria;
}

/**
 * "Novo" e nao "Incompleto": e o nome da primeira coluna do quadro, e para a Mel
 * o lead que parou no meio do formulario e simplesmente um lead novo para
 * perseguir. O valor do enum continua `incompleto` de proposito -- ele significa
 * "o autosave publico ainda aceita escrita neste lead", e e nesse sentido que os
 * guards de /api/leads o comparam.
 */
export const ROTULO_STATUS: Record<Status, string> = {
  incompleto: "Novo",
  aguardando_revisao: "Aguardando revisão",
  enviado: "Enviado",
  virou_cliente: "Virou cliente",
  esfriou: "Esfriou",
  perdido: "Lead perdido",
};

/**
 * Rotulo de UMA palavra, so para a faixa de destinos do arraste no celular
 * (`FaixaDestinos`): com seis colunas, cada chip tem ~52px por dentro em 360px e
 * "Aguardando" sozinho mede ~57px. Em todo o resto vale `ROTULO_STATUS`.
 */
export const ROTULO_CURTO_STATUS: Record<Status, string> = {
  incompleto: "Novo",
  aguardando_revisao: "Revisão",
  enviado: "Enviado",
  virou_cliente: "Cliente",
  esfriou: "Esfriou",
  perdido: "Perdido",
};

/** Linha de apoio no cabecalho da coluna e no estado vazio dela. */
export const DESCRICAO_COLUNA: Record<Status, string> = {
  incompleto: "Ainda preenchendo o formulário",
  aguardando_revisao: "Prontos para gerar a proposta",
  enviado: "Proposta já entregue",
  virou_cliente: "Fechou com a Mel",
  esfriou: "Uma semana sem resposta",
  perdido: "Cobrado e sem retorno",
};

/**
 * Badge por status. O emerald saiu de `enviado` e foi para `virou_cliente`:
 * verde e a cor do desfecho, e "enviado" e transito, nao chegada.
 *
 * `aguardando_revisao` perdeu o preto solido que tinha na lista antiga -- ali
 * ele era o unico sinal de "olha aqui" numa tela sem cor; dentro de um quadro
 * colorido ele briga com a coluna, e ambar carrega "pendente" melhor.
 */
export const CLASSE_STATUS: Record<Status, string> = {
  incompleto: "bg-slate-100 text-slate-700 border-slate-200",
  aguardando_revisao: "bg-amber-100 text-amber-900 border-amber-200",
  enviado: "bg-sky-100 text-sky-900 border-sky-200",
  virou_cliente: "bg-emerald-100 text-emerald-900 border-emerald-200",
  esfriou: "bg-zinc-100 text-zinc-700 border-zinc-200",
  perdido: "bg-stone-100 text-stone-700 border-stone-200",
};

/**
 * Tema da coluna do quadro. `Record<Status, ...>` de proposito, igual aos dois
 * mapas acima: valor novo no enum quebra o build aqui ate alguem escolher a cor.
 *
 * As classes sao LITERAIS. Nunca montar por template (`bg-${cor}-50`): o scanner
 * do Tailwind v4 nao ve string interpolada e a classe some do CSS gerado.
 *
 * Cor no painel interno e excecao consciente a paleta de duas cores do site --
 * ver a secao de identidade visual no CLAUDE.md.
 */
export const TEMA_COLUNA: Record<
  Status,
  { fundo: string; corpo: string; titulo: string; ponto: string; alvo: string; barra: string }
> = {
  incompleto: {
    fundo: "bg-slate-50",
    corpo: "bg-slate-50/50",
    titulo: "text-slate-700",
    ponto: "bg-slate-400",
    alvo: "ring-slate-300",
    barra: "bg-slate-300",
  },
  aguardando_revisao: {
    fundo: "bg-amber-50",
    corpo: "bg-amber-50/50",
    titulo: "text-amber-800",
    ponto: "bg-amber-500",
    alvo: "ring-amber-300",
    barra: "bg-amber-400",
  },
  enviado: {
    fundo: "bg-sky-50",
    corpo: "bg-sky-50/50",
    titulo: "text-sky-800",
    ponto: "bg-sky-500",
    alvo: "ring-sky-300",
    barra: "bg-sky-400",
  },
  virou_cliente: {
    fundo: "bg-emerald-50",
    corpo: "bg-emerald-50/50",
    titulo: "text-emerald-800",
    ponto: "bg-emerald-500",
    alvo: "ring-emerald-300",
    barra: "bg-emerald-400",
  },
  // Esfriou: cinza FRIO (zinc), para nao se confundir com o stone de "Lead
  // perdido", logo ao lado, nem com o slate de "Novo". O lead chega aqui
  // sozinho depois de uma semana parado (ver lib/admin/esfriar.ts) e ainda pode
  // voltar; o cartao que pede "Ultima tentativa" usa a mesma tinta da coluna.
  esfriou: {
    fundo: "bg-zinc-100",
    corpo: "bg-zinc-50/50",
    titulo: "text-zinc-700",
    ponto: "bg-zinc-400",
    alvo: "ring-zinc-300",
    barra: "bg-zinc-300",
  },
  // Stone e nao vermelho, de proposito: o vermelho ja e do cartao que PRECISA de
  // cobranca, dentro de "Enviado". A raia de perdido e o lugar onde o lead para
  // de pedir atencao -- pintar as duas coisas de vermelho faria o quadro gritar
  // no ponto em que ele deveria silenciar.
  perdido: {
    fundo: "bg-stone-100",
    corpo: "bg-stone-50/50",
    titulo: "text-stone-600",
    ponto: "bg-stone-400",
    alvo: "ring-stone-300",
    barra: "bg-stone-300",
  },
};

/**
 * O que cada botao de mover do detalhe do lead diz. "Lead perdido" e o nome
 * que o owner deu ao botao do canto (07/10/2026), o mesmo da coluna.
 */
export const ROTULO_ATALHO: Record<AtalhoStatus, string> = {
  enviado: "Marcar como enviado",
  virou_cliente: "Marcar como cliente",
  perdido: "Lead perdido",
};

/**
 * O botao do proximo passo e VERDE SOLIDO, seja qual for o destino (pedido do
 * owner em 07/10/2026): verde quer dizer "o que vem a seguir", e nao a cor da
 * coluna de destino -- os botoes claros na tinta de cada coluna liam como selo,
 * nao como botao. Emerald-700 e nao 600: texto branco de 14px sobre o 600 fica
 * em 3,7:1 e reprova no AA; sobre o 700, 5,5:1. Classes LITERAIS, pelo mesmo
 * motivo de `TEMA_COLUNA`.
 */
export const CLASSE_PROXIMO_PASSO = "bg-emerald-700 text-white hover:bg-emerald-800";

/** "Lead perdido", no canto do cabecalho: contorno na tinta da coluna (stone). */
export const CLASSE_PERDIDO = "border-stone-300 text-stone-700 hover:bg-stone-100 hover:text-stone-800";

/**
 * "Parou em: Local da festa" para os leads incompletos (RF-09). Sem isso a Mel
 * so ve "incompleto" e nao sabe o quanto falta para o follow-up valer a pena.
 */
export function rotuloPasso(categoria: Categoria, passoId: string | null): string | null {
  if (!passoId) return null;
  return passoPorId(categoria, passoId)?.pergunta ?? null;
}

/** Pergunta correspondente a uma chave do jsonb, para rotular o campo no painel. */
export function rotuloResposta(categoria: Categoria, chave: string): string {
  return passoPorId(categoria, chave)?.pergunta ?? chave;
}
