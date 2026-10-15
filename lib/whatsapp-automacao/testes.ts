/** Escopo temporario de teste autorizado pelo owner; o banco continua autorizando o envio. */
export const TESTE_OWNER_EXPIRA_EM = "2026-10-17T18:00:00Z";
export const TESTE_OWNER_DESTINATARIO = "5519988763916";
export const TESTES_OWNER_MARCOS: Readonly<Record<string, 7 | 30>> = Object.freeze({
  "01b985e2-6bff-4e9c-bb5e-2f1cc280edf7": 7,
  "d459193f-9e7c-4b2c-995d-7f829a0936bd": 7,
  "13e49741-9d35-404c-ae54-42fe93e55c66": 7,
  "abf88ff2-ea34-4e32-994d-f7dc75df599b": 30,
  "9263d823-d059-4e0a-b759-9184035dec89": 30,
});
const EXPIRA_MS = Date.parse(TESTE_OWNER_EXPIRA_EM);
function dentroDoPrazo(agoraMs: number): boolean {
  return Number.isFinite(agoraMs) && agoraMs < EXPIRA_MS;
}
function numeroOwner(valor: unknown): boolean {
  if (typeof valor !== "string" || !/^[+\d\s().-]+$/.test(valor)) return false;
  const digitos = valor.replace(/\D/g, "");
  return digitos === "19988763916" || digitos === TESTE_OWNER_DESTINATARIO;
}
/** Apenas apresentacao do botao: nenhum parametro recebido do browser autoriza teste. */
export function marcoTesteOwner(
  lead: { leadId: unknown; nome: unknown; destinatario: unknown },
  agoraMs = Date.now(),
): 7 | 30 | null {
  if (!dentroDoPrazo(agoraMs) || lead.nome !== "TESTE HENRIQUE" ||
    !numeroOwner(lead.destinatario) || typeof lead.leadId !== "string") return null;
  return Object.hasOwn(TESTES_OWNER_MARCOS, lead.leadId) ? TESTES_OWNER_MARCOS[lead.leadId] : null;
}
/** Reforca o marcador privado produzido pelo SQL; nao e uma alternativa a allowlist do banco. */
export function testeOwnerPropostaValido(
  entrada: { leadId: unknown; recipient: unknown; tipo: unknown; expiresAt: unknown },
  agoraMs = Date.now(),
): boolean {
  if (!dentroDoPrazo(agoraMs) || entrada.recipient !== TESTE_OWNER_DESTINATARIO ||
    typeof entrada.leadId !== "string" || typeof entrada.expiresAt !== "string" ||
    Date.parse(entrada.expiresAt) !== EXPIRA_MS || !Object.hasOwn(TESTES_OWNER_MARCOS, entrada.leadId)) return false;
  return entrada.tipo === (TESTES_OWNER_MARCOS[entrada.leadId] === 7
    ? "lembrete_proposta_7d" : "lembrete_proposta_30d");
}
