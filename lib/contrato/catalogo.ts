// O que cada arte vende, como DADO: pacotes com o escopo estruturado e os
// adicionais com o preco em centavos.
//
// Nas artes, tudo isso e pixel (gotchas 4d/4e do CLAUDE.md). Para o contrato
// precisa virar estrutura, senao o objeto, os servicos e os prazos teriam de
// ser redigidos de novo a cada contrato -- e era ai que os contratos antigos
// divergiam da proposta que o cliente tinha aceitado.
//
// O catalogo SO PRE-PREENCHE (decisao 9 do SPEC): a Mel confirma pacote,
// escopo e valor no painel, e o que vale e o que ela confirmou.
//
// Fonte: as artes publicadas, conferidas palavra por palavra (tabela 2026
// inteira e as paginas de Pacotes da 2027). `itensArte` e o texto dos bullets
// como esta desenhado, inclusive caixa alta e pontuacao, para o painel mostrar
// a Mel exatamente o que o lead leu.
//
// Preco de PACOTE nao mora aqui: vem de `PACOTES` (lib/pdf/precos.ts), que e a
// especificacao aprovada pelo owner. Duplicar o numero seria abrir espaco para
// o contrato e a proposta discordarem no primeiro reajuste.
//
// Os ADICIONAIS moram aqui, e desde a tabela 2028 tambem sao POR TABELA. Ate a
// 2027 eram iguais nas duas e o catalogo guardava um numero so; a 2028
// reajustou os opcionais junto com os pacotes (owner, 30/09/2026). Trocar o
// numero no lugar teria sido o caminho errado: o catalogo pre-preenche contrato
// de QUALQUER ano, inclusive um de 2026 que a Mel reabra hoje, e o reajuste
// retroagiria sobre proposta ja aceita.

import type { TemplateId } from "@/lib/form/types";
import { PACOTES, TABELAS_PRECO, type TabelaPreco } from "@/lib/pdf/precos";
import { adicionalSchema, escopoSchema, type Adicional, type Escopo, type TipoAdicional } from "@/lib/contrato/tipos";

/** Preco em centavos por tabela. `null` = a arte nao tem preco; a Mel digita. */
export type ValorPorTabela = Readonly<Record<TabelaPreco, number | null>>;

/**
 * Preenche PARA A FRENTE: o valor declarado numa tabela vale nas seguintes ate
 * outra declarar um novo.
 *
 *   porTabela({ "2026": 35000, "2028": 45000 })
 *   // 2026 e 2027 a R$ 350; 2028 a R$ 450
 *
 * Escrito assim, tabela nova que NAO mexe nos opcionais nao exige editar o
 * catalogo, e quando mexe so as linhas que mudaram aparecem no diff -- que e o
 * que se quer poder conferir contra a pagina de Opcionais da arte.
 */
function porTabela(mapa: Partial<Record<TabelaPreco, number | null>>): ValorPorTabela {
  const saida = {} as Record<TabelaPreco, number | null>;
  let atual: number | null = null;
  for (const t of TABELAS_PRECO) {
    if (t in mapa) atual = mapa[t] ?? null;
    saida[t] = atual;
  }
  return Object.freeze(saida);
}

/**
 * Onde o texto do bullet cita um preco que muda por tabela. Resolvido em
 * `itensArteDaTabela` -- ver o comentario la embaixo.
 */
const MARCADOR_TEMPO_REAL = "{tempo_real}";

export type PacoteCatalogo = {
  nome: string;
  escopo: Escopo;
  /** Os bullets do pacote na arte, palavra por palavra. */
  itensArte: string[];
};

export type AdicionalCatalogo = {
  /** "<arte>.<chave>" ("casamento.making_of_noiva"); "locomocao" e "livre" valem em toda arte. */
  id: string;
  tipo: TipoAdicional;
  /** Nome como esta na arte ("Making Of Noiva"). */
  nome: string;
  /** Como o item entra no contrato ("Making of da noiva"). */
  descricaoContrato: string;
  /** Centavos POR TABELA. `null` = sem preco na arte ("sob consulta"): a Mel digita. */
  valor: ValorPorTabela;
  /** Quando o preco depende do pacote (entrega em tempo real do aniversario adulto). */
  valorPorPacote?: Record<string, ValorPorTabela>;
  /** O preco e por hora, por unidade, ou fechado (`null`). */
  unidade: "hora" | "unidade" | null;
  /** Duracao que o item costuma ter (making of). */
  minutosPadrao?: number;
  /** A observacao que acompanha o item na arte, quando ha. */
  observacaoArte: string | null;
};

/** Cobertura sob medida, fora dos pacotes da arte. Existe em toda arte. */
export const PACOTE_PERSONALIZADO = "Personalizado";

const RESUMO = "resumo do evento";

/** Escopo validado pelo schema na carga do modulo: um catalogo invalido quebra no teste, nao no contrato. */
function escopo(parcial: Partial<Escopo>): Escopo {
  return escopoSchema.parse(parcial);
}

type ArteCatalogo = { pacotes: PacoteCatalogo[]; adicionais: AdicionalCatalogo[] };

const CATALOGO: Record<TemplateId, ArteCatalogo> = {
  casamento: {
    pacotes: [
      {
        nome: "Pacote Principal",
        escopo: escopo({
          minutosCobertura: 300,
          abrangencia: "cerimônia e recepção",
          storymakers: 1,
          reels: [RESUMO],
          diasStories: 5,
          diasMaterial: 7,
          diasReels: 7,
        }),
        itensArte: [
          "5h de cobertura (cerimônia e recepção).",
          "Stories Ilimitados.",
          "Reels/Vídeo com o resumo do evento.",
          "Todo material editado e original disponíveis em Drive.",
          "Cobertura realizada por 1 (um) Storymaker.",
          "Edição e entrega da cobertura em até 5 dias úteis após o evento.",
        ],
      },
      {
        nome: "Pacote Real Time",
        escopo: escopo({
          minutosCobertura: 300,
          abrangencia: "cerimônia e recepção",
          tempoReal: true,
          storymakers: 2,
          reels: [RESUMO],
          diasStories: 5,
          diasMaterial: 7,
          diasReels: 7,
        }),
        itensArte: [
          "5h de cobertura (cerimônia e recepção).",
          "Stories Ilimitados.",
          "Reels/Vídeo com o resumo do evento.",
          "Todo material editado e original disponíveis em Drive.",
          "Cobertura realizada por 2 (dois) Storymakers.",
          "Edição e entrega da cobertura no mesmo dia.",
        ],
      },
    ],
    adicionais: [
      {
        id: "casamento.hora_adicional",
        tipo: "hora_adicional",
        nome: "Hora adicional",
        descricaoContrato: "hora adicional de cobertura",
        valor: porTabela({ "2026": 35000, "2028": 45000 }),
        unidade: "hora",
        observacaoArte: "Mediante disponibilidade da contratada, consultar.",
      },
      {
        id: "casamento.reels",
        tipo: "reels",
        nome: "Reels ou trend adicional",
        descricaoContrato: "Reels ou trend adicional, de até 1 (um) minuto e 30 (trinta) segundos",
        valor: porTabela({ "2026": 30000, "2028": 40000 }),
        unidade: "unidade",
        observacaoArte: "Por unidade a ser combinado previamente com a contratada.",
      },
      {
        id: "casamento.making_of_noiva",
        tipo: "making_of",
        nome: "Making Of Noiva",
        descricaoContrato: "Making of da noiva",
        valor: porTabela({ "2026": 38000, "2028": 50000 }),
        unidade: null,
        minutosPadrao: 120,
        observacaoArte: "A ser combinado previamente com a contratada.",
      },
      {
        id: "casamento.making_of_noivo",
        tipo: "making_of",
        nome: "Making Of Noivo",
        descricaoContrato: "Making of do noivo",
        valor: porTabela({ "2026": 38000, "2028": 50000 }),
        unidade: null,
        minutosPadrao: 120,
        observacaoArte: "A ser combinado previamente com a contratada.",
      },
      {
        id: "casamento.polaroid",
        tipo: "polaroid",
        nome: "Cantinho Polaroid",
        descricaoContrato:
          "Cantinho Polaroid: caderno de lembrança com até 100 (cem) fotos Polaroid tiradas no dia do evento, com profissional no local auxiliando os convidados na colagem das fotos e nos recados",
        valor: porTabela({ "2026": 95000, "2028": 115000 }),
        unidade: null,
        observacaoArte:
          "Caderno de lembrança com até 100 fotos Polaroids tiradas no dia do evento, com profissional no local auxiliando os convidados na colagem das fotos e nos recados.",
      },
    ],
  },

  debutante: {
    pacotes: [
      {
        nome: "Pacote Básico",
        escopo: escopo({ minutosCobertura: 300, reels: [RESUMO], diasStories: 4, diasMaterial: 4, diasReels: 7 }),
        itensArte: [
          "5H DE COBERTURA",
          "1 REELS DE RESUMO",
          "5 horas de cobertura, onde serão entregues stories dos melhores momentos da festa e um reels com o resumo de todo o evento.",
        ],
      },
      {
        nome: "Pacote Premium",
        escopo: escopo({
          minutosCobertura: 300,
          minutosMakingOf: 120,
          reels: ["exclusivo do making of", RESUMO],
          diasStories: 4,
          diasMaterial: 4,
          diasReels: 7,
        }),
        itensArte: [
          "7H DE COBERTURA",
          "1 REELS DE RESUMO",
          "1 REELS MAKING OF",
          "2 horas de making of + 5 horas de cobertura do evento. Inclui stories do making of e dos melhores momentos da festa e dois reels: um exclusivo do making of, outro com o resumo do evento.",
        ],
      },
      {
        nome: "Pacote Luxo",
        escopo: escopo({
          minutosCobertura: 300,
          minutosMakingOf: 120,
          minutosEnsaio: 120,
          reels: ["do ensaio fotográfico", "do making of", RESUMO],
          extras: ["10 (dez) fotos Polaroid, como bônus"],
          diasStories: 4,
          diasMaterial: 4,
          diasReels: 7,
        }),
        itensArte: [
          "9H DE COBERTURA",
          "1 REELS DE RESUMO",
          "1 REELS MAKING OF",
          "1 REELS DO ENSAIO",
          "10 POLAROIDS",
          "2 horas de cobertura do ensaio fotográfico + 2 horas de making of + 5 horas de cobertura do evento. Inclui stories do making of e dos melhores momentos da festa e três reels: um do ensaio fotográfico, do making of e outro com o resumo do evento.",
          "BÔNUS: Ganhe 10 Fotos Polaroids.",
        ],
      },
    ],
    adicionais: [
      {
        id: "debutante.hora_adicional",
        tipo: "hora_adicional",
        nome: "Hora adicional",
        descricaoContrato: "hora adicional de cobertura",
        valor: porTabela({ "2026": 20000, "2028": 25000 }),
        unidade: "hora",
        observacaoArte: "Mediante disponibilidade da contratada, consultar.",
      },
      {
        id: "debutante.trend",
        tipo: "trend",
        nome: "Vídeo de trend",
        descricaoContrato: "Vídeo de trend",
        valor: porTabela({ "2026": 15000, "2028": 20000 }),
        unidade: "unidade",
        observacaoArte: "A ser combinado previamente com a contratada.",
      },
      {
        id: "debutante.storymaker",
        tipo: "storymaker",
        nome: "Storymaker adicional",
        descricaoContrato: "1 (um) storymaker auxiliar, para a cobertura em tempo real",
        valor: porTabela({ "2026": 50000, "2028": 60000 }),
        unidade: null,
        observacaoArte: "Somente se tiver necessidade da cobertura em tempo real.",
      },
    ],
  },

  aniversario_infantil: {
    pacotes: [
      {
        nome: "Pacote Básico",
        escopo: escopo({ minutosCobertura: 240, reels: [RESUMO], diasStories: 4, diasMaterial: 4, diasReels: 7 }),
        itensArte: [
          "4 horas de cobertura, onde serão entregues stories dos melhores momentos da festa e também um reels com o resumo de todo o evento.",
        ],
      },
      {
        nome: "Pacote Premium",
        escopo: escopo({ minutosCobertura: 300, reels: [RESUMO], diasStories: 4, diasMaterial: 4, diasReels: 7 }),
        itensArte: [
          "5 horas de cobertura, onde serão entregues stories dos melhores momentos da festa e também um reels com o resumo de todo o evento.",
        ],
      },
      {
        nome: "Pacote Luxo",
        escopo: escopo({
          minutosCobertura: 360,
          reels: [RESUMO],
          // Com artigo: o extra entra no meio da frase ("Inclui-se, ainda: o
          // cantinho...", "Disponibilizar o cantinho..."), e sem ele o
          // contrato lia como anotacao solta.
          extras: ["o cantinho das fotos Polaroid com álbum de recados"],
          diasStories: 4,
          diasMaterial: 4,
          diasReels: 7,
        }),
        itensArte: [
          "6 horas de cobertura, onde serão entregues stories dos melhores momentos da festa e também um reels com o resumo de todo o evento + cantinho das fotos polaroids com álbum de recados.",
        ],
      },
    ],
    adicionais: [
      {
        id: "aniversario_infantil.hora_adicional",
        tipo: "hora_adicional",
        nome: "Hora adicional",
        descricaoContrato: "hora adicional de cobertura",
        valor: porTabela({ "2026": 30000, "2028": 40000 }),
        unidade: "hora",
        observacaoArte: "Mediante disponibilidade da contratada, consultar.",
      },
      {
        id: "aniversario_infantil.trend",
        tipo: "trend",
        nome: "Vídeo de trend",
        descricaoContrato: "Vídeo de trend",
        valor: porTabela({ "2026": 18000, "2028": 25000 }),
        unidade: "unidade",
        observacaoArte: "A ser combinado previamente com a contratada.",
      },
      {
        id: "aniversario_infantil.storymaker",
        tipo: "storymaker",
        // "(hora)" faz parte do nome na arte. Na descricao do CONTRATO, nao:
        // a montagem ja escreve "N horas, no valor de ... por hora", e o
        // "por hora" repetido aqui saia duas vezes na mesma frase.
        nome: "Storymaker adicional (hora)",
        descricaoContrato: "storymaker auxiliar para a cobertura em tempo real",
        valor: porTabela({ "2026": 10000, "2028": 15000 }),
        unidade: "hora",
        observacaoArte: "Somente se tiver necessidade da cobertura em tempo real.",
      },
    ],
  },

  aniversario_adulto: {
    pacotes: [
      {
        nome: "Pacote Pocket",
        escopo: escopo({ minutosCobertura: 240, reels: [RESUMO], diasStories: 7, diasMaterial: 7, diasReels: 7 }),
        itensArte: [
          "4h de cobertura do evento",
          "Stories Ilimitados",
          "Reels com o resumo do evento",
          `Entrega em tempo real: Adicional de ${MARCADOR_TEMPO_REAL}`,
        ],
      },
      {
        nome: "Pacote Premium",
        escopo: escopo({ minutosCobertura: 300, reels: [RESUMO], diasStories: 7, diasMaterial: 7, diasReels: 7 }),
        itensArte: [
          "5h de cobertura do evento",
          "Stories Ilimitados",
          "Reels com o resumo do evento",
          `Entrega em tempo real: Adicional de ${MARCADOR_TEMPO_REAL}`,
        ],
      },
      {
        nome: "Pacote Luxo",
        escopo: escopo({
          minutosCobertura: 300,
          minutosMakingOf: 90,
          reels: [RESUMO],
          diasStories: 7,
          diasMaterial: 7,
          diasReels: 7,
        }),
        itensArte: [
          "5h de cobertura do evento + 1h30min de making of",
          "Stories Ilimitados",
          "Reels com o resumo do evento",
          `Entrega em tempo real: Adicional de ${MARCADOR_TEMPO_REAL}`,
        ],
      },
    ],
    adicionais: [
      {
        id: "aniversario_adulto.hora_adicional",
        tipo: "hora_adicional",
        nome: "Hora adicional",
        descricaoContrato: "hora adicional de cobertura",
        valor: porTabela({ "2026": 35000, "2028": 45000 }),
        unidade: "hora",
        observacaoArte: "Mediante disponibilidade da contratada, consultar.",
      },
      {
        id: "aniversario_adulto.reels",
        tipo: "reels",
        nome: "Reels ou trend adicional",
        descricaoContrato: "Reels ou trend adicional, de até 1 (um) minuto e 30 (trinta) segundos",
        valor: porTabela({ "2026": 30000, "2028": 40000 }),
        unidade: "unidade",
        observacaoArte: "A ser combinado previamente com a contratada.",
      },
      {
        id: "aniversario_adulto.polaroid",
        tipo: "polaroid",
        nome: "Cantinho Polaroid",
        // A arte do adulto nao descreve o Polaroid (a do casamento descreve
        // outro produto, com 100 fotos e profissional). A Mel detalha no painel.
        descricaoContrato: "Cantinho Polaroid",
        valor: porTabela({}),
        unidade: null,
        observacaoArte: "Consultar disponibilidade e orçamento.",
      },
      {
        // Nao esta na lista de opcionais da arte: aparece como bullet de cada
        // pacote ("Entrega em tempo real: Adicional de R$ 400" na tabela 2026),
        // com preco diferente por pacote E por tabela. O texto do bullet sai
        // daqui, por `itensArteDaTabela` -- nunca escrito a mao nos itensArte.
        id: "aniversario_adulto.tempo_real",
        tipo: "tempo_real",
        nome: "Entrega em tempo real",
        descricaoContrato: "entrega da cobertura de stories em tempo real, durante o evento",
        valor: porTabela({}),
        valorPorPacote: {
          "Pacote Pocket": porTabela({ "2026": 40000, "2028": 50000 }),
          "Pacote Premium": porTabela({ "2026": 50000, "2028": 60000 }),
          "Pacote Luxo": porTabela({ "2026": 60000, "2028": 75000 }),
        },
        unidade: null,
        observacaoArte: null,
      },
    ],
  },

  // Corporativo e TEMPO REAL nos tres pacotes. A arte diz, sem o asterisco
  // "*Caso a cobertura seja em tempo real" que a debutante e o infantil tem,
  // que a cobertura "depende do Wi-Fi local e do ritmo do evento, podendo ser
  // concluída em até algumas horas após o término do evento"; o formulario do
  // corporativo nem pergunta a entrega, e nao ha adicional de tempo real. A
  // oferta que o cliente aceitou e essa: um contrato com "4 dias úteis" dava
  // um prazo mais frouxo que a proposta e ficava sem a clausula da internet.
  // `diasStories` fica guardado, mas em tempo real nao entra no texto.
  corporativo: {
    pacotes: [
      {
        nome: "Pacote Pocket",
        escopo: escopo({ minutosCobertura: 120, tempoReal: true, reels: [RESUMO], diasStories: 4, diasMaterial: 4, diasReels: 7 }),
        itensArte: [
          "2h de cobertura de stories. Ideal para eventos curtos, como lançamentos, palestras ou ativações pontuais. Inclui um reels com o resumo de todo o evento.",
        ],
      },
      {
        nome: "Pacote Premium",
        escopo: escopo({ minutosCobertura: 300, tempoReal: true, reels: [RESUMO], diasStories: 4, diasMaterial: 4, diasReels: 7 }),
        itensArte: [
          "5 horas de cobertura de stories, capturando desde os bastidores até os momentos mais marcantes. Inclui um reels com o resumo de todo o evento.",
        ],
      },
      {
        nome: "Pacote Luxo",
        escopo: escopo({ minutosCobertura: 420, tempoReal: true, reels: [RESUMO], diasStories: 4, diasMaterial: 4, diasReels: 7 }),
        itensArte: [
          "7 horas de cobertura. Ideal para eventos de longa duração, garantindo um acompanhamento completo. Inclui um reels com o resumo de todo o evento.",
        ],
      },
    ],
    adicionais: [
      {
        id: "corporativo.hora_adicional",
        tipo: "hora_adicional",
        nome: "Hora adicional",
        descricaoContrato: "hora adicional de cobertura",
        valor: porTabela({ "2026": 35000, "2028": 45000 }),
        unidade: "hora",
        observacaoArte: "Mediante disponibilidade da contratada, consultar.",
      },
      {
        id: "corporativo.trend",
        tipo: "trend",
        nome: "Vídeo de trend",
        descricaoContrato: "Vídeo de trend",
        valor: porTabela({ "2026": 25000, "2028": 30000 }),
        unidade: "unidade",
        observacaoArte: "A ser combinado previamente com a contratada.",
      },
      {
        id: "corporativo.reels",
        tipo: "reels",
        nome: "Reels adicional",
        descricaoContrato: "Reels adicional, de até 1 (um) minuto e 30 (trinta) segundos",
        valor: porTabela({ "2026": 33000, "2028": 40000 }),
        unidade: "unidade",
        observacaoArte: "Reels de até 1m30s.",
      },
    ],
  },
};

const PACOTE_SOB_MEDIDA: PacoteCatalogo = {
  nome: PACOTE_PERSONALIZADO,
  escopo: escopo({ minutosCobertura: 300, reels: [RESUMO], diasStories: 5, diasMaterial: 7, diasReels: 7 }),
  itensArte: [],
};

/**
 * Locomocao: inclusa em Campinas; fora dela, "consulte valores". Vale em toda
 * arte e nao tem preco -- a Mel digita.
 */
export const ADICIONAL_LOCOMOCAO: AdicionalCatalogo = Object.freeze({
  id: "locomocao",
  tipo: "locomocao",
  nome: "Locomoção",
  descricaoContrato: "despesas de locomoção da CONTRATADA até o local do evento",
  valor: porTabela({}),
  unidade: null,
  observacaoArte: "Eventos em Campinas: Já incluso. *Consulte valores para outras regiões.",
});

/**
 * Qualquer servico fora do catalogo (o "vídeo de até 20 minutos com os
 * melhores momentos" de um contrato antigo). Descricao e valor sao da Mel; ao
 * incluir, o id vira "livre-<n>".
 */
export const ADICIONAL_LIVRE: AdicionalCatalogo = Object.freeze({
  id: "livre",
  tipo: "outro",
  nome: "Outro serviço",
  descricaoContrato: "",
  valor: porTabela({}),
  unidade: null,
  observacaoArte: null,
});

// Copias em toda saida: o painel guarda o escopo do pacote no estado e o
// edita. Sem copia, a edicao de um contrato alteraria o catalogo do seguinte.
function clonarPacote(p: PacoteCatalogo): PacoteCatalogo {
  return {
    nome: p.nome,
    escopo: { ...p.escopo, reels: [...p.escopo.reels], extras: [...p.escopo.extras] },
    itensArte: [...p.itensArte],
  };
}

function clonarAdicional(a: AdicionalCatalogo): AdicionalCatalogo {
  return { ...a, ...(a.valorPorPacote ? { valorPorPacote: { ...a.valorPorPacote } } : {}) };
}

function daArte(t: TemplateId): ArteCatalogo {
  const arte = CATALOGO[t];
  if (!arte) throw new Error(`Arte sem catálogo: ${String(t)}`);
  return arte;
}

/**
 * Pacotes (na ordem da arte, mais o "Personalizado" no fim) e adicionais (os
 * da arte, mais locomocao e "outro serviço") de uma arte.
 */
export function catalogoDaArte(t: TemplateId): { pacotes: PacoteCatalogo[]; adicionais: AdicionalCatalogo[] } {
  const arte = daArte(t);
  return {
    pacotes: [...arte.pacotes, PACOTE_SOB_MEDIDA].map(clonarPacote),
    adicionais: [...arte.adicionais, ADICIONAL_LOCOMOCAO, ADICIONAL_LIVRE].map(clonarAdicional),
  };
}

/** Um pacote da arte pelo nome (inclusive o "Personalizado"), ou `null`. */
export function pacoteDoCatalogo(t: TemplateId, nome: string): PacoteCatalogo | null {
  const achado = [...daArte(t).pacotes, PACOTE_SOB_MEDIDA].find((p) => p.nome === nome);
  return achado ? clonarPacote(achado) : null;
}

/**
 * Preco do pacote na tabela, em CENTAVOS, lido de `PACOTES`.
 *
 * `null` quando o pacote nao tem preco de tabela: nome desconhecido ou o
 * "Personalizado" (cobertura sob medida nao tem numero na arte; o valor e o
 * que a Mel combinar). E `null`, e nao 0, para quem compara com a tabela nao
 * achar que todo personalizado "ficou acima do catalogo".
 */
export function precoPacote(t: TemplateId, tabela: TabelaPreco, nome: string): number | null {
  const pacote = PACOTES[tabela]?.[t]?.find((p) => p.nome === nome);
  return pacote ? pacote.valor * 100 : null;
}

/**
 * Um adicional da arte pelo id. "livre-<n>" (o que a Mel incluiu como "Outro
 * serviço") devolve o modelo do adicional livre. Id de outra arte devolve
 * `null`: se a idade do aniversariante mudou e a arte mudou junto, o adicional
 * da arte antiga nao vale mais.
 */
export function adicionalDoCatalogo(t: TemplateId, id: string): AdicionalCatalogo | null {
  if (id === ADICIONAL_LIVRE.id || id.startsWith(`${ADICIONAL_LIVRE.id}-`)) return clonarAdicional(ADICIONAL_LIVRE);
  const achado = [...daArte(t).adicionais, ADICIONAL_LOCOMOCAO].find((a) => a.id === id);
  return achado ? clonarAdicional(achado) : null;
}

/**
 * Um adicional pelo id, procurado em TODAS as artes (os ids levam o prefixo
 * da arte, entao nao colidem), mais locomocao e o livre.
 *
 * Serve para o que e propriedade do ITEM vendido, e nao do preco da arte
 * atual: a unidade de cobranca. O "Storymaker adicional (hora)" do infantil
 * continua sendo por hora mesmo que a idade mude e a arte do lead mude junto.
 */
export function adicionalPorId(id: string): AdicionalCatalogo | null {
  if (id === ADICIONAL_LIVRE.id || id.startsWith(`${ADICIONAL_LIVRE.id}-`)) return clonarAdicional(ADICIONAL_LIVRE);
  if (id === ADICIONAL_LOCOMOCAO.id) return clonarAdicional(ADICIONAL_LOCOMOCAO);
  for (const arte of Object.values(CATALOGO)) {
    const achado = arte.adicionais.find((a) => a.id === id);
    if (achado) return clonarAdicional(achado);
  }
  return null;
}

/**
 * Preco unitario de catalogo do adicional, em centavos, para o pacote escolhido
 * NAQUELA tabela; `null` = sem preco na arte.
 *
 * A tabela e obrigatoria e nao tem padrao de proposito: um padrao silencioso
 * serviria o preco de um ano para o contrato de outro, que e exatamente o erro
 * que a dimensao de tabela existe para impedir.
 */
export function valorCatalogoAdicional(
  item: AdicionalCatalogo,
  pacote: string,
  tabela: TabelaPreco,
): number | null {
  const doPacote = item.valorPorPacote?.[pacote];
  // `doPacote` explicitamente null tambem vale: quer dizer "neste pacote a arte
  // nao traz preco", e cair no valor generico inventaria um.
  return doPacote ? doPacote[tabela] : item.valor[tabela];
}

/**
 * Os bullets do pacote como a arte DAQUELA tabela os desenha.
 *
 * Existe porque o aniversario adulto cita, dentro do texto do bullet, o preco
 * da entrega em tempo real -- e esse preco mudou na tabela 2028. O numero sai
 * do proprio adicional em vez de estar escrito duas vezes: `itensArte` e o que
 * o painel mostra a Mel como "o que o lead leu", e as duas copias do mesmo
 * numero divergiriam no primeiro reajuste que alguem esquecesse de espelhar.
 *
 * Nas outras quatro artes nenhum bullet cita preco, e a funcao devolve o texto
 * intacto.
 */
export function itensArteDaTabela(
  t: TemplateId,
  nomePacote: string,
  tabela: TabelaPreco,
): string[] {
  const pacote = pacoteDoCatalogo(t, nomePacote);
  if (!pacote) return [];
  if (!pacote.itensArte.some((i) => i.includes(MARCADOR_TEMPO_REAL))) return pacote.itensArte;

  const tempoReal = daArte(t).adicionais.find((a) => a.tipo === "tempo_real");
  const centavos = tempoReal ? valorCatalogoAdicional(tempoReal, nomePacote, tabela) : null;
  // A arte escreve reais inteiros ("R$ 400"), nunca centavos.
  const texto = centavos === null ? "valor a combinar" : `R$ ${Math.round(centavos / 100)}`;
  return pacote.itensArte.map((i) => i.split(MARCADOR_TEMPO_REAL).join(texto));
}

/** Proximo id livre ("livre-1", "livre-2"...), sem reusar um que ja esta na lista. */
export function proximoIdLivre(existentes: readonly Pick<Adicional, "id">[]): string {
  let maior = 0;
  for (const { id } of existentes) {
    const m = /^livre-(\d+)$/.exec(id);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `livre-${maior + 1}`;
}

/**
 * O adicional como entra em `servico.adicionais`, pre-preenchido pelo
 * catalogo: descricao do contrato, quantidade 1, valor da arte (ou do pacote,
 * no tempo real do adulto; 0 quando a arte nao tem preco) e a duracao padrao.
 * A Mel confirma tudo no painel.
 */
export function novoAdicional(
  item: AdicionalCatalogo,
  pacote: string,
  tabela: TabelaPreco,
  existentes: readonly Pick<Adicional, "id">[] = [],
): Adicional {
  return adicionalSchema.parse({
    id: item.tipo === "outro" ? proximoIdLivre(existentes) : item.id,
    tipo: item.tipo,
    descricao: item.descricaoContrato,
    quantidade: 1,
    valorUnitario: valorCatalogoAdicional(item, pacote, tabela) ?? 0,
    minutos: item.minutosPadrao ?? 0,
  });
}
