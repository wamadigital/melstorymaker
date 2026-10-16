const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AUTOMATICO = new RegExp(`^automaticas/(${UUID})/${UUID}\\.pdf$`, "i");

/** O link público permanece estável; cada geração automática tem objeto próprio. */
export function arquivoProposta(leadId: string, caminho?: string | null): string {
  if (!new RegExp(`^${UUID}$`, "i").test(leadId)) throw new Error("arquivo_proposta_invalido");
  if (caminho == null) return `${leadId}.pdf`;
  if (AUTOMATICO.exec(caminho)?.[1].toLowerCase() !== leadId.toLowerCase()) throw new Error("arquivo_proposta_invalido");
  return caminho;
}
