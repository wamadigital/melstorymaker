import {
  ehEstado, ErroPersistencia, FALHA_CONEXAO,
  type Armazenamento, type FalhaPersistencia,
} from "./persistencia";
import { copiarEstado, estadosIguais, type EstadoFormulario } from "./snapshot";

/** Separada de mel:lead_id: a tentativa ainda não tem ACK confirmado. */
export const CHAVE_TENTATIVA = "mel:criacao_pendente";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TentativaCriacao = {
  id: string;
  snapshotId: string;
  estado: EstadoFormulario;
  /** A intenção pode mudar; o payload incerto original continua imutável. */
  rascunho?: EstadoFormulario;
};
export type LeadCriado = EstadoFormulario & { id: string; status: string; criadoAgora?: boolean };
export type ResultadoCriacao =
  | { ok: true; lead: LeadCriado; tentativa: TentativaCriacao; criadoAgora: boolean }
  | { ok: false; falha: FalhaPersistencia };

function copiarTentativa(tentativa: TentativaCriacao): TentativaCriacao {
  return { ...tentativa, estado: copiarEstado(tentativa.estado), rascunho: tentativa.rascunho ? copiarEstado(tentativa.rascunho) : undefined };
}

export function lerTentativa(armazenamento: Armazenamento | null): TentativaCriacao | null {
  try {
    const texto = armazenamento?.getItem(CHAVE_TENTATIVA);
    if (!texto) return null;
    const tentativa = JSON.parse(texto) as Partial<TentativaCriacao>;
    return typeof tentativa.id === "string" && UUID.test(tentativa.id) &&
      typeof tentativa.snapshotId === "string" && ehEstado(tentativa.estado) &&
      (tentativa.rascunho === undefined || ehEstado(tentativa.rascunho))
      ? tentativa as TentativaCriacao : null;
  } catch { return null; }
}

/** Outra aba pode já ter começado uma tentativa diferente. */
export function limparTentativa(tentativa: TentativaCriacao, armazenamento: Armazenamento | null): boolean {
  try {
    const atual = lerTentativa(armazenamento);
    if (atual?.id !== tentativa.id || atual.snapshotId !== tentativa.snapshotId) return false;
    armazenamento?.removeItem(CHAVE_TENTATIVA);
    return true;
  } catch { return false; }
}

/** A resposta recuperada pode trazer passos já respondidos em outra aba. */
export function respostasIniciaisPreservadas(esperado: EstadoFormulario, salvo: EstadoFormulario): boolean {
  return esperado.categoria === salvo.categoria && Object.entries(esperado.respostas)
    .every(([chave, valor]) => salvo.respostas[chave] === valor);
}

/** Uma identidade e um payload imutáveis até confirmar a resposta da criação. */
export class CriacaoLead {
  private tentativa: TentativaCriacao | null;
  private tarefa: Promise<ResultadoCriacao> | null = null;
  private salvoNoAparelho = false;

  constructor(private readonly deps: {
    armazenamento: Armazenamento | null;
    enviar: (tentativa: TentativaCriacao) => Promise<LeadCriado>;
    consultar: (id: string) => Promise<LeadCriado | null>;
    gerarId?: () => string;
    /** /continuar ou outro lead confirmado tem prioridade sobre um slot antigo. */
    leadConfirmadoAtual?: string | null;
  }) {
    const salva = lerTentativa(deps.armazenamento);
    this.tentativa = salva && deps.leadConfirmadoAtual && salva.id !== deps.leadConfirmadoAtual ? null : salva;
    this.salvoNoAparelho = !!this.tentativa;
  }

  obterTentativa(): TentativaCriacao | null { return this.tentativa ? copiarTentativa(this.tentativa) : null; }
  estaSalvoNoAparelho(): boolean { return this.salvoNoAparelho; }

  /** Só depois de aplicar o ACK e guardar a chave do lead confirmado. */
  confirmar(tentativa: TentativaCriacao): void {
    if (this.tentativa?.id === tentativa.id && this.tentativa.snapshotId === tentativa.snapshotId) {
      this.tentativa = null;
      this.salvoNoAparelho = false;
    }
    limparTentativa(tentativa, this.deps.armazenamento);
  }

  enviar(estado: EstadoFormulario): Promise<ResultadoCriacao> {
    if (!this.tentativa) {
      const id = (this.deps.gerarId ?? (() => crypto.randomUUID()))();
      this.tentativa = { id, snapshotId: `${id}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`, estado: copiarEstado(estado), rascunho: copiarEstado(estado) };
    } else if (!estadosIguais(this.tentativa.rascunho ?? this.tentativa.estado, estado)) {
      this.tentativa = { ...this.tentativa, snapshotId: `${this.tentativa.id}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`, rascunho: copiarEstado(estado) };
    }
    try {
      if (!this.deps.armazenamento) throw new Error("armazenamento indisponível");
      this.deps.armazenamento.setItem(CHAVE_TENTATIVA, JSON.stringify(this.tentativa));
      this.salvoNoAparelho = true;
    } catch { this.salvoNoAparelho = false; }
    return this.executar(false);
  }

  recuperar(): Promise<ResultadoCriacao> | null {
    return this.tentativa ? this.executar(true) : null;
  }

  private executar(consultar: boolean): Promise<ResultadoCriacao> {
    if (this.tarefa) return this.tarefa;
    const tentativa = copiarTentativa(this.tentativa!);
    this.tarefa = (async (): Promise<ResultadoCriacao> => {
      try {
        // 404 não encerra a tentativa: o INSERT original ainda pode concluir.
        const existente = consultar ? await this.deps.consultar(tentativa.id) : null;
        const lead = existente ?? await this.deps.enviar(tentativa);
        if (lead.id !== tentativa.id || !ehEstado(lead) || typeof lead.status !== "string") {
          return { ok: false, falha: { tipo: "servidor", mensagem: "Não consegui confirmar o início do orçamento. Tente novamente para recuperar a mesma tentativa." } };
        }
        return { ok: true, lead: { ...copiarEstado(lead), id: lead.id, status: lead.status }, tentativa, criadoAgora: !existente && lead.criadoAgora === true };
      } catch (erro) {
        return { ok: false, falha: erro instanceof ErroPersistencia ? erro.falha : FALHA_CONEXAO };
      }
    })().finally(() => { this.tarefa = null; });
    return this.tarefa;
  }
}
