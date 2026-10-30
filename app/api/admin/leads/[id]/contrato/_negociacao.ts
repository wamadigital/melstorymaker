import { ErroNegociacaoCasamento, resolverNegociacaoCasamento } from "@/lib/contrato/negociacao-casamento";
import type { DadosContrato } from "@/lib/contrato/tipos";
import { Recusa, contextoDeMontagem, type LeadDoContrato } from "./_comum";

/**
 * A categoria e a arte vêm do lead do banco. Metadados enviados pelo navegador
 * não podem habilitar a negociação em contratos de outras categorias.
 *
 * Rascunhos legados continuam podendo ser salvos antes de completar os dados
 * que identificam a arte (por exemplo, a idade de um aniversariante).
 */
export function negociarComContextoDoLead(dados: DadosContrato, lead: LeadDoContrato): DadosContrato {
  if (!dados.negociacaoCasamento) return dados;
  try {
    return resolverNegociacaoCasamento(dados, contextoDeMontagem(lead));
  } catch (erro) {
    if (erro instanceof ErroNegociacaoCasamento) throw new Recusa(422, erro.message);
    throw erro;
  }
}
