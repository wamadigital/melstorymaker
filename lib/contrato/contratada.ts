// Dados fixos da CONTRATADA -- a Mel -- em todo contrato.
//
// Constante, e nao campo do painel: nos contratos antigos a qualificacao da
// Mel mudou de endereco, de nome ("Mel Simão" -> "Mellayne Simão Sabino") e de
// pontuacao de um contrato para o outro, porque era redigitada a cada vez.
// Aqui ela e escrita uma vez e revisada uma vez.
//
// Mudou algum dado (endereco, e-mail, chave PIX)? Muda AQUI, e so os contratos
// gerados dali em diante saem com o dado novo -- o PDF ja gerado nao muda, e o
// ja assinado e imutavel.
//
// Sem "server-only": nao ha segredo. O CNPJ esta impresso em todas as artes, e
// o endereco e o que consta no proprio cadastro do CNPJ.

import type { Assinante, Parte } from "@/lib/contrato/tipos";

export const CONTRATADA = {
  nome: "Mellayne Simão Sabino",
  /** So digitos, como os documentos do contratante ficam guardados. */
  cnpj: "53925833000120",
  cnpjFormatado: "53.925.833/0001-20",
  email: "mel@wama.digital",
  /** A chave PIX e o proprio CNPJ, escrito como a Mel o divulga. */
  chavePix: "53.925.833/0001-20",
  /** "Campinas/SP, na data da última assinatura eletrônica..." */
  cidadeAssinatura: "Campinas/SP",
  /** Foro do contrato com pessoa JURIDICA (domicilio da CONTRATADA). PF usa o domicilio da CONTRATANTE. */
  foroPJ: "Monte Mor/SP",
  plataformaAssinatura: "iLovePDF",
  /**
   * Qualificacao completa, como vai depois de "**CONTRATADA:**". Termina em
   * ponto, como as das outras partes.
   */
  qualificacao:
    "Mellayne Simão Sabino, brasileira, storymaker, inscrita no CNPJ sob o nº 53.925.833/0001-20, residente e domiciliada na Rua Caiapós, 28, Condomínio Residencial Monterrey Reserva, Parque Residencial Terras de Yucatan, Monte Mor/SP, com endereço eletrônico mel@wama.digital.",
} as const;

// Congelados: sao compartilhados por todo contrato montado no mesmo processo,
// e uma mutacao acidental num deles sairia no contrato seguinte.

/** A CONTRATADA no bloco das partes. */
export const PARTE_CONTRATADA: Parte = Object.freeze({
  rotulo: "CONTRATADA",
  texto: CONTRATADA.qualificacao,
});

/** A CONTRATADA no bloco de assinaturas e na lista de signatarios da plataforma. */
export const ASSINANTE_CONTRATADA: Assinante = Object.freeze({
  papel: "contratada",
  rotulo: "CONTRATADA",
  nome: CONTRATADA.nome,
  documento: `CNPJ: ${CONTRATADA.cnpjFormatado}`,
  email: CONTRATADA.email,
});
