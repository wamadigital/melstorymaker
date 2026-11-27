import "server-only";
import type { ModeloCampanha, OpcoesCampanha } from "./contrato";

type Env = Record<string, string | undefined>;

export function configuracaoCampanhas(e: Env = process.env) {
  const token = e.WHATSAPP_CAMPANHAS_META_TOKEN;
  const conta = e.WHATSAPP_CAMPANHAS_META_WABA_ID;
  const telefone = e.WHATSAPP_CAMPANHAS_META_PHONE_ID;
  const versao = e.WHATSAPP_CAMPANHAS_META_VERSAO;
  const limite = Number(e.WHATSAPP_CAMPANHAS_LIMITE_24H);
  const cadencia = Number(e.WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS ?? 60);
  const meta = token && conta && /^\d+$/.test(conta) && telefone && /^\d+$/.test(telefone)
    && versao && /^v\d+\.\d+$/.test(versao)
    && Number.isSafeInteger(limite) && limite > 0 && limite <= 100_000
    && Number.isInteger(cadencia) && cadencia >= 10 && cadencia <= 86_400
    ? { token, conta, telefone, base: `https://graph.facebook.com/${versao}`, limite, cadencia }
    : null;
  const workerAtivo = e.WHATSAPP_CAMPANHAS_WORKER_ATIVO === "true"
    && (e.WHATSAPP_WORKER_TOKEN?.length ?? 0) >= 32;
  const opcoes: OpcoesCampanha = { workerAtivo, provedorConfigurado: !!meta, cadencia: meta?.cadencia ?? 60 };
  return { opcoes, meta };
}

type Meta = NonNullable<ReturnType<typeof configuracaoCampanhas>["meta"]>;
type ComponenteMeta = { type?: string; format?: string; text?: string };
type ModeloMeta = { name?: string; language?: string; category?: string; status?: string; components?: ComponenteMeta[] };

function modeloAprovado(m: ModeloMeta): ModeloCampanha | null {
  if (!m.name || !m.language || m.status !== "APPROVED" || m.category !== "MARKETING") return null;
  const componentes = m.components ?? [];
  const corpo = componentes.find(({ type }) => type === "BODY")?.text?.trim();
  const header = componentes.find(({ type }) => type === "HEADER");
  const imagem = header?.format === "IMAGE";
  if (!corpo || corpo.length > 1024 || /\{\{/.test(corpo) || (header && !imagem)
    || componentes.length !== (imagem ? 2 : 1)) return null;
  return { nome: m.name, idioma: m.language, texto: corpo, imagem };
}

export async function modelosAprovados(meta: Meta, nome?: string, http = fetch): Promise<ModeloCampanha[]> {
  const prazo = AbortSignal.timeout(nome ? 10_000 : 35_000);
  const modelos: ModeloCampanha[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${meta.base}/${meta.conta}/message_templates`);
    url.searchParams.set("fields", "name,language,status,category,components");
    url.searchParams.set("limit", "100");
    if (nome) url.searchParams.set("name", nome);
    if (cursor) url.searchParams.set("after", cursor);
    const resposta = await http(url, { headers: { Authorization: `Bearer ${meta.token}` },
      cache: "no-store", redirect: "error", signal: prazo });
    if (!resposta.ok) throw new Error("Não consegui consultar os modelos aprovados na Meta.");
    const corpo = await resposta.json() as { data: ModeloMeta[]; paging?: { next?: string; cursors?: { after?: string } } };
    for (const modelo of corpo.data) {
      const aprovado = modeloAprovado(modelo);
      if (aprovado) modelos.push(aprovado);
    }
    if (corpo.paging?.next && (!corpo.paging.cursors?.after || corpo.paging.cursors.after === cursor)) {
      throw new Error("A Meta devolveu uma paginação inválida.");
    }
    cursor = corpo.paging?.next ? corpo.paging.cursors?.after : undefined;
  } while (cursor);
  return modelos;
}

export type ResultadoCampanha = {
  status: "enviado" | "simulado" | "falha" | "ignorado" | "repetir";
  motivo?: string;
  provedorId?: string;
  espera?: number;
};

export async function enviarModeloCampanha(
  meta: Meta, telefone: string, modelo: ModeloCampanha, imagem: string | undefined, http = fetch,
): Promise<ResultadoCampanha> {
  if (modelo.imagem !== !!imagem) return { status: "falha", motivo: "modelo_imagem_incompativel" };
  try {
    const resposta = await http(`${meta.base}/${meta.telefone}/messages`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${meta.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: telefone, type: "template",
        template: {
          name: modelo.nome, language: { code: modelo.idioma },
          ...(imagem ? { components: [{ type: "header", parameters: [{ type: "image", image: { link: imagem } }] }] } : {}),
        },
      }),
    });
    if (resposta.status >= 500) return { status: "falha", motivo: "resultado_indeterminado" };
    const payload = await resposta.json().catch(() => null);
    const codigo = payload?.error?.code;
    if (resposta.status === 429 || (!resposta.ok && codigo === 130429)) {
      const retryAfter = resposta.headers.get("Retry-After");
      const segundos = /^\d+$/.test(retryAfter ?? "") ? Number(retryAfter)
        : Math.ceil((Date.parse(retryAfter ?? "") - Date.now()) / 1000);
      return { status: "repetir", motivo: "limite_provedor",
        espera: Number.isFinite(segundos) ? Math.max(60, Math.min(segundos, 2_000_000_000)) : 60 };
    }
    if (!resposta.ok) {
      return { status: "falha", motivo: `meta_${resposta.status}${Number.isSafeInteger(codigo) ? `_${codigo}` : ""}` };
    }
    const id = payload?.messages?.[0]?.id;
    return typeof id === "string" && id.length > 0
      ? { status: "enviado", provedorId: id }
      : { status: "falha", motivo: "resultado_indeterminado" };
  } catch {
    return { status: "falha", motivo: "resultado_indeterminado" };
  }
}
