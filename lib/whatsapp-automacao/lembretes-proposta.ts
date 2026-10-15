/** Textos e pausas aprovados pelo owner em 15/10/2026. Sem personalização. */
export type TipoLembreteProposta = "lembrete_proposta_7d" | "lembrete_proposta_30d";
export type ParteMensagem = { message: string; delayBeforeSeconds: number };

const APROVADAS = {
  7: [
    { message: "Olá, como vai?!", delayBeforeSeconds: 0 },
    { message: "Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei.", delayBeforeSeconds: 2 },
    { message: null, delayBeforeSeconds: 3 },
    { message: "Se ficou alguma dúvida, me chama que eu te explico. ✨", delayBeforeSeconds: 2 },
  ],
  30: [
    { message: "Oi! Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei. 🤍", delayBeforeSeconds: 0 },
    { message: null, delayBeforeSeconds: 4 },
    { message: "Se ainda fizer sentido, é só me chamar que a gente conversa.", delayBeforeSeconds: 4 },
    { message: "Se não for o momento, me avise por gentileza, para que eu possa me organizar por aqui 🙏", delayBeforeSeconds: 3 },
    { message: "Desde já, agradeço ✨", delayBeforeSeconds: 5 },
  ],
} as const;

export function linkPropostaValido(texto: string): boolean {
  if (!/^https:\/\/[^\s\\@?#]+$/i.test(texto)) return false;
  try {
    const url = new URL(texto);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function sequenciaLembreteProposta(marco: 7 | 30, link: string): ParteMensagem[] {
  if (!linkPropostaValido(link)) throw new Error("proposta_ausente");
  return APROVADAS[marco].map((parte) => ({ ...parte, message: parte.message ?? link }));
}

export function validarSequenciaProposta(tipo: TipoLembreteProposta, sequencia: unknown, mensagem: string): ParteMensagem[] {
  const marco = tipo === "lembrete_proposta_7d" ? 7 : 30;
  if (!Array.isArray(sequencia) || sequencia.length !== APROVADAS[marco].length) throw new Error("snapshot_proposta_invalido");
  const indiceLink = marco === 7 ? 2 : 1;
  const link: unknown = sequencia[indiceLink]?.message;
  if (typeof link !== "string") throw new Error("snapshot_proposta_invalido");
  const aprovadas = sequenciaLembreteProposta(marco, link);
  if (!aprovadas.every((parte, i) => sequencia[i]?.message === parte.message &&
    sequencia[i]?.delayBeforeSeconds === parte.delayBeforeSeconds) ||
    aprovadas.map((p) => p.message).join("\n\n") !== mensagem) throw new Error("snapshot_proposta_invalido");
  return aprovadas;
}

export function lembretesPropostaAtivos(ambiente: Record<string, string | undefined>): boolean {
  const ativa = (valor: string | undefined) => valor?.toLowerCase() === "true" || valor === "1";
  return ativa(ambiente.WHATSAPP_AUTOMACAO_ATIVA) && ativa(ambiente.WHATSAPP_LEMBRETE_PROPOSTA_ATIVO);
}
