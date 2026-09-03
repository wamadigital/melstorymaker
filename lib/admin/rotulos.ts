import { arvore, normalizarOpcoes, passoPorId } from "@/lib/form/engine";
import type { Categoria, Status } from "@/lib/form/types";

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
  perdido: "Lead perdido",
};

/** Linha de apoio no cabecalho da coluna e no estado vazio dela. */
export const DESCRICAO_COLUNA: Record<Status, string> = {
  incompleto: "Ainda preenchendo o formulário",
  aguardando_revisao: "Prontos para gerar a proposta",
  enviado: "Proposta já entregue",
  virou_cliente: "Fechou com a Mel",
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
