import { dadosContratoSchema, type DadosContrato, type DocumentoContrato, type RegistroContrato } from "@/lib/contrato/tipos";
import {
  registroPublico,
  sha256Hex,
  type CondicaoEscrita,
  type PatchContrato,
  type RegistroContratoInterno,
} from "@/lib/supabase/contratos";

// SO PARA TESTE: a tabela `contratos` em memoria, com a mesma semantica do
// UPDATE guardado de `salvarRegistro` (status, token, sha do PDF e
// `updated_at`) e o `updated_at` trocado a cada escrita, como faz o trigger
// `contratos_set_updated_at`. Os ganchos deixam o teste encaixar a "outra aba"
// entre a leitura e a escrita de uma rota. Dados todos FICTICIOS.

export const ID = "00000000-0000-4000-8000-000000000001";

export function dadosFicticios(observacoes = ""): DadosContrato {
  return dadosContratoSchema.parse({ servico: { tabela: "2027", pacote: "Pacote Fictício" }, observacoes });
}

/** Documento minimo: o banco falso nao valida, so compara e guarda. */
export function documentoFicticio(texto: string): DocumentoContrato {
  return {
    partes: [],
    preambulo: "",
    clausulas: [{ id: "objeto", titulo: "DO OBJETO", paragrafos: [texto], origem: "padrao", problemas: [] }],
    localData: "",
    assinaturas: [],
  } as unknown as DocumentoContrato;
}

/** O "PDF" de um texto: bytes que so batem com aquele texto. */
export function pdfDe(documento: DocumentoContrato | null) {
  return {
    bytes: new TextEncoder().encode(`%PDF-1.7\n${JSON.stringify(documento)}\n%%EOF\n`),
    posicoes: [{ papel: "contratante" as const, pagina: 1, x: 64, yTopo: 600, largura: 200, altura: 40 }],
  };
}

/** Invariante do B6: "pdf_gerado" so com o PDF do texto que esta no registro. */
export function pdfBateComOTexto(r: Pick<RegistroContrato, "status" | "documento" | "pdf_sha256">): boolean {
  return r.status !== "pdf_gerado" || r.pdf_sha256 === sha256Hex(pdfDe(r.documento).bytes);
}

const BASE: RegistroContratoInterno = {
  lead_id: ID,
  created_at: "2026-09-30T12:00:00.000Z",
  updated_at: "",
  status: "rascunho",
  dados: dadosFicticios(),
  documento: null,
  avisos: [],
  redigido_em: null,
  revisado_em: null,
  pdf_gerado_em: null,
  pdf_sha256: null,
  assinatura_provedor: null,
  assinatura_status: null,
  assinatura_signatarios: null,
  assinatura_enviada_em: null,
  assinatura_atualizada_em: null,
  assinado_em: null,
  pdf_path: null,
  posicoes_assinatura: null,
  assinatura_token: null,
  assinado_path: null,
  trilha_path: null,
};

function atende(linha: RegistroContratoInterno, c: CondicaoEscrita): boolean {
  if (c.status && !c.status.includes(linha.status)) return false;
  if (c.token !== undefined && linha.assinatura_token !== c.token) return false;
  if (c.pdfSha256 !== undefined && linha.pdf_sha256 !== c.pdfSha256) return false;
  if (c.atualizadoEm !== undefined && linha.updated_at !== c.atualizadoEm) return false;
  return true;
}

type Gancho = () => unknown;

/** O que as rotas usam do banco e do Storage (`IoContrato` e o miolo de `IoAssinatura`). */
type IoFalso = {
  ler: (leadId: string) => Promise<RegistroContrato | null>;
  salvar: (leadId: string, patch: PatchContrato, condicao?: CondicaoEscrita) => Promise<RegistroContrato | null>;
  guardarPdf: (caminho: string, bytes: Uint8Array, opcoes: { substituir: boolean }) => Promise<"gravado" | "ja_existia">;
  baixarPdf: (caminho: string) => Promise<Uint8Array | null>;
};

export function bancoFalso(inicial: Partial<RegistroContratoInterno> = {}) {
  let tique = 0;
  // Microssegundos distintos a cada escrita, no formato que o PostgREST devolve.
  const carimbo = () => `2026-09-30T12:00:00.${String(++tique).padStart(6, "0")}+00:00`;
  let linha: RegistroContratoInterno = structuredClone({ ...BASE, ...inicial, updated_at: carimbo() });
  const arquivos = new Map<string, Uint8Array>();
  let aposLer: Gancho | null = null;
  let duranteUpload: Gancho | null = null;

  const gravar = (patch: PatchContrato) => {
    linha = { ...linha, ...structuredClone(patch), updated_at: carimbo() };
  };

  const io: IoFalso = {
    async ler() {
      const foto = registroPublico(structuredClone(linha));
      const g = aposLer;
      aposLer = null;
      if (g) await g();
      return foto;
    },
    async salvar(_id, patch, condicao) {
      if (condicao && !atende(linha, condicao)) return null;
      gravar(patch);
      return registroPublico(structuredClone(linha));
    },
    async guardarPdf(caminho, bytes, opcoes) {
      const g = duranteUpload;
      duranteUpload = null;
      if (g) await g();
      if (!opcoes.substituir && arquivos.has(caminho)) return "ja_existia";
      arquivos.set(caminho, bytes);
      return "gravado";
    },
    async baixarPdf(caminho) {
      return arquivos.get(caminho) ?? null;
    },
  };

  return {
    io,
    arquivos,
    /** A linha como esta no "banco", com as colunas internas. */
    get linha(): RegistroContratoInterno {
      return structuredClone(linha);
    },
    /** A outra aba grava direto, sem guard. */
    deFora(patch: PatchContrato) {
      gravar(patch);
    },
    /** Roda `g` logo depois da PROXIMA leitura (a foto ja foi tirada). */
    depoisDaProximaLeitura(g: Gancho) {
      aposLer = g;
    },
    /** Roda `g` no meio do PROXIMO upload, antes de o arquivo cair no bucket. */
    noProximoUpload(g: Gancho) {
      duranteUpload = g;
    },
  };
}
