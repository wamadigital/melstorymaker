// Tipos da arvore de perguntas. O arvore.json e a fonte unica de verdade do
// formulario: nova pergunta = mudanca no JSON, nunca hardcode em componente.

export const CATEGORIAS = ["debutante", "aniversario", "casamento", "corporativo"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const STATUS = ["incompleto", "aguardando_revisao", "enviado"] as const;
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

export type BoasVindas = { titulo: string; texto: string; cta: string };
export type Confirmacao = { titulo: string; texto: string; cta_whatsapp: string };

export type Arvore = {
  boas_vindas: BoasVindas;
  categoria: { tipo: TipoPergunta; pergunta: string; opcoes: OpcaoBruta[] };
  fluxos: Record<Categoria, Passo[]>;
  contato: Passo[];
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
