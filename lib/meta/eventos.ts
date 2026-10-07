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
 * - `PageView`: toda pagina com o Pixel, no snippet. Esta aqui so porque
 *   tambem ganha copia pelo servidor (`COPIAVEIS`).
 *
 * `Contact` leva `canal` (`whatsapp` ou `email`): a porta do formulario e o
 * rodape da LP sao WhatsApp; o e-mail do rodape tambem e contato.
 */
export const EVENTO = {
  pagina: "PageView",
  contato: "Contact",
  lead: "Lead",
  submit: "SubmitApplication",
  conteudo: "ViewContent",
} as const;

/**
 * Eventos PERSONALIZADOS da LP `/casamento` (`rastrearComCopia`). Pedido do
 * owner em 05/10/2026: leitura de TODO o caminho de quem chega pelo anuncio --
 * entrou, rolou, viu, clicou --, para publico de remarketing, diagnostico do
 * criativo e conversao personalizada no Gerenciador. Ficam na Meta; nenhum
 * painel nosso le isso (regra 8).
 *
 * - `CliqueCTA` `{pagina, posicao}`: tocou num botao que leva ao formulario.
 *   Sai logo antes da navegacao; o `cta=` na URL do formulario continua sendo
 *   a prova que sempre chega (PageView do formulario).
 * - `AssistiuReel` `{reel, marco}`: abriu um Reel em tela cheia (`abriu`),
 *   passou da metade (`metade`) e chegou ao fim (`fim`, 95%).
 * - `RolouPagina` `{pagina, profundidade}`: 25, 50, 75 e 90% da pagina.
 * - `ViuSecao` `{pagina, secao}`: metade da secao na tela (ou meia tela dela,
 *   nas mais altas que a tela). As secoes sao o `data-secao` da pagina.
 * - `TempoNaPagina` `{pagina, segundos}`: 15, 30, 60 e 120 s com a aba VISIVEL.
 * - `AbriuDuvida` `{pagina, pergunta}`: abriu uma pergunta do FAQ.
 * - `CliqueLink` `{pagina, destino}`: tocou num link de saida que nao e
 *   contato (o Instagram da Mel). WhatsApp e e-mail sao `Contact`.
 *
 * Os de marco (`RolouPagina`, `ViuSecao`, `TempoNaPagina`, `AbriuDuvida`, e
 * `AssistiuReel` por Reel e marco) disparam UMA vez por visita. Os de clique
 * (`CliqueCTA`, `CliqueLink`, e o `Contact` do rodape) disparam a cada toque:
 * cada um e uma ida.
 */
export const EVENTO_LP = {
  cliqueCta: "CliqueCTA",
  assistiuReel: "AssistiuReel",
  rolou: "RolouPagina",
  viuSecao: "ViuSecao",
  tempo: "TempoNaPagina",
  abriuDuvida: "AbriuDuvida",
  cliqueLink: "CliqueLink",
} as const;

/**
 * Do formulario, entre o PageView e o `Lead`: `IniciouOrcamento`
 * `{content_category}` quando a pessoa entra no fluxo do orcamento (escolheu a
 * categoria, ou a porta "Quero um orcamento" no modo casamento). E o degrau
 * que mostra quem comecou e parou antes de deixar o WhatsApp.
 */
export const EVENTO_FORMULARIO = {
  iniciouOrcamento: "IniciouOrcamento",
} as const;

/**
 * O que o navegador pode pedir para o servidor COPIAR pela Conversions API
 * (`/api/meta/eventos`), e os unicos parametros que cada um leva. A copia sai
 * com o mesmo `event_id` do Pixel, e a Meta deduplica: quem tem bloqueador, ou
 * navegador que corta cookie de terceiro, continua contado.
 *
 * `Lead` e `SubmitApplication` NAO estao aqui de proposito: ja tem copia
 * propria nas rotas do lead, com id deterministico e o telefone e o e-mail
 * com hash. Aceita-los nesta rota publica seria deixar qualquer um fabricar
 * lead no Pixel com um POST.
 */
export const COPIAVEIS: Readonly<Record<string, readonly string[]>> = {
  [EVENTO.pagina]: [],
  [EVENTO.conteudo]: ["content_category", "content_name"],
  [EVENTO.contato]: ["content_category", "canal"],
  [EVENTO_LP.cliqueCta]: ["pagina", "posicao"],
  [EVENTO_LP.assistiuReel]: ["reel", "marco"],
  [EVENTO_LP.rolou]: ["pagina", "profundidade"],
  [EVENTO_LP.viuSecao]: ["pagina", "secao"],
  [EVENTO_LP.tempo]: ["pagina", "segundos"],
  [EVENTO_LP.abriuDuvida]: ["pagina", "pergunta"],
  [EVENTO_LP.cliqueLink]: ["pagina", "destino"],
  [EVENTO_FORMULARIO.iniciouOrcamento]: ["content_category"],
};

/** Teto de eventos por envio, dos dois lados (a fila do navegador e a rota). */
export const MAX_COPIAS_POR_LOTE = 25;

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
  // `esfriou` fica de fora: e o sistema que move o lead para la depois de uma
  // semana parado (lib/admin/esfriar.ts), nao uma decisao da Mel nem do lead.
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
