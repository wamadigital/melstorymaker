// Ids dos campos do formulario do contrato, e a ponte entre a lista do 422
// ("CPF de quem assina", "Parcela B: informe a data de vencimento.") e o campo
// onde aquilo se resolve.
//
// A lista de faltantes e escrita para a Mel ler (montar.ts), nao para a
// maquina. Em vez de mudar o contrato daquela funcao para devolver ids -- que
// a rota tambem usa --, o painel reconhece cada frase pelo comeco. Frase que
// nao for reconhecida continua aparecendo, so sem o atalho: o pior caso e a
// Mel rolar a tela sozinha, nunca uma pendencia sumir da lista.
//
// Puro e sem React, para o teste provar que TODA frase que `faltantes` sabe
// produzir tem um campo para onde ir.

import type { DadosContrato } from "@/lib/contrato/tipos";

/** Prefixo comum: os ids do contrato nao podem colidir com os das respostas do lead ("nome", "data"). */
const P = "ct";

export const CAMPOS_ENDERECO = [
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "cep",
] as const;
export type CampoEndereco = (typeof CAMPOS_ENDERECO)[number];

export const ID = {
  secao: `${P}-secao`,
  faltantes: `${P}-faltantes`,
  texto: `${P}-texto`,

  // blocos do formulario (destino do link dos avisos que citam uma secao)
  blocoQuem: `${P}-bloco-quem`,
  blocoEvento: `${P}-bloco-evento`,
  blocoServico: `${P}-bloco-servico`,
  blocoPagamento: `${P}-bloco-pagamento`,

  // quem assina -- pessoa fisica
  pfNome: `${P}-pf-nome`,
  pfGenero: `${P}-pf-genero`,
  pfCpf: `${P}-pf-cpf`,
  pfEmail: `${P}-pf-email`,
  pfTelefone: `${P}-pf-telefone`,
  pfNacionalidade: `${P}-pf-nacionalidade`,
  pfEndereco: (c: CampoEndereco) => `${P}-pf-end-${c}`,
  vinculo: `${P}-vinculo`,

  // quem assina -- pessoa juridica
  pjRazao: `${P}-pj-razao`,
  pjCnpj: `${P}-pj-cnpj`,
  pjEndereco: (c: CampoEndereco) => `${P}-pj-end-${c}`,
  repNome: `${P}-rep-nome`,
  repGenero: `${P}-rep-genero`,
  repCpf: `${P}-rep-cpf`,
  repCargo: `${P}-rep-cargo`,
  repEmail: `${P}-rep-email`,
  repTelefone: `${P}-rep-telefone`,

  // anuente
  anNome: `${P}-an-nome`,
  anGenero: `${P}-an-genero`,
  anCpf: `${P}-an-cpf`,
  anEmail: `${P}-an-email`,
  anPapel: `${P}-an-papel`,

  // evento
  evData: `${P}-ev-data`,
  evHorario: `${P}-ev-horario`,
  evHomenageado: `${P}-ev-homenageado`,
  evTipo: `${P}-ev-tipo`,
  evLocais: `${P}-ev-locais`,
  evLocalRotulo: (i: number) => `${P}-ev-local-${i}-rotulo`,
  evLocalEndereco: (i: number) => `${P}-ev-local-${i}-endereco`,
  evMakingOfLocal: `${P}-ev-mo-local`,
  evMakingOfHorario: `${P}-ev-mo-horario`,
  evEnsaioData: `${P}-ev-ensaio-data`,
  evEnsaioHorario: `${P}-ev-ensaio-horario`,
  evEnsaioLocal: `${P}-ev-ensaio-local`,
  evAlimentacao: `${P}-ev-alimentacao`,

  // servico
  svTabela: `${P}-sv-tabela`,
  svPacote: `${P}-sv-pacote`,
  svValor: `${P}-sv-valor`,
  svDetalhes: `${P}-sv-detalhes`,
  svCobertura: `${P}-sv-cobertura`,
  svStories: `${P}-sv-stories`,
  svSegundosReels: `${P}-sv-segundos-reels`,
  svDiasStories: `${P}-sv-dias-stories`,
  svDiasMaterial: `${P}-sv-dias-material`,
  svDiasReels: `${P}-sv-dias-reels`,
  svFinal: `${P}-sv-final`,
  adDescricao: (i: number) => `${P}-ad-${i}-descricao`,
  adValor: (i: number) => `${P}-ad-${i}-valor`,
  adMinutos: (i: number) => `${P}-ad-${i}-minutos`,

  // pagamento
  pg: `${P}-pg`,
  pgPercentual: (i: number) => `${P}-pg-${i}-percentual`,
  pgSinal: (i: number) => `${P}-pg-${i}-sinal`,
  pgVencimento: (i: number) => `${P}-pg-${i}-vencimento`,
  pgData: (i: number) => `${P}-pg-${i}-data`,
  pgDias: (i: number) => `${P}-pg-${i}-dias`,
  pgQuitadoEm: `${P}-pg-quitado`,
  pgSinalQuitado: `${P}-pg-sinal-quitado`,

  observacoes: `${P}-observacoes`,
} as const;

/** Ancora de cada clausula no texto do contrato (link dos avisos). */
export function idClausula(id: string): string {
  return `${P}-clausula-${id}`;
}

/** Id do campo de resposta do lead no DetalheLead (o input usa o id do passo). */
const ID_RESPOSTA_IDADE = "idade";

/** "Endereço de quem assina: bairro" -> "bairro". */
function campoDoEndereco(resto: string): CampoEndereco | null {
  const r = resto.trim().toLowerCase();
  if (r.startsWith("logradouro")) return "logradouro";
  if (r.startsWith("número") || r.startsWith("numero")) return "numero";
  if (r.startsWith("complemento")) return "complemento";
  if (r.startsWith("bairro")) return "bairro";
  if (r.startsWith("cidade")) return "cidade";
  if (r.startsWith("uf")) return "uf";
  if (r.startsWith("cep")) return "cep";
  return null;
}

/** "Parcela B: ..." -> 1. */
function indiceDaParcela(letra: string): number {
  return letra.toUpperCase().charCodeAt(0) - 65;
}

/** O conteudo entre aspas curvas: "Valor do adicional “Making of da noiva”" -> "Making of da noiva". */
function entreAspas(texto: string): string | null {
  const m = /“([^”]*)”/.exec(texto);
  return m ? m[1] : null;
}

/**
 * Qual adicional a frase cita: "nº 2" (posicao) ou “descrição” (texto). Com a
 * descricao, vale o primeiro adicional com aquele texto -- dois iguais e raro,
 * e ir para o primeiro ainda poe a Mel na lista certa.
 */
function indiceDoAdicional(texto: string, dados: DadosContrato): number | null {
  const n = /nº\s*(\d+)/.exec(texto);
  if (n) return Number(n[1]) - 1;
  const desc = entreAspas(texto);
  if (desc === null) return null;
  const i = dados.servico.adicionais.findIndex((a) => a.descricao.trim() === desc.trim());
  return i >= 0 ? i : null;
}

/**
 * O campo (id no DOM) em que uma frase da lista de faltantes se resolve, ou
 * `null` quando a frase nao e reconhecida.
 *
 * `dados` e o estado atual do formulario: serve para achar o adicional pela
 * descricao e o local pelo rotulo, que a frase cita pelo texto.
 */
export function campoDoFaltante(texto: string, dados: DadosContrato): string | null {
  const t = (texto ?? "").trim();
  if (!t) return null;

  // --- pessoa juridica (antes da PF: "de quem assina pela empresa" contem "de quem assina")
  if (t.startsWith("Razão social")) return ID.pjRazao;
  if (t.startsWith("CNPJ da empresa")) return ID.pjCnpj;
  if (t.startsWith("Endereço da sede da empresa:")) {
    const c = campoDoEndereco(t.slice("Endereço da sede da empresa:".length));
    return c ? ID.pjEndereco(c) : ID.pjEndereco("logradouro");
  }
  if (t.includes("quem assina pela empresa")) {
    if (t.startsWith("Nome")) return ID.repNome;
    if (t.startsWith("Tratamento")) return ID.repGenero;
    if (t.startsWith("CPF")) return ID.repCpf;
    if (t.startsWith("Cargo")) return ID.repCargo;
    if (t.startsWith("E-mail")) return ID.repEmail;
    return ID.repNome;
  }

  // --- pessoa fisica
  if (t.startsWith("Nome completo de quem assina")) return ID.pfNome;
  if (t.startsWith("Tratamento de quem assina")) return ID.pfGenero;
  if (t.startsWith("CPF de quem assina")) return ID.pfCpf;
  if (t.startsWith("E-mail de quem assina")) return ID.pfEmail;
  if (t.startsWith("Endereço de quem assina:")) {
    const c = campoDoEndereco(t.slice("Endereço de quem assina:".length));
    return c ? ID.pfEndereco(c) : ID.pfEndereco("logradouro");
  }
  if (t.startsWith("Vínculo de quem assina")) return ID.vinculo;

  // --- anuente
  if (t.startsWith("Anuente:")) {
    const r = t.slice("Anuente:".length).trim().toLowerCase();
    if (r.startsWith("nome")) return ID.anNome;
    if (r.startsWith("tratamento")) return ID.anGenero;
    if (r.startsWith("papel")) return ID.anPapel;
    return ID.anNome;
  }
  if (t.startsWith("CPF do anuente")) return ID.anCpf;
  if (t.startsWith("E-mail do anuente")) return ID.anEmail;

  // --- evento
  if (t.startsWith("Data do evento")) return ID.evData;
  if (t.startsWith("Início da cobertura")) return ID.evHorario;
  if (t.startsWith("Início do making of")) return ID.evMakingOfHorario;
  if (t.startsWith("Data do ensaio")) return ID.evEnsaioData;
  if (t.startsWith("Início do ensaio")) return ID.evEnsaioHorario;
  if (t.startsWith("Local do ensaio")) return ID.evEnsaioLocal;
  if (
    t.startsWith("Nome dos noivos") ||
    t.startsWith("Nome da debutante") ||
    t.startsWith("Nome do(a) aniversariante") ||
    t.startsWith("Nome da empresa do evento")
  ) {
    return ID.evHomenageado;
  }
  if (t === "Local do evento") return ID.evLocais;
  if (t.startsWith("Nome da linha do local")) {
    const endereco = entreAspas(t);
    const i =
      endereco === null ? -1 : dados.evento.locais.findIndex((l) => l.endereco.trim() === endereco.trim());
    return i >= 0 ? ID.evLocalRotulo(i) : ID.evLocais;
  }
  if (t.startsWith("Endereço:")) {
    const rotulo = t.slice("Endereço:".length).trim();
    const i = dados.evento.locais.findIndex((l) => l.rotulo.trim() === rotulo);
    return i >= 0 ? ID.evLocalEndereco(i) : ID.evLocais;
  }

  // --- servico
  if (t === "Pacote") return ID.svPacote;
  if (t.startsWith("Valor do pacote")) return ID.svValor;
  if (t.startsWith("Valor total do contrato")) return ID.svValor;
  if (t.startsWith("Horas de cobertura")) return ID.svCobertura;
  if (t.startsWith("O que o pacote entrega")) return ID.svStories;
  if (t.startsWith("Duração dos Reels")) return ID.svSegundosReels;
  if (t.startsWith("Prazo de entrega dos stories")) return ID.svDiasStories;
  if (t.startsWith("Prazo de entrega do material")) return ID.svDiasMaterial;
  if (t.startsWith("Prazo de entrega dos Reels")) return ID.svDiasReels;
  if (t.startsWith("Descrição do adicional")) {
    const i = indiceDoAdicional(t, dados);
    return i === null ? null : ID.adDescricao(i);
  }
  if (t.startsWith("Valor do adicional")) {
    const i = indiceDoAdicional(t, dados);
    return i === null ? null : ID.adValor(i);
  }
  if (t.startsWith("Duração do adicional")) {
    const i = indiceDoAdicional(t, dados);
    return i === null ? null : ID.adMinutos(i);
  }

  // --- pagamento (frases de validarPagamento)
  const parcela = /^Parcela ([A-Z]):\s*(.*)$/.exec(t);
  if (parcela) {
    const i = indiceDaParcela(parcela[1]);
    const r = parcela[2].toLowerCase();
    if (r.includes("percentual") || r.includes("valor calculado")) return ID.pgPercentual(i);
    if (r.includes("dias antes")) return ID.pgDias(i);
    if (r.includes("data") || r.includes("vencimento")) return ID.pgData(i);
    return ID.pgPercentual(i);
  }
  if (t.includes("quitado") || t.includes("quitação")) return ID.pgQuitadoEm;
  if (t.includes("valor pago corresponde ao sinal") || t.includes("percentual do sinal"))
    return ID.pgSinalQuitado;
  if (t.startsWith("Marque pelo menos uma parcela como sinal")) return ID.pgSinal(0);
  if (t.startsWith("Os percentuais das parcelas") || t.startsWith("Inclua pelo menos uma parcela"))
    return ID.pg;

  // --- o que so o servidor diz: aniversario sem idade nao tem arte (nem catalogo)
  if (/\bidade\b/i.test(t)) return ID_RESPOSTA_IDADE;

  return null;
}

// ------------------------------------------------------ secao citada --

export type SecaoDoFormulario = { id: string; rotulo: "Quem assina" | "Evento" | "Serviço" | "Pagamento" };

const SECOES: Record<string, SecaoDoFormulario> = {
  "quem assina": { id: ID.blocoQuem, rotulo: "Quem assina" },
  evento: { id: ID.blocoEvento, rotulo: "Evento" },
  servico: { id: ID.blocoServico, rotulo: "Serviço" },
  pagamento: { id: ID.blocoPagamento, rotulo: "Pagamento" },
};

/**
 * A secao do formulario que um aviso manda a Mel usar, ou `null`.
 *
 * O aviso de "observacao que ficou fora do texto" vem da redacao da IA com a
 * instrucao do campo certo ("ajuste as parcelas na seção Pagamento"). O
 * link dele e para ESSA secao: apontar para a clausula de condicoes especiais,
 * como era, levava justamente para onde o pedido NAO entrou. Os nomes sao os
 * do prompt (prompts.ts): "seção Serviço", "Detalhes do pacote", "Adicionais".
 * Vale a primeira "seção X" do texto; sem nenhuma, os nomes de dentro de
 * Serviço ("Detalhes do pacote", "Adicionais") levam a Serviço.
 */
export function secaoCitada(texto: string): SecaoDoFormulario | null {
  const t = (texto ?? "").toLowerCase();
  const m = /se[çc](?:ão|ao)\s+(quem assina|evento|servi[çc]o|pagamento)/.exec(t);
  if (m) return SECOES[m[1].replace("ç", "c")];
  if (/detalhes do pacote|adicional personalizado|\badicionais\b/.test(t)) return SECOES.servico;
  return null;
}
