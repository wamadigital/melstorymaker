// Tipos do contrato de prestacao de servicos. Sem "server-only" de proposito:
// o painel (client) monta os formularios com estes mesmos schemas, e o servidor
// valida o que chega com eles. Um schema, dois usos, zero divergencia.
//
// Nada aqui tem segredo. O que tem (chave da Anthropic, chave da iLoveAPI,
// service role) mora em modulos com "server-only".

import { z } from "zod";
import { TABELAS_PRECO } from "@/lib/pdf/precos";

// ---------------------------------------------------------------- pessoas --

/**
 * Genero gramatical de quem e qualificado no contrato ("brasileira, inscrita,
 * domiciliada"). Campo EXPLICITO, escolhido pela Mel: nunca inferido do nome,
 * nem pela IA. 4 dos 17 contratos antigos erraram a concordancia justamente
 * porque ninguem decidia isso de proposito.
 *
 * "" = ainda nao escolhido (rascunho). A montagem recusa gerar sem ele.
 */
export const GENEROS = ["feminino", "masculino"] as const;
export type Genero = (typeof GENEROS)[number];
const genero = z.enum(GENEROS).or(z.literal("")).default("");

/** Texto livre que pode ficar vazio no rascunho. A completude e checada na montagem. */
const texto = z.string().trim().max(2000).default("");

export const enderecoSchema = z.object({
  logradouro: texto, // "Rua Caiapós"
  numero: texto, // "28" ou "s/n"
  complemento: texto, // "Bl. B, Apto. 61"
  bairro: texto,
  cidade: texto,
  uf: texto, // "SP"
  cep: texto, // opcional: nenhum contrato antigo trazia
});
export type Endereco = z.infer<typeof enderecoSchema>;

export const pessoaFisicaSchema = z.object({
  nome: texto, // nome civil completo
  genero,
  // "" = derivar do genero ("brasileira"/"brasileiro"). So se preenche para estrangeiro.
  nacionalidade: texto,
  cpf: texto, // guardado so com digitos
  email: texto, // e para ele que vai o link de assinatura
  telefone: texto,
  endereco: enderecoSchema.prefault({}),
});
export type PessoaFisica = z.infer<typeof pessoaFisicaSchema>;

export const representanteSchema = z.object({
  nome: texto,
  genero,
  cpf: texto,
  cargo: texto, // "sócio-administrador"
  email: texto, // recebe o link de assinatura em nome da empresa
  telefone: texto,
});
export type Representante = z.infer<typeof representanteSchema>;

export const pessoaJuridicaSchema = z.object({
  razaoSocial: texto,
  cnpj: texto, // so digitos
  endereco: enderecoSchema.prefault({}), // sede
  representante: representanteSchema.prefault({}),
});
export type PessoaJuridica = z.infer<typeof pessoaJuridicaSchema>;

/**
 * Quem ASSINA. Nunca pre-preenchido com `respostas.nome` sem a Mel confirmar:
 * `nome` no lead e quem preencheu o formulario (a filha pode ter preenchido o
 * proprio 15 anos). Os dois ramos ficam guardados lado a lado para a Mel poder
 * alternar PF/PJ sem perder o que ja digitou.
 */
export const contratanteSchema = z.object({
  tipo: z.enum(["pf", "pj"]).default("pf"),
  pf: pessoaFisicaSchema.prefault({}),
  pj: pessoaJuridicaSchema.prefault({}),
  /**
   * Em evento de menor (debutante, ou aniversario com menos de 18 anos): o que
   * a CONTRATANTE e do homenageado -- "mãe", "pai", "responsável legal". Vai
   * para a qualificacao e para a autorizacao de imagem do menor.
   */
  vinculo: texto,
});
export type Contratante = z.infer<typeof contratanteSchema>;

/**
 * Anuente: assina SO para autorizar o uso da propria imagem (o outro noivo, o
 * aniversariante de 16-17 anos assistido, o aniversariante adulto que nao e
 * quem contrata). Sem ele, a autorizacao de imagem cobre apenas quem assina.
 */
export const anuenteSchema = z.object({
  ativo: z.boolean().default(false),
  nome: texto,
  genero,
  cpf: texto,
  email: texto,
  /** Como aparece no contrato: "noivo", "noiva", "aniversariante". */
  papel: texto,
});
export type Anuente = z.infer<typeof anuenteSchema>;

// ----------------------------------------------------------------- evento --

export const localSchema = z.object({
  /** "Local do evento", "Local da cerimônia", "Local da recepção", "Local da cerimônia e recepção". */
  rotulo: texto,
  /** Nome do espaco + endereco completo, como vai no contrato. */
  endereco: texto,
});
export type Local = z.infer<typeof localSchema>;

export const eventoSchema = z.object({
  /** ISO "2027-01-23". Lido por regex, nunca com `new Date` (fuso). */
  data: texto,
  /** "HH:MM". Inicio da COBERTURA, confirmado pela Mel (o formulario pergunta o horario do convite). */
  horarioInicio: texto,
  /** Nome de quem o evento homenageia, como vai no objeto: "Maria Eduarda", "Ana e João", "Buffet X". */
  homenageado: texto,
  /** So corporativo: "lançamento", "convenção". */
  tipoEvento: texto,
  locais: z.array(localSchema).max(6).default([]),
  /** Making of: "" = A DEFINIR (com prazo de 10 dias para a CONTRATANTE informar). */
  makingOfLocal: texto,
  makingOfHorario: texto,
  /**
   * Ensaio fotografico (so vale com ensaio no escopo -- o Pacote Luxo da
   * debutante). Acontece em OUTRO dia, antes do evento: sem estes campos o
   * contrato prometia "2 horas de ensaio" sem data, local nem regra para
   * marcar, e ainda somava essas horas ao "Tempo de serviço" do dia da festa.
   * "" = A DEFINIR, de comum acordo, com a CONTRATANTE agendando com 10 dias
   * de antecedencia. Contrato salvo antes destes campos le "" (A DEFINIR).
   */
  ensaioData: texto, // ISO "2027-03-06", lido por regex como `data`
  ensaioLocal: texto,
  ensaioHorario: texto, // "HH:MM"
  /** Alguns eventos nao tem buffet (cobertura de 1h numa igreja). */
  alimentacao: z.boolean().default(true),
});
export type Evento = z.infer<typeof eventoSchema>;

// ---------------------------------------------------------------- servico --

/**
 * O que o pacote entrega, como DADO. As artes so tem isso desenhado em pixel;
 * aqui vira estrutura para o objeto, os servicos e os prazos serem montados
 * sem ninguem redigir de novo a cada contrato. Vem do catalogo e a Mel ajusta.
 */
export const escopoSchema = z.object({
  minutosCobertura: z.number().int().min(0).max(24 * 60).default(0),
  /** "cerimônia e recepção", "" quando nao se aplica. */
  abrangencia: texto,
  minutosMakingOf: z.number().int().min(0).max(12 * 60).default(0),
  minutosEnsaio: z.number().int().min(0).max(12 * 60).default(0),
  stories: z.boolean().default(true),
  /** Publicacao DURANTE o evento. Troca "Dos prazos" por "Das condicoes tecnicas, operacionais e prazos". */
  tempoReal: z.boolean().default(false),
  /** 2 = CONTRATADA + 1 storymaker auxiliar. Muda objeto, servicos e alimentacao. */
  storymakers: z.number().int().min(1).max(4).default(1),
  /** Um item por Reels: "resumo do evento", "exclusivo do making of". */
  reels: z.array(texto).max(10).default([]),
  segundosReels: z.number().int().min(0).max(600).default(90),
  /** Entregas que nao sao stories nem Reels: "10 (dez) fotos Polaroid, como bônus". */
  extras: z.array(texto).max(10).default([]),
  /** Prazo (dias uteis) dos stories quando NAO e tempo real. */
  diasStories: z.number().int().min(0).max(90).default(5),
  diasMaterial: z.number().int().min(0).max(90).default(7),
  diasReels: z.number().int().min(0).max(90).default(7),
});
export type Escopo = z.infer<typeof escopoSchema>;

/**
 * O escopo com os adicionais somados (`escopoEfetivo`, em montar.ts). Nao e
 * dado salvo: e calculado a cada montagem, por isso nao tem schema.
 *
 * `storymakers` aqui e quem esta na cobertura INTEIRA. O auxiliar contratado
 * por hora, por menos horas do que a cobertura, NAO sobe esse numero:
 * `minutosAuxiliar` diz por quanto tempo ele atua. Sem essa distincao, 2 horas
 * de auxiliar num pacote de 5 viravam "equipe composta pela CONTRATADA e 1
 * storymaker auxiliar" -- e o cliente poderia exigir as 5 horas pagando 2.
 */
export type EscopoEfetivo = Escopo & {
  /**
   * Minutos com storymaker auxiliar na cobertura: a cobertura inteira quando a
   * equipe e de 2 ou mais (pacote ou adicional por evento); as horas
   * contratadas quando o adicional e por hora; 0 sem auxiliar.
   */
  minutosAuxiliar: number;
};

export const TIPOS_ADICIONAL = [
  "hora_adicional",
  "making_of",
  "reels",
  "trend",
  "storymaker",
  "tempo_real",
  "polaroid",
  "locomocao",
  "outro",
] as const;
export type TipoAdicional = (typeof TIPOS_ADICIONAL)[number];

export const adicionalSchema = z.object({
  /** id do catalogo ("casamento.making_of_noiva") ou "livre-<n>" para o que a Mel digitou. */
  id: texto,
  tipo: z.enum(TIPOS_ADICIONAL),
  /** Como o item e nomeado no contrato: "Making of da noiva", "Vídeo de até 20 minutos com os melhores momentos". */
  descricao: texto,
  quantidade: z.number().int().min(1).max(50).default(1),
  /** Centavos, sempre. Nenhum numero de dinheiro e float neste modulo. */
  valorUnitario: z.number().int().min(0).max(100_000_00).default(0),
  /** Duracao, quando o tipo tem uma (making of). */
  minutos: z.number().int().min(0).max(12 * 60).default(0),
});
export type Adicional = z.infer<typeof adicionalSchema>;

export const servicoSchema = z.object({
  tabela: z.enum(TABELAS_PRECO),
  /** Nome do pacote do catalogo, ou "Personalizado". */
  pacote: texto,
  /** Centavos. Pre-preenchido pelo catalogo da tabela; a Mel confirma. */
  valorPacote: z.number().int().min(0).max(100_000_00).default(0),
  escopo: escopoSchema.prefault({}),
  adicionais: z.array(adicionalSchema).max(20).default([]),
  /** Centavos. O contrato mostra so o total; o desconto fica registrado aqui. */
  desconto: z.number().int().min(0).max(100_000_00).default(0),
});
export type Servico = z.infer<typeof servicoSchema>;

// -------------------------------------------------------------- pagamento --

export const vencimentoSchema = z.discriminatedUnion("tipo", [
  /** "na assinatura deste contrato" */
  z.object({ tipo: z.literal("assinatura") }),
  /** "com vencimento em 10 de março de 2027" -- data COM ano, sempre. */
  z.object({ tipo: z.literal("data"), data: texto }),
  /** "até 10 (dez) dias antes da data do evento" */
  z.object({ tipo: z.literal("dias_antes"), dias: z.number().int().min(0).max(365) }),
  /** "pago pela CONTRATANTE em 20 de agosto de 2026" */
  z.object({ tipo: z.literal("pago"), data: texto }),
]);
export type Vencimento = z.infer<typeof vencimentoSchema>;

export const parcelaSchema = z.object({
  /** 0-100 com ate 2 casas ("15", "30", "33.33"). O valor em R$ e CALCULADO, nunca digitado. */
  percentual: z.number().min(0).max(100),
  /** Compoe o sinal de reserva da data (retido em caso de desistencia). */
  sinal: z.boolean().default(false),
  vencimento: vencimentoSchema,
});
export type Parcela = z.infer<typeof parcelaSchema>;

export const pagamentoSchema = z.object({
  /**
   * "parcelas": a estrutura de sempre (30% sinal + 70% ate 10 dias antes, ou
   * 15/15/70...). "quitado": o valor total ja foi pago antes do contrato.
   */
  modo: z.enum(["parcelas", "quitado"]).default("parcelas"),
  parcelas: z.array(parcelaSchema).max(12).default([]),
  /** Modo quitado: quando foi pago (ISO). */
  quitadoEm: texto,
  /** Modo quitado: que parte do valor pago e o sinal de reserva. */
  percentualSinalQuitado: z.number().min(0).max(100).default(30),
});
export type Pagamento = z.infer<typeof pagamentoSchema>;

// ------------------------------------------------------------------ dados --

/** Tudo que a Mel informa no painel. E o que fica em `contratos.dados`. */
export const dadosContratoSchema = z.object({
  versao: z.literal(1).default(1),
  contratante: contratanteSchema.prefault({}),
  anuente: anuenteSchema.prefault({}),
  evento: eventoSchema.prefault({}),
  servico: servicoSchema,
  pagamento: pagamentoSchema.prefault({}),
  /**
   * Adendos em texto livre: forma de pagamento diferente, pedido especial do
   * cliente, local diferente. E daqui que a IA redige "Das condições especiais".
   */
  observacoes: z.string().max(6000).default(""),
});
export type DadosContrato = z.infer<typeof dadosContratoSchema>;

// -------------------------------------------------------------- documento --

/**
 * Ids estaveis das clausulas do modelo. A numeracao ("CLÁUSULA 7") e calculada
 * na renderizacao; remissoes no texto usam `{{ref:<id>}}` e o proprio numero da
 * clausula e `{{n}}`. Numero digitado a mao e como um dos contratos antigos
 * saiu com duas clausulas 13.
 */
export const IDS_CLAUSULA = [
  "objeto",
  "local",
  "servicos",
  "adicionais",
  "prazos",
  "condicoes_tecnicas",
  "instagram",
  "pagamento",
  "entrega",
  "armazenamento",
  "direitos",
  "alimentacao",
  "alteracoes",
  "desistencia",
  "equipe",
  "condicoes_especiais",
  "assinatura_eletronica",
  "foro",
] as const;
export type IdClausula = (typeof IDS_CLAUSULA)[number];

/** Clausulas sem as quais o contrato nao sai, mesmo que a Mel apague no editor. */
export const CLAUSULAS_OBRIGATORIAS: readonly IdClausula[] = [
  "objeto",
  "local",
  "servicos",
  "pagamento",
  "direitos",
  "desistencia",
  "equipe",
  "assinatura_eletronica",
  "foro",
];

export const clausulaSchema = z.object({
  /** Um de IDS_CLAUSULA, ou "livre-<n>" para clausula que a Mel acrescentou no editor. */
  id: z.string().min(1).max(60),
  /** Sem o "CLÁUSULA N - ": "DO OBJETO DO CONTRATO". */
  titulo: z.string().min(1).max(200),
  /**
   * Um item por paragrafo. Marcacao minima: `**trecho**` sai em negrito (so nas
   * frases limitativas, CDC art. 54 §4º); `{{n}}` e `{{ref:<id>}}` viram numero.
   */
  paragrafos: z.array(z.string().max(6000)).min(1).max(40),
  /** padrao = montado pelo sistema; ia = redigido pelo modelo; editada = a Mel mexeu. */
  origem: z.enum(["padrao", "ia", "editada"]),
  /**
   * Problemas que a validacao achou no texto da IA (numero que nao existe nos
   * dados, trecho vedado pelo CDC). Clausula `ia` com problema BLOQUEIA o PDF
   * ate a Mel editar -- editar e ela assumir o texto.
   */
  problemas: z.array(z.string()).default([]),
});
export type Clausula = z.infer<typeof clausulaSchema>;

export const PAPEIS_ASSINATURA = ["contratante", "contratada", "anuente"] as const;
export type PapelAssinatura = (typeof PAPEIS_ASSINATURA)[number];

export const assinanteSchema = z.object({
  papel: z.enum(PAPEIS_ASSINATURA),
  /** "CONTRATANTE", "CONTRATADA", "ANUENTE" */
  rotulo: z.string(),
  nome: z.string(),
  /** "CPF: 123.456.789-09" / "CNPJ: 53.925.833/0001-20" / "p. Fulano, CPF ..." */
  documento: z.string(),
  /** Para onde o provedor de assinatura manda o link. Nao e impresso no PDF. */
  email: z.string(),
});
export type Assinante = z.infer<typeof assinanteSchema>;

export const parteSchema = z.object({
  rotulo: z.enum(["CONTRATANTE", "CONTRATADA", "ANUENTE"]),
  /** Qualificacao sem o rotulo. Renderizada como "**CONTRATANTE:** texto". */
  texto: z.string(),
});
export type Parte = z.infer<typeof parteSchema>;

/** O contrato pronto para ler, editar e renderizar. E o que fica em `contratos.documento`. */
export const documentoContratoSchema = z.object({
  /** Versao do MODELO de clausulas que gerou o texto ("2026-09-29"). Vai para a trilha. */
  versaoModelo: z.string(),
  titulo: z.string(),
  partes: z.array(parteSchema).min(2).max(3),
  preambulo: z.string(),
  clausulas: z.array(clausulaSchema).min(1).max(40),
  /** "Campinas/SP, na data da última assinatura eletrônica registrada pela plataforma." */
  localData: z.string(),
  assinaturas: z.array(assinanteSchema).min(2).max(3),
});
export type DocumentoContrato = z.infer<typeof documentoContratoSchema>;

// ------------------------------------------------------------------ avisos --

export const avisoSchema = z.object({
  /** sistema = regra deterministica; ia = revisao do modelo. */
  origem: z.enum(["sistema", "ia"]),
  gravidade: z.enum(["bloqueante", "atencao", "sugestao"]),
  /** Id da clausula a que o aviso se refere, quando houver. */
  clausula: z.string().optional(),
  texto: z.string(),
});
export type Aviso = z.infer<typeof avisoSchema>;

// ------------------------------------------------------- assinatura (PDF) --

/**
 * Onde o campo de assinatura de cada parte deve ser posto no PDF, em pontos,
 * com origem no CANTO SUPERIOR ESQUERDO da pagina (como a iLoveAPI espera,
 * "X -Y"). `pagina` comeca em 1. O PDF e gerado por nos, entao sabemos
 * exatamente onde desenhamos cada linha de assinatura.
 */
export const posicaoAssinaturaSchema = z.object({
  papel: z.enum(PAPEIS_ASSINATURA),
  pagina: z.number().int().min(1),
  x: z.number(),
  yTopo: z.number(),
  largura: z.number(),
  altura: z.number(),
});
export type PosicaoAssinatura = z.infer<typeof posicaoAssinaturaSchema>;

// ----------------------------------------------------------------- registro --

/**
 * Ciclo de vida do contrato (coluna `contratos.status`):
 *
 *   rascunho   -> dados salvos, sem texto
 *   redigido   -> texto montado (e, se havia observacoes, redigido pela IA)
 *   pdf_gerado -> PDF pronto para conferir
 *   enviado    -> na plataforma de assinatura; TEXTO TRAVADO
 *   assinado   -> todas as partes assinaram; PDF assinado guardado e imutavel
 *
 * Cancelar o envio (ou a plataforma devolver recusado/expirado) volta para
 * `pdf_gerado`, e o motivo fica em `assinatura_status`.
 */
export const STATUS_CONTRATO = ["rascunho", "redigido", "pdf_gerado", "enviado", "assinado"] as const;
export type StatusContrato = (typeof STATUS_CONTRATO)[number];

/** Status que o provedor de assinatura devolve, normalizado. */
export const STATUS_ASSINATURA = [
  "enviado",
  "concluido",
  "recusado",
  "expirado",
  "cancelado",
] as const;
export type StatusAssinatura = (typeof STATUS_ASSINATURA)[number];

export type SignatarioStatus = {
  papel: PapelAssinatura | null;
  nome: string;
  email: string;
  status: "pendente" | "assinou" | "recusou";
  assinadoEm: string | null;
};

/** Linha de `contratos` como o painel a recebe. */
export type RegistroContrato = {
  lead_id: string;
  created_at: string;
  updated_at: string;
  status: StatusContrato;
  dados: DadosContrato;
  documento: DocumentoContrato | null;
  avisos: Aviso[];
  redigido_em: string | null;
  revisado_em: string | null;
  pdf_gerado_em: string | null;
  pdf_sha256: string | null;
  assinatura_provedor: string | null;
  assinatura_status: StatusAssinatura | null;
  assinatura_signatarios: SignatarioStatus[] | null;
  assinatura_enviada_em: string | null;
  assinatura_atualizada_em: string | null;
  assinado_em: string | null;
};

/** Texto travado: nada de salvar dados, redigir, editar nem regerar o PDF. */
export function textoTravado(status: StatusContrato): boolean {
  return status === "enviado" || status === "assinado";
}
