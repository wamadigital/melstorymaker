import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { normalizarNumero } from "@/lib/whatsapp";
import type { Origem, Rastreio } from "@/lib/meta/rastreio";

/**
 * Conversions API da Meta: o lado servidor do Pixel.
 *
 * Existe por dois motivos que o Pixel do navegador nao cobre:
 * 1. Os eventos do QUADRO (proposta enviada, virou cliente, perdido) acontecem
 *    quando a Mel move o cartao -- o lead nao esta na pagina.
 * 2. `Lead` e `SubmitApplication` saem TAMBEM daqui, com o mesmo `event_id` do
 *    navegador: quem tem bloqueador de anuncio continua sendo contado, e a
 *    Meta deduplica quem foi contado duas vezes. Os outros eventos do
 *    navegador (visita, rolagem, cliques) tambem, pela rota
 *    `/api/meta/eventos` -- ali a pessoa ainda e anonima, sem lead.
 *
 * Regras, no mesmo espirito da notificacao da Mel (`lib/notifica/`):
 * - Falha aqui NUNCA quebra o fluxo do lead nem o painel. Quem chama esta em
 *   after() (pos-resposta) e este modulo engole o erro com log.
 * - Sem META_PIXEL_ID + META_CAPI_TOKEN e no-op declarado no log: dev e preview
 *   funcionam sem conta nenhuma, e nao sujam o Pixel de producao.
 * - Dado pessoal so vai com hash SHA-256, como a Meta exige. `fbp`, `fbc`, ip e
 *   navegador vao crus -- sao identificadores tecnicos, e a Meta os recusa com
 *   hash.
 */

const VERSAO_GRAPH = "v26.0";
const RE_PIXEL = /^\d{8,20}$/;

export type Pessoa = Rastreio &
  Pick<Origem, "ip" | "userAgent"> & {
    /** Sem lead (visitante da LP, porta do WhatsApp): sai sem `external_id`. */
    leadId?: string;
    email?: string | null;
    whatsapp?: string | null;
    /** Nome de QUEM PREENCHEU (`nomeContato`), nunca o sujeito do evento. */
    nome?: string | null;
  };

export type EventoConversao = {
  nome: string;
  id: string;
  /**
   * `website` para tudo que nasce da visita do lead: os eventos do formulario E
   * os do quadro, que levam o navegador, o ip, o `fbp` e o `fbc` DO LEAD
   * guardados na criacao -- nunca os do request da Mel. O quadro vai como site
   * porque a conversao personalizada da Meta so aceita as fontes "Site" e "Loja
   * fisica" (ver `montarEventoDeStatus`, em `lib/meta/lead.ts`, e CLAUDE.md 8b).
   *
   * `system_generated` so como recurso para lead sem navegador guardado: a Meta
   * recusa evento de site sem `client_user_agent`, e tambem exige
   * `event_source_url` nele.
   */
  origem: "website" | "system_generated";
  url?: string;
  categoria?: string;
  /** Parametros do evento (`custom_data`), os mesmos que o Pixel mandou. */
  dados?: Record<string, string>;
  pessoa: Pessoa;
};

function sha256(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

/** Normalizacao da Meta antes do hash: minusculas, sem espaco nas pontas. */
function comHash(valor: string | null | undefined): string | undefined {
  const limpo = valor?.trim().toLowerCase();
  return limpo ? sha256(limpo) : undefined;
}

/** Primeiro nome, minusculo e sem pontuacao -- o formato de `fn` na Meta. Acento fica (UTF-8 e aceito). */
function primeiroNome(nome: string | null | undefined): string | undefined {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return primeiro.toLowerCase().replace(/[^\p{L}]/gu, "") || undefined;
}

/**
 * Monta o evento no formato da Graph API. Pura (o relogio entra por parametro)
 * para ser testada sem rede.
 */
export function montarEvento(e: EventoConversao, agoraMs: number) {
  const p = e.pessoa;
  // O banco guarda o telefone como o lead digitou, sem DDI; a Meta quer o
  // numero completo. `normalizarNumero` e a mesma regra do wa.me.
  const telefone = normalizarNumero(p.whatsapp);
  const nome = primeiroNome(p.nome);

  const usuario = {
    ...(p.leadId && { external_id: sha256(p.leadId) }),
    ...(p.email?.trim() && { em: comHash(p.email) }),
    ...(telefone && { ph: sha256(telefone) }),
    ...(nome && { fn: sha256(nome) }),
    // Todo lead da Mel e do Brasil; ajuda o casamento do telefone.
    country: sha256("br"),
    ...(p.fbp && { fbp: p.fbp }),
    ...(p.fbc && { fbc: p.fbc }),
    ...(p.ip && { client_ip_address: p.ip }),
    ...(p.userAgent && { client_user_agent: p.userAgent }),
  };

  return {
    event_name: e.nome,
    event_time: Math.floor(agoraMs / 1000),
    event_id: e.id,
    action_source: e.origem,
    ...(e.url && { event_source_url: e.url }),
    user_data: usuario,
    ...((e.categoria || e.dados) && {
      custom_data: { ...e.dados, ...(e.categoria && { content_category: e.categoria }) },
    }),
  };
}

type Config = { pixel: string; token: string; teste?: string };

/** null = desligada. Nunca lanca: env torta desliga a Meta, nao o sistema. */
export function configCapi(): Config | null {
  try {
    const pixel = env.META_PIXEL_ID?.trim();
    const token = env.META_CAPI_TOKEN?.trim();
    if (!pixel || !token || !RE_PIXEL.test(pixel)) return null;
    return { pixel, token, teste: env.META_CAPI_TEST_CODE?.trim() || undefined };
  } catch {
    return null;
  }
}

export async function enviarConversao(e: EventoConversao): Promise<void> {
  await enviarConversoes([e]);
}

/**
 * Varios eventos numa chamada so (a Graph API aceita ate 1000). E o caminho
 * das copias do navegador, que chegam em lote.
 */
export async function enviarConversoes(eventos: readonly EventoConversao[]): Promise<void> {
  if (!eventos.length) return;
  const nomes = eventos.map((e) => e.nome).join(", ");
  try {
    const config = configCapi();
    if (!config) {
      console.log(`[meta] Conversions API desligada, ${nomes} nao enviado`);
      return;
    }

    // `event_source_url` e obrigatorio em evento de site. Nos eventos do
    // formulario o Referer quase sempre existe; nos do quadro nunca (o request
    // e o da Mel). Em ambos a URL certa e a do formulario: e por onde o lead
    // entrou, e sem URL a regra das conversoes personalizadas ("URL contem
    // melstorymaker.com.br") nao casa.
    const agora = Date.now();
    const data = eventos.map((e) =>
      montarEvento(
        e.origem === "website" && !e.url ? { ...e, url: `${env.APP_URL.replace(/\/+$/, "")}/formulario` } : e,
        agora,
      ),
    );

    const r = await fetch(`https://graph.facebook.com/${VERSAO_GRAPH}/${config.pixel}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Token no corpo e nao na query: URL com segredo acaba em log de proxy.
      body: JSON.stringify({
        data,
        access_token: config.token,
        ...(config.teste && { test_event_code: config.teste }),
      }),
      // Timeout curto pelo mesmo motivo da notificacao: roda pos-resposta, mas
      // funcao pendurada em API lenta e custo e risco de estourar o teto.
      signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
      const corpo = await r.text().catch(() => "");
      console.error(`[meta] Conversions API recusou ${nomes} (HTTP ${r.status}): ${corpo.slice(0, 300)}`);
      return;
    }
    const ids = eventos.length === 1 ? ` (${eventos[0].id})` : ` (${eventos.length} eventos)`;
    console.log(`[meta] ${nomes} enviado${ids}${config.teste ? " [teste]" : ""}`);
  } catch (erro) {
    console.error(`[meta] falha ao enviar ${nomes} (o fluxo do lead NAO foi afetado)`, erro);
  }
}
