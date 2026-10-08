import { CHAVE_LEAD } from "./retomada";
import { copiarEstado, estadosIguais, respostasIguais, type EstadoFormulario } from "./snapshot";
import { isCategoria } from "./types";

export type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type FalhaPersistencia = {
  tipo: "conexao" | "servidor" | "limite" | "invalido" | "conflito" | "encerrado";
  mensagem: string;
  campos?: Record<string, string>;
};
export type ResultadoPersistencia =
  | { ok: true; estado: EstadoFormulario }
  | { ok: false; falha: FalhaPersistencia };
/** A consulta de recuperação preserva o erro HTTP, distinto de falha de rede. */
export class ErroPersistencia extends Error {
  constructor(readonly falha: FalhaPersistencia) { super(falha.mensagem); }
}
export type EstadoPersistencia = {
  pendente: boolean;
  enviando: boolean;
  salvoNoAparelho: boolean;
  falha: FalhaPersistencia | null;
};
export type RascunhoFormulario = {
  leadId: string;
  snapshotId: string;
  estado: EstadoFormulario;
  base: EstadoFormulario;
  /** Último PATCH enviado: a resposta pode ter se perdido após a escrita. */
  tentado?: EstadoFormulario;
};

/** Armazenamento bloqueado não transforma um POST confirmado em falha de rede. */
export function armazenamentoLocal(): Armazenamento | null {
  try { return window.localStorage; } catch { return null; }
}

export function lerLeadSalvo(armazenamento: Armazenamento | null): string | null {
  try { return armazenamento?.getItem(CHAVE_LEAD) ?? null; } catch { return null; }
}

export function guardarLead(id: string, armazenamento: Armazenamento | null): boolean {
  try {
    if (!armazenamento) return false;
    armazenamento.setItem(CHAVE_LEAD, id);
    return true;
  } catch { return false; }
}

export function esquecerLead(id: string, armazenamento: Armazenamento | null): void {
  try {
    // Outra aba pode já ter começado um orçamento diferente.
    if (armazenamento?.getItem(CHAVE_LEAD) === id) armazenamento.removeItem(CHAVE_LEAD);
  } catch { /* A confirmação no servidor continua valendo. */ }
}

export function chaveRascunho(id: string): string { return `mel:rascunho:${id}`; }

export function ehEstado(valor: unknown): valor is EstadoFormulario {
  if (!valor || typeof valor !== "object") return false;
  const e = valor as Partial<EstadoFormulario>;
  return isCategoria(e.categoria) && (e.passo_atual === null || typeof e.passo_atual === "string") &&
    !!e.respostas && typeof e.respostas === "object" && !Array.isArray(e.respostas) &&
    Object.values(e.respostas).every((v) => typeof v === "string");
}

export function lerRascunho(id: string, armazenamento: Armazenamento | null): RascunhoFormulario | null {
  try {
    const texto = armazenamento?.getItem(chaveRascunho(id));
    if (!texto) return null;
    const r = JSON.parse(texto) as Partial<RascunhoFormulario>;
    return r.leadId === id && typeof r.snapshotId === "string" && ehEstado(r.estado) && ehEstado(r.base) &&
      (r.tentado === undefined || ehEstado(r.tentado))
      ? r as RascunhoFormulario : null;
  } catch { return null; }
}

export function limparRascunho(id: string, armazenamento: Armazenamento | null, snapshotId?: string): boolean {
  try {
    if (snapshotId && lerRascunho(id, armazenamento)?.snapshotId !== snapshotId) return false;
    armazenamento?.removeItem(chaveRascunho(id));
    return true;
  } catch { return false; /* Não bloqueia envio ou confirmação. */ }
}

/** Concluir uma aba não apaga respostas pendentes diferentes de outra aba. */
export function concluirLeadLocal(
  id: string,
  confirmado: Pick<EstadoFormulario, "categoria" | "respostas">,
  armazenamento: Armazenamento | null,
  snapshotDescartado?: string | null,
): boolean {
  const atual = lerRascunho(id, armazenamento);
  if (atual) {
    if (atual.snapshotId !== snapshotDescartado && !respostasIguais(atual.estado, confirmado)) return false;
    if (!limparRascunho(id, armazenamento, atual.snapshotId)) return false;
  }
  // Mantém a chave de retomada quando um rascunho divergente foi preservado.
  esquecerLead(id, armazenamento);
  return true;
}

export const FALHA_CONEXAO: FalhaPersistencia = {
  tipo: "conexao", mensagem: "Não consegui conectar. Suas respostas continuam aqui; confira a conexão e tente novamente.",
};

export async function falhaDaResposta(resposta: Response): Promise<FalhaPersistencia> {
  const corpo = await resposta.json().catch(() => null) as { erro?: string; codigo?: string; campos?: Record<string, string> } | null;
  const mensagem = corpo?.erro;
  if (resposta.status === 409) {
    return corpo?.codigo === "formulario_enviado"
      ? { tipo: "encerrado", mensagem: mensagem ?? "Esse formulário já foi enviado. Abra o link novamente para começar outro orçamento." }
      : { tipo: "conflito", mensagem: mensagem ?? "Esse orçamento foi atualizado em outra aba. Confira as respostas salvas antes de continuar." };
  }
  if (resposta.status === 429) return { tipo: "limite", mensagem: mensagem ?? "Muitas tentativas. Aguarde um instante e tente salvar novamente." };
  if (resposta.status >= 500) return { tipo: "servidor", mensagem: mensagem ?? "Não consegui salvar no servidor agora. Tente novamente em instantes." };
  return { tipo: "invalido", mensagem: mensagem ?? "Não consegui salvar essas respostas. Confira os dados e tente novamente.", campos: corpo?.campos };
}

export function permiteNovaTentativa(falha: FalhaPersistencia | null, automatica = false): boolean {
  return !!falha && (falha.tipo === "conexao" || falha.tipo === "servidor" || (!automatica && falha.tipo === "limite"));
}

/** Um PATCH ativo por lead; a última pendência carrega todas as respostas. */
export class FilaAutosave {
  private base: EstadoFormulario;
  private pendente: RascunhoFormulario | null = null;
  private tarefa: Promise<boolean> | null = null;
  private recuperacao: Promise<boolean> | null = null;
  private tentado: EstadoFormulario | null = null;
  private enviando = false;
  private salvoNoAparelho = false;
  private falha: FalhaPersistencia | null = null;
  private parada = false;

  constructor(
    readonly leadId: string,
    base: EstadoFormulario,
    private readonly deps: {
      enviar: (estado: EstadoFormulario, base: EstadoFormulario) => Promise<ResultadoPersistencia>;
      /** Consultada só após transporte incerto; null significa formulário fechado. */
      consultar?: () => Promise<EstadoFormulario | null>;
      armazenamento: Armazenamento | null;
      aoMudar: (estado: EstadoPersistencia) => void;
    },
  ) { this.base = copiarEstado(base); }

  obterBase(): EstadoFormulario { return copiarEstado(this.base); }
  obterFalha(): FalhaPersistencia | null { return this.falha; }
  obterSnapshotPendenteId(): string | null { return this.pendente?.snapshotId ?? null; }

  private publicar(): void {
    if (!this.parada) this.deps.aoMudar({
      pendente: !!this.pendente || this.enviando, enviando: this.enviando,
      salvoNoAparelho: this.salvoNoAparelho, falha: this.falha,
    });
  }

  private guardar(rascunho: RascunhoFormulario): void {
    try {
      if (!this.deps.armazenamento) throw new Error("armazenamento indisponível");
      this.deps.armazenamento.setItem(chaveRascunho(this.leadId), JSON.stringify(rascunho));
      this.salvoNoAparelho = true;
    } catch { this.salvoNoAparelho = false; }
  }

  /** Retoma somente o UUID atual; uma base divergente nunca é reenviada às cegas. */
  restaurar(rascunho: RascunhoFormulario): void {
    if (rascunho.leadId !== this.leadId || this.parada) return;
    if (estadosIguais(rascunho.estado, this.base)) {
      limparRascunho(this.leadId, this.deps.armazenamento, rascunho.snapshotId);
      return;
    }
    this.pendente = { ...rascunho, estado: copiarEstado(rascunho.estado), base: copiarEstado(rascunho.base) };
    this.tentado = rascunho.tentado ? copiarEstado(rascunho.tentado) : null;
    this.salvoNoAparelho = true;
    if (!estadosIguais(rascunho.base, this.base) && !(this.tentado && estadosIguais(this.tentado, this.base))) {
      this.falha = { tipo: "conflito", mensagem: "Esse orçamento foi atualizado enquanto você estava fora. Seu rascunho continua neste aparelho; confira as respostas salvas antes de continuar." };
      this.publicar();
      return;
    }
    this.pendente.base = this.obterBase();
    this.pendente.tentado = undefined;
    this.tentado = null;
    this.guardar(this.pendente);
    this.publicar();
    void this.iniciar();
  }

  enfileirar(estado: EstadoFormulario): void {
    if (this.parada) return;
    this.pendente = {
      leadId: this.leadId, snapshotId: `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`,
      estado: copiarEstado(estado), base: this.falha?.tipo === "conflito" && this.pendente
        ? copiarEstado(this.pendente.base) : this.obterBase(),
      tentado: this.tentado ? copiarEstado(this.tentado) : undefined,
    };
    this.guardar(this.pendente);
    if (permiteNovaTentativa(this.falha) && this.tentado) {
      this.publicar();
      void this.tentarNovamente();
      return;
    }
    if (this.falha?.tipo !== "conflito" && this.falha?.tipo !== "encerrado") this.falha = null;
    this.publicar();
    void this.iniciar();
  }

  /** Um submit em conflito também preserva o último estado sem novo PATCH. */
  reter(estado: EstadoFormulario, falha: FalhaPersistencia): void {
    if (this.parada) return;
    this.falha = falha;
    this.pendente = {
      leadId: this.leadId, snapshotId: `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`,
      estado: copiarEstado(estado), base: this.obterBase(),
    };
    this.guardar(this.pendente);
    this.publicar();
  }

  private iniciar(): Promise<boolean> {
    if (this.tarefa) return this.tarefa;
    if (this.parada || this.falha) return Promise.resolve(false);
    if (!this.pendente) return Promise.resolve(true);
    this.tarefa = this.executar().finally(() => {
      this.tarefa = null;
      // Uma edição pode chegar entre o último ACK e este finally.
      if (this.pendente && !this.falha && !this.parada) void this.iniciar();
    });
    return this.tarefa;
  }

  private async executar(): Promise<boolean> {
    while (this.pendente && !this.parada) {
      const rascunho = this.pendente;
      this.pendente = null;
      this.tentado = copiarEstado(rascunho.estado);
      rascunho.tentado = copiarEstado(rascunho.estado);
      this.guardar(rascunho);
      this.enviando = true;
      this.publicar();
      let resultado: ResultadoPersistencia;
      try { resultado = await this.deps.enviar(copiarEstado(rascunho.estado), this.obterBase()); }
      catch { resultado = { ok: false, falha: FALHA_CONEXAO }; }
      // Uma fila substituída não pode gravar por cima do rascunho da nova.
      if (this.parada) return false;
      this.enviando = false;
      if (!resultado.ok) {
        this.pendente ??= rascunho;
        this.falha = resultado.falha;
        this.guardar(this.pendente);
        this.publicar();
        return false;
      }
      this.base = copiarEstado(resultado.estado);
      this.tentado = null;
      // enfileirar() pode ter recebido uma edição enquanto enviar() aguardava.
      const pendente = this.pendente as RascunhoFormulario | null;
      if (pendente) {
        pendente.base = this.obterBase();
        pendente.tentado = undefined;
        this.guardar(pendente);
      } else {
        limparRascunho(this.leadId, this.deps.armazenamento, rascunho.snapshotId);
      }
      this.falha = null;
      this.publicar();
    }
    return !this.parada;
  }

  async confirmarTudo(): Promise<boolean> {
    if (this.recuperacao && !await this.recuperacao) return false;
    while (this.pendente || this.tarefa) {
      if (!await this.iniciar()) return false;
    }
    return !this.parada && !this.falha;
  }

  tentarNovamente(automatica = false): Promise<boolean> {
    if (this.recuperacao) return this.recuperacao;
    if (!permiteNovaTentativa(this.falha, automatica)) return Promise.resolve(!this.falha);
    this.recuperacao = (async () => {
      if (this.tentado && this.deps.consultar) {
        let atual: EstadoFormulario | null;
        try { atual = await this.deps.consultar(); }
        catch (erro) {
          this.falha = erro instanceof ErroPersistencia ? erro.falha : FALHA_CONEXAO;
          this.publicar();
          return false;
        }
        if (this.parada) return false;
        if (!atual) {
          this.falha = { tipo: "encerrado", mensagem: "Esse formulário já foi enviado." };
          this.publicar();
          return false;
        }
        if (this.pendente && estadosIguais(atual, this.pendente.estado)) {
          limparRascunho(this.leadId, this.deps.armazenamento, this.pendente.snapshotId);
          this.pendente = null;
        } else if (!estadosIguais(atual, this.base) && !estadosIguais(atual, this.tentado)) {
          this.falha = { tipo: "conflito", mensagem: "Esse orçamento foi atualizado em outra aba. Seu rascunho continua neste aparelho; confira as respostas salvas antes de continuar." };
          this.publicar();
          return false;
        }
        this.base = copiarEstado(atual);
        this.tentado = null;
        if (this.pendente) {
          this.pendente.base = this.obterBase();
          this.pendente.tentado = undefined;
          this.guardar(this.pendente);
        }
      }
      this.falha = null;
      this.publicar();
      return this.iniciar();
    })().finally(() => { this.recuperacao = null; });
    return this.recuperacao;
  }

  parar(): void { this.parada = true; }
}
