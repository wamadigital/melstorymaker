// Negociacao exclusiva do contrato de casamento. O catalogo e a proposta do
// lead nao mudam: cada opcao guarda seu rascunho e dados.servico representa
// somente a opcao atualmente selecionada, consumida pela montagem existente.

import { pacoteDoCatalogo, precoPacote } from "./catalogo";
import {
  negociacaoCasamentoSchema,
  opcaoNegociacaoCasamentoSchema,
  servicoSchema,
  type DadosContrato,
  type NegociacaoCasamento,
  type Servico,
} from "./tipos";

export const OPCOES_CASAMENTO = [
  { id: "opcao1", pacote: "Pacote Principal", rotulo: "Opção 1" },
  { id: "opcao2", pacote: "Pacote Real Time", rotulo: "Opção 2" },
] as const;

export type OpcaoCasamento = (typeof OPCOES_CASAMENTO)[number]["id"];

export class ErroNegociacaoCasamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroNegociacaoCasamento";
  }
}

export function opcaoCasamentoSelecionada(dados: DadosContrato): OpcaoCasamento | null {
  return OPCOES_CASAMENTO.find((opcao) => opcao.pacote === dados.servico.pacote)?.id ?? null;
}

function original(opcao: OpcaoCasamento, tabela: Servico["tabela"]): Servico {
  const pacote = OPCOES_CASAMENTO.find((item) => item.id === opcao)?.pacote;
  const catalogo = pacote ? pacoteDoCatalogo("casamento", pacote) : null;
  const preco = pacote ? precoPacote("casamento", tabela, pacote) : null;
  if (!pacote || !catalogo || preco === null) {
    throw new ErroNegociacaoCasamento("Não consegui identificar esta opção de casamento.");
  }
  // parse clona o escopo: editar um rascunho nao modifica o catalogo global.
  return servicoSchema.parse({ tabela, pacote, valorPacote: preco, escopo: catalogo.escopo, adicionais: [], desconto: 0 });
}

function chave(valor: unknown): string {
  return JSON.stringify(valor, (_nome, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
}

function iguais(a: Servico, b: Servico): boolean {
  return chave(servicoSchema.parse(a)) === chave(servicoSchema.parse(b));
}

function novasOpcoes(tabela: Servico["tabela"]): NegociacaoCasamento {
  return {
    opcao1: { modo: "original", servico: original("opcao1", tabela), condicoes: "" },
    opcao2: { modo: "original", servico: original("opcao2", tabela), condicoes: "" },
  };
}

function efetivo(negociacao: NegociacaoCasamento, opcao: OpcaoCasamento): Servico {
  const rascunho = negociacao[opcao];
  return rascunho.modo === "personalizado"
    ? servicoSchema.parse(rascunho.servico)
    : original(opcao, rascunho.servico.tabela);
}

/** Inicializacao explicita pela UI de casamento; nao reescreve legados. */
export function iniciarNegociacaoCasamento(dados: DadosContrato): DadosContrato {
  if (dados.negociacaoCasamento) return dados;
  const opcao = opcaoCasamentoSelecionada(dados);
  // O antigo pacote "Personalizado" nao registra de qual opcao veio.
  // Preservar ate a Mel escolher uma das duas opcoes explicitamente.
  if (!opcao) return dados;
  const negociacao = novasOpcoes(dados.servico.tabela);
  negociacao[opcao] = {
    modo: iguais(dados.servico, negociacao[opcao].servico) ? "original" : "personalizado",
    servico: servicoSchema.parse(dados.servico),
    condicoes: "",
  };
  return { ...dados, negociacaoCasamento: negociacao };
}

export function selecionarOpcaoCasamento(dados: DadosContrato, opcao: OpcaoCasamento): DadosContrato {
  if (!OPCOES_CASAMENTO.some((item) => item.id === opcao)) {
    throw new ErroNegociacaoCasamento("Escolha a Opção 1 ou a Opção 2 do casamento.");
  }
  const inicial = iniciarNegociacaoCasamento(dados);
  const negociacao = inicial.negociacaoCasamento ?? novasOpcoes(dados.servico.tabela);
  return { ...inicial, negociacaoCasamento: negociacao, servico: efetivo(negociacao, opcao) };
}

function selecionada(dados: DadosContrato): { dados: DadosContrato; opcao: OpcaoCasamento; negociacao: NegociacaoCasamento } {
  const inicial = iniciarNegociacaoCasamento(dados);
  const opcao = opcaoCasamentoSelecionada(inicial);
  if (!opcao || !inicial.negociacaoCasamento) {
    throw new ErroNegociacaoCasamento("Escolha a Opção 1 ou a Opção 2 antes de personalizar o casamento.");
  }
  return { dados: inicial, opcao, negociacao: inicial.negociacaoCasamento };
}

export function mudarModoCasamento(dados: DadosContrato, modo: "original" | "personalizado"): DadosContrato {
  const atual = selecionada(dados);
  const rascunho = opcaoNegociacaoCasamentoSchema.parse({ ...atual.negociacao[atual.opcao], modo });
  const negociacao = { ...atual.negociacao, [atual.opcao]: rascunho };
  return { ...atual.dados, negociacaoCasamento: negociacao, servico: efetivo(negociacao, atual.opcao) };
}

export function editarServicoCasamento(dados: DadosContrato, servico: Servico): DadosContrato {
  if (!dados.negociacaoCasamento && !opcaoCasamentoSelecionada(dados)) {
    // O editor legado sob medida continua funcionando, sem lhe atribuir uma
    // das duas opcoes da proposta por inferencia.
    return { ...dados, servico: servicoSchema.parse(servico) };
  }
  const atual = selecionada(dados);
  const esperado = OPCOES_CASAMENTO.find((item) => item.id === atual.opcao)!.pacote;
  if (servico.pacote !== esperado) {
    throw new ErroNegociacaoCasamento("O serviço personalizado deve manter o pacote da opção selecionada.");
  }
  const novo = servicoSchema.parse(servico);
  const negociacao: NegociacaoCasamento = {
    ...atual.negociacao,
    [atual.opcao]: { ...atual.negociacao[atual.opcao], modo: "personalizado", servico: novo },
  };
  return { ...atual.dados, negociacaoCasamento: negociacao, servico: servicoSchema.parse(novo) };
}

export function editarCondicoesCasamento(dados: DadosContrato, condicoes: string): DadosContrato {
  const atual = selecionada(dados);
  const rascunho = opcaoNegociacaoCasamentoSchema.parse({ ...atual.negociacao[atual.opcao], modo: "personalizado", condicoes });
  const negociacao = { ...atual.negociacao, [atual.opcao]: rascunho };
  return { ...atual.dados, negociacaoCasamento: negociacao, servico: efetivo(negociacao, atual.opcao) };
}

/** Autoridade de escrita/montagem: nenhum servico divergente e aceito. */
export function resolverNegociacaoCasamento(
  dados: DadosContrato,
  ctx: { categoria: string; templateId?: string | null },
): DadosContrato {
  if (dados.negociacaoCasamento === undefined) return dados;
  if (ctx.categoria !== "casamento" || ctx.templateId !== "casamento") {
    throw new ErroNegociacaoCasamento("A personalização de opções é exclusiva dos contratos de casamento.");
  }
  const validada = negociacaoCasamentoSchema.safeParse(dados.negociacaoCasamento);
  if (!validada.success) throw new ErroNegociacaoCasamento("As opções personalizadas do casamento são inválidas.");
  const negociacao = validada.data;
  for (const opcao of OPCOES_CASAMENTO) {
    if (negociacao[opcao.id].servico.pacote !== opcao.pacote) {
      throw new ErroNegociacaoCasamento("O pacote do rascunho não corresponde à opção de casamento.");
    }
  }
  const opcao = opcaoCasamentoSelecionada(dados);
  if (!opcao) throw new ErroNegociacaoCasamento("Escolha a Opção 1 ou a Opção 2 do casamento.");
  if (condicoesNegociadasCasamento(dados).length > 38) {
    throw new ErroNegociacaoCasamento("Use no máximo 38 parágrafos nas condições negociadas da opção selecionada.");
  }
  const servico = efetivo(negociacao, opcao);
  if (!iguais(dados.servico, servico)) {
    throw new ErroNegociacaoCasamento("O serviço do contrato diverge da opção de casamento selecionada. Selecione a opção novamente.");
  }
  return { ...dados, negociacaoCasamento: negociacao, servico };
}

/** So a opcao selecionada em modo personalizado contribui para o contrato. */
export function condicoesNegociadasCasamento(dados: DadosContrato): string[] {
  const opcao = opcaoCasamentoSelecionada(dados);
  if (!opcao || !dados.negociacaoCasamento || dados.negociacaoCasamento[opcao].modo !== "personalizado") return [];
  return dados.negociacaoCasamento[opcao].condicoes.split(/\r\n?|\n/).map((linha) => linha.trim()).filter(Boolean);
}
