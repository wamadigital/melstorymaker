import type { ParteMensagem } from "./lembretes-proposta";

export const TIPO_PROPOSTA_INICIAL = "proposta_inicial_15m" as const;
export const ESPERA_PROPOSTA_MS = 15 * 60 * 1000;
const NOME = /^[\p{L}\p{M}]+(?:[ '\u2019.-][\p{L}\p{M}]+)*$/u;
const LINK = /^https:\/\/[^\s/?#\\@]+\/p\/[a-z0-9]{4}$/;

/** Nome de quem respondeu, já padronizado; não usa o nome do casal/evento. */
export function sequenciaPropostaInicial(nome: string, link: string): ParteMensagem[] {
  if (nome !== nome.trim() || nome.length > 120 || !NOME.test(nome) || !LINK.test(link)) {
    throw new Error("snapshot_proposta_inicial_invalido");
  }
  return [
    { message: `Oi, ${nome} tudo bem? Aqui é a Mel Storymaker ✨`, delayBeforeSeconds: 0 },
    { message: "Você solicitou um orçamento através do meu site.", delayBeforeSeconds: 3 },
    { message: `Segue a sua proposta:\n🤍 ${link}`, delayBeforeSeconds: 2 },
    { message: "Qualquer dúvida, é só me chamar. Ok?\nFico à disposição para te ajudar no que precisar!", delayBeforeSeconds: 4 },
  ];
}

export function validarSequenciaPropostaInicial(sequencia: unknown, mensagem: string): ParteMensagem[] {
  if (!Array.isArray(sequencia) || sequencia.length !== 4) throw new Error("snapshot_proposta_inicial_invalido");
  const saudacao = typeof sequencia[0]?.message === "string"
    ? /^Oi, (.+) tudo bem\? Aqui é a Mel Storymaker ✨$/u.exec(sequencia[0].message) : null;
  const link = typeof sequencia[2]?.message === "string"
    ? /^Segue a sua proposta:\n🤍 (.+)$/u.exec(sequencia[2].message) : null;
  if (!saudacao || !link) throw new Error("snapshot_proposta_inicial_invalido");
  const aprovadas = sequenciaPropostaInicial(saudacao[1], link[1]);
  if (!aprovadas.every((parte, i) => sequencia[i]?.message === parte.message &&
    sequencia[i]?.delayBeforeSeconds === parte.delayBeforeSeconds &&
    Object.keys(sequencia[i]).length === 2) ||
    aprovadas.map(p => p.message).join("\n\n") !== mensagem) {
    throw new Error("snapshot_proposta_inicial_invalido");
  }
  return aprovadas;
}

export function propostaInicialAtiva(ambiente: Record<string, string | undefined>): boolean {
  const ativa = (v: string | undefined) => v?.toLowerCase() === "true" || v === "1";
  return ativa(ambiente.WHATSAPP_AUTOMACAO_ATIVA) && ativa(ambiente.WHATSAPP_PROPOSTA_INICIAL_ATIVA);
}
