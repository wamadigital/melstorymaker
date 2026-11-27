import { z } from "zod";
import { CATEGORIAS, STATUS } from "@/lib/form/types";

export const LIMITE_PAGINA_CAMPANHAS = 25;

const modoSchema = z.enum(["simulacao", "teste", "real"]);
const filtrosSchema = z.object({
  inicio: z.iso.date().nullable(),
  fim: z.iso.date().nullable(),
  categoria: z.enum(CATEGORIAS).nullable(),
  status: z.enum(STATUS).nullable(),
  excluirStatus: z.array(z.enum(STATUS)).max(STATUS.length),
  qualificado: z.boolean().nullable(),
}).refine((f) => !f.inicio || !f.fim || f.inicio <= f.fim, {
  message: "A data inicial deve ser anterior ou igual à final.",
});
export const consultaPublicoSchema = z.object({
  filtros: filtrosSchema,
  modo: modoSchema,
  pagina: z.number().int().min(0).max(100_000),
});
export const iniciarCampanhaSchema = consultaPublicoSchema.omit({ pagina: true }).extend({
  id: z.uuid(),
  nome: z.string().trim().min(1).max(120),
  revisao: z.string().regex(/^[0-9a-f]{32}$/),
  mensagens: z.array(z.string().trim().min(1).max(1024)).min(1),
  intervalo: z.number().int().min(1).max(30).nullable(),
});
export const testeCampanhaSchema = z.object({
  id: z.uuid(),
  nome: z.string().trim().max(120),
  telefone: z.string().trim().min(1).max(24).regex(/^[+0-9 ()-]+$/),
  numero: z.number().int().min(1).max(2_147_483_647),
  mensagem: z.string().trim().min(1).max(1024),
});
export const consentimentoCampanhaSchema = z.object({
  telefone: z.string().regex(/^55\d{10,11}$/),
  autorizado: z.boolean(),
  evidencia: z.string().trim().min(1).max(500),
});
export const acaoCampanhaSchema = z.enum(["pausar", "retomar", "cancelar"]);
export const paginaCampanhaSchema = z.coerce.number().int().min(0).max(100_000);

export type ModoCampanha = z.infer<typeof modoSchema>;
export type FiltrosCampanha = z.infer<typeof filtrosSchema>;
export type AcaoCampanha = z.infer<typeof acaoCampanhaSchema>;

export type ItemPublico = {
  id: string;
  nome: string | null;
  telefone: string | null;
  telefone_original: string | null;
  data_evento: string;
  status: (typeof STATUS)[number];
  resultado: "apto" | "invalido" | "sem_consentimento" | "duplicado" | "fora_do_teste";
};

export type PublicoCampanha = {
  cards: number;
  aptos: number;
  invalidos: number;
  semConsentimento: number;
  duplicados: number;
  foraDoTeste: number;
  revisao: string;
  itens: ItemPublico[];
};

export type DestinatarioCampanha = {
  id: string;
  nome: string | null;
  telefone: string;
  variante: number;
  status: "pendente" | "processando" | "enviado" | "simulado" | "falha" | "ignorado";
  tentativas: number;
  atualizado_em: string | null;
  motivo: string | null;
  eventos: { tentativa: number; iniciada_em: string; resultado: string | null; motivo: string | null }[];
};

export type Campanha = {
  id: string;
  nome: string;
  status: "ativa" | "pausada" | "concluida" | "cancelada";
  modo: ModoCampanha;
  criada_em: string;
  proximo_em: string | null;
  intervalo_min: number | null;
  mensagens: string[];
  filtros: { mensagem_teste?: number };
  contadores: {
    total: number;
    pendentes: number;
    processando: number;
    enviados: number;
    simulados: number;
    falhas: number;
    ignorados: number;
  };
  historico: DestinatarioCampanha[];
};

export type OpcoesCampanha = { workerAtivo: boolean; enviosAtivos: boolean; cadencia: number };
