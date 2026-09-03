// Tipos da arvore de perguntas. O arvore.json e a fonte unica de verdade do
// formulario: nova pergunta = mudanca no JSON, nunca hardcode em componente.

export const CATEGORIAS = ["debutante", "aniversario", "casamento", "corporativo"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

// Ordem = ordem do funil, e tambem a ordem das colunas do quadro em /admin.
// `incompleto` aparece para a Mel como "Novo" (ver ROTULO_STATUS): o valor e
// contrato interno -- significa "o formulario ainda aceita escrita anonima" --
// e o rotulo e a palavra de CRM para a mesma raia.
export const STATUS = ["incompleto", "aguardando_revisao", "enviado", "virou_cliente"] as const;
export type Status = (typeof STATUS)[number];

export type TipoPergunta =
  | "texto"
  | "data"
  | "hora"
  | "escolha_unica"
  | "email"
  | "telefone"
  | "numero";

/**
 * Arte usada no PDF. NAO e a mesma coisa que `Categoria`: aniversario resolve
 * entre duas artes conforme a idade, mas continua sendo uma categoria so no
 * banco. Manter os dois conceitos separados evita mexer no enum do Postgres --
 * ou seja, evita migration.
 */
export const TEMPLATES = [
  "debutante",
  "aniversario_infantil",
  "aniversario_adulto",
  "casamento",
  "corporativo",
] as const;
export type TemplateId = (typeof TEMPLATES)[number];

/** 14 anos ou menos usa a arte infantil; 15 ou mais, a de adulto. */
export const IDADE_MAXIMA_INFANTIL = 14;

/**
 * Duas formas de opcao convivem no arvore.json: a pergunta de categoria usa
 * objetos {valor, rotulo}, enquanto as perguntas dentro de `fluxos` usam
 * strings puras (["Sim", "Nao"]). O engine normaliza as duas em `Opcao`.
 */
export type OpcaoBruta = string | { valor: string; rotulo: string };
export type Opcao = { valor: string; rotulo: string };

export type Passo = {
  id: string;
  tipo: TipoPergunta;
  pergunta: string;
  obrigatorio?: boolean;
  placeholder?: string;
  mascara?: string;
  /**
   * Em `data`, string ISO ou o literal "hoje". Em `numero`, o valor numerico.
   * Os dois tipos convivem no mesmo campo porque o arvore.json e o schema.
   */
  min?: string | number;
  max?: string | number;
  opcoes?: OpcaoBruta[];
  /** Ramificacao: o passo so aparece se as respostas baterem com este mapa. */
  exibir_se?: Record<string, string>;
};

/**
 * As duas portas da tela de abertura. O lead que ja sabe o que quer fala com a
 * Mel na hora; quem quer numero preenche o formulario. Antes havia so a
 * segunda, e quem nao estava disposto a responder oito perguntas simplesmente
 * fechava a aba -- sem virar lead e sem virar conversa.
 */
export type Porta = { rotulo: string; detalhe: string };
export type BoasVindas = {
  titulo: string;
  texto: string;
  cta_whatsapp: Porta;
  cta_formulario: Porta;
};
export type Confirmacao = { titulo: string; texto: string; cta_whatsapp: string };

/**
 * `contato` e o bloco de perguntas que vale para TODAS as categorias, partido
 * em dois porque as duas metades nao ficam no mesmo lugar da fila:
 * `abertura` vem antes do fluxo da categoria, `fechamento` depois.
 *
 * O WhatsApp esta na abertura de proposito: e a unica resposta que continua
 * util quando o lead abandona no meio. Perguntado no fim, todo abandono virava
 * um registro que a Mel nao tinha como contatar.
 */
export type Contato = { abertura: Passo[]; fechamento: Passo[] };

export type Arvore = {
  boas_vindas: BoasVindas;
  categoria: { tipo: TipoPergunta; pergunta: string; opcoes: OpcaoBruta[] };
  fluxos: Record<Categoria, Passo[]>;
  contato: Contato;
  confirmacao: Confirmacao;
};

export type Respostas = Record<string, string>;

export type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
  categoria: Categoria;
  status: Status;
  respostas: Respostas;
  passo_atual: string | null;
  nome_display: string | null;
  data_evento: string | null;
  email: string | null;
  whatsapp: string | null;
  pdf_url: string | null;
  pdf_gerado_em: string | null;
  enviado_em: string | null;
};

export function isCategoria(v: unknown): v is Categoria {
  return typeof v === "string" && (CATEGORIAS as readonly string[]).includes(v);
}
