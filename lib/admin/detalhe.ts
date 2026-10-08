import type { Lead } from "@/lib/form/types";
import type { RegistroContrato } from "@/lib/contrato/tipos";

type ResultadoLead = { data: Lead | null; error: unknown | null };

type Leituras = {
  lerLead: () => PromiseLike<ResultadoLead>;
  lerContrato: () => PromiseLike<RegistroContrato | null>;
};

type ResultadoDetalhe =
  | { estado: "erro"; erro: unknown }
  | { estado: "ausente" }
  | {
      estado: "ok";
      lead: Lead;
      registroContrato: RegistroContrato | null;
      falhaAoLerContrato: boolean;
      erroContrato: unknown | null;
    };

/**
 * Leituras independentes em paralelo. Falha de infraestrutura não é lead
 * inexistente; contrato ilegível também não é um rascunho novo para editar.
 * O IO entra por função para verificar os dois casos sem banco de produção.
 */
export async function carregarDetalhe({ lerLead, lerContrato }: Leituras): Promise<ResultadoDetalhe> {
  const [lead, contrato] = await Promise.allSettled([
    Promise.resolve().then(lerLead),
    Promise.resolve().then(lerContrato),
  ]);

  if (lead.status === "rejected") return { estado: "erro", erro: lead.reason };
  if (lead.value.error) return { estado: "erro", erro: lead.value.error };
  if (!lead.value.data) return { estado: "ausente" };

  return {
    estado: "ok",
    lead: lead.value.data,
    registroContrato: contrato.status === "fulfilled" ? contrato.value : null,
    falhaAoLerContrato: contrato.status === "rejected",
    erroContrato: contrato.status === "rejected" ? contrato.reason : null,
  };
}
