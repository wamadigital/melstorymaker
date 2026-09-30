import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  GRAVIDADES_REVISAO,
  PROMPT_CONDICOES_ESPECIAIS,
  PROMPT_EXTRACAO,
  PROMPT_REVISAO,
  SCHEMA_CONDICOES_ESPECIAIS,
  SCHEMA_EXTRACAO,
  SCHEMA_REVISAO,
  mensagemCondicoesEspeciais,
  mensagemExtracao,
  mensagemRevisao,
  type EntradaContratoIa,
  type EsquemaJson,
} from "@/lib/contrato/prompts";
import { limparCnpj } from "@/lib/contrato/documento";
import {
  IDS_CLAUSULA,
  contratanteSchema,
  type Aviso,
  type Contratante,
} from "@/lib/contrato/tipos";

// A IA do contrato (SPEC secao 8, decisao travada 2). Ela faz TRES coisas e
// nenhuma outra: extrai os dados de quem assina de um texto colado, redige a
// clausula "Das condicoes especiais" a partir das observacoes da Mel, e revisa
// o contrato montado devolvendo AVISOS. Valor, data, parcela, extenso e
// numeracao sao do codigo, testado; o que sai daqui e sempre conferido pela
// validacao (validar.ts) e pela Mel antes de virar PDF.
//
// Privacidade: a redacao e a revisao recebem o contrato ANONIMIZADO (nomes,
// CPF, e-mail e endereco trocados por marcadores em anonimizar.ts). A extracao
// e a excecao inevitavel -- o texto colado e justamente o dado pessoal. Por
// isso o log daqui NUNCA leva conteudo: so "[contrato:ia] <operacao> <codigo>".

// ------------------------------------------------------------- constantes --

export const MODELO_IA = "claude-fable-5-1";

/**
 * Fallback no servidor: se o classificador de seguranca do Fable recusar (um
 * falso positivo e possivel ate em texto de contrato), a API refaz o MESMO
 * pedido num modelo de reserva escolhido por ela, na mesma chamada. "default"
 * deixa a lista de modelos com a Anthropic -- nao ha nome de modelo para
 * manter atualizado aqui. O beta e o da forma "default"; o de 2026-06-01 e so
 * da forma em lista e a API recusa a combinacao trocada.
 */
export const BETAS_IA = ["server-side-fallback-2026-07-01"] as const;

/** Folga larga: o JSON e pequeno, mas raciocinio e resposta dividem o teto. */
const MAX_TOKENS = 32_000;

/**
 * Prazo TOTAL de uma operacao, com as retentativas dentro dele. Vai como
 * `signal: AbortSignal.timeout(...)` no stream, e so o signal da essa garantia:
 * o `timeout` do SDK e armado em volta do fetch e desarmado quando chegam os
 * cabecalhos, entao num stream ele nao limita o corpo -- e o corpo e o
 * raciocinio mais o JSON, que e onde uma redacao pode levar minutos. Sem o
 * signal, uma resposta de mais de 300 s era cortada pela Vercel (maxDuration
 * das rotas) antes de `condicoesEspeciais` voltar, e o contrato nao saia nem
 * sem a clausula.
 *
 * 250 s deixa folga, dentro dos 300, para a rota montar e gravar o contrato.
 * Redigir e revisar retentam UMA vez (duas tentativas longas nao caberiam); a
 * extracao e curta, entao retenta duas vezes dentro de um prazo menor.
 */
const PRAZO_LONGO_MS = 250_000;
const PRAZO_EXTRACAO_MS = 120_000;

/** Mais que isso a Mel nao le; os mais graves ficam. */
const MAX_AVISOS = 12;

// ------------------------------------------------------------------ erros --

/** Sem ANTHROPIC_API_KEY. A rota responde 503 com a mensagem. */
export class IaIndisponivelError extends Error {
  constructor(message = "A IA não está configurada (falta ANTHROPIC_API_KEY).") {
    super(message);
    this.name = "IaIndisponivelError";
  }
}

/**
 * Qualquer falha da IA, ja com mensagem para a TELA (pt-BR, sem detalhe
 * tecnico). `codigo` e para o log e para a rota escolher o status HTTP
 * ("429", "refusal", "max_tokens", "json"...); nunca contem conteudo.
 *
 * O erro original do SDK NAO vai como `cause` de proposito: a mensagem dele
 * pode trazer o corpo da resposta da API, e quem loga o IaError inteiro
 * levaria isso junto.
 */
export class IaError extends Error {
  constructor(
    message: string,
    readonly codigo: string,
  ) {
    super(message);
    this.name = "IaError";
  }
}

// ------------------------------------------------------------- interface --

export type EntradaRedacao = EntradaContratoIa;

export type EntradaRevisao = EntradaContratoIa & {
  /**
   * Textos dos avisos que o sistema ja deu (avisosDeterministicos). Opcional:
   * so serve para o revisor nao repetir o que a Mel ja esta vendo.
   */
  avisosSistema?: string[];
};

export type ResultadoExtracao = {
  /**
   * Formato completo de `Contratante`, com "" em tudo que o texto nao trazia e
   * `genero` SEMPRE "" (quem escolhe o tratamento e a Mel). O painel mescla so
   * os campos nao-vazios sobre o que ja esta preenchido.
   */
  contratante: Contratante;
  /** Avisos curtos para a Mel ("o texto traz dois nomes"). */
  observacoes: string[];
};

export type ResultadoCondicoesEspeciais = {
  /** false = nada nas observacoes precisa virar clausula. */
  necessaria: boolean;
  /** Paragrafos com marcadores ([HOMENAGEADO]); desanonimizar vem depois. */
  paragrafos: string[];
  /** O que ficou de fora, com a instrucao do campo a usar. Vira aviso. */
  naoIncorporado: string[];
};

export interface RedatorContrato {
  extrairContratante(texto: string): Promise<ResultadoExtracao>;
  redigirCondicoesEspeciais(e: EntradaRedacao): Promise<ResultadoCondicoesEspeciais>;
  revisar(e: EntradaRevisao): Promise<Aviso[]>;
}

/** O que cada chamada passa ao SDK alem do corpo: o prazo total e as retentativas. */
export type OpcoesChamadaIa = {
  signal: AbortSignal;
  maxRetries: number;
  /** Por tentativa, ate os cabecalhos. O que limita o corpo do stream e o `signal`. */
  timeout: number;
};

/**
 * O pedaco do client da Anthropic que este modulo usa. Existe para os testes
 * injetarem um client falso (sem rede); o `Anthropic` de verdade satisfaz esta
 * forma sem adaptador.
 */
export type ClienteIa = {
  beta: {
    messages: {
      stream(corpo: BetaMessageStreamParams, opcoes?: OpcoesChamadaIa): { finalMessage(): Promise<BetaMessage> };
    };
  };
};

// ------------------------------------------------------------- disponivel --

function lerChave(): string {
  return env.ANTHROPIC_API_KEY?.trim() ?? "";
}

/** Para o painel desabilitar "Preencher com IA" e avisar em vez de falhar no clique. */
export function iaDisponivel(): boolean {
  return lerChave() !== "";
}

export type OpcoesRedator = {
  /** So para teste: client falso, sem rede. */
  cliente?: ClienteIa;
  /** So para teste: prazo de uma operacao em ms (para provar o corte sem esperar minutos). */
  prazosMs?: Partial<Record<Operacao, number>>;
};

/**
 * Sem chave, devolve um redator que recusa tudo com IaIndisponivelError -- quem
 * chama trata um caso so ("a IA nao esta disponivel") em vez de checar a chave
 * em cada rota.
 */
export function criarRedator(opcoes: OpcoesRedator = {}): RedatorContrato {
  if (opcoes.cliente) return new RedatorAnthropic(opcoes.cliente, opcoes.prazosMs);

  const chave = lerChave();
  if (!chave) return new RedatorIndisponivel();

  // Prazo e retentativas vao por chamada (OPERACOES); estes sao so o piso.
  return new RedatorAnthropic(new Anthropic({ apiKey: chave, timeout: PRAZO_LONGO_MS, maxRetries: 1 }), opcoes.prazosMs);
}

class RedatorIndisponivel implements RedatorContrato {
  async extrairContratante(): Promise<ResultadoExtracao> {
    throw new IaIndisponivelError();
  }
  async redigirCondicoesEspeciais(): Promise<ResultadoCondicoesEspeciais> {
    throw new IaIndisponivelError();
  }
  async revisar(): Promise<Aviso[]> {
    throw new IaIndisponivelError();
  }
}

// ------------------------------------------------------------- operacoes --

export type Operacao = "extrair" | "redigir" | "revisar";

type ConfigOperacao = {
  sistema: string;
  schema: EsquemaJson;
  /**
   * Extrair e separar campo de um texto curto: "medium" basta e responde mais
   * rapido com a Mel esperando. Redigir e revisar texto juridico pedem "high".
   */
  effort: "medium" | "high";
  /** Mensagem da tela quando o modelo (e o fallback) recusam. */
  recusa: string;
  /** Prazo total da operacao, retentativas incluidas (ver PRAZO_LONGO_MS). */
  prazoMs: number;
  /** Retentativas do SDK (408/409/429/5xx e falha de conexao), dentro do prazo. */
  retentativas: number;
  /** O que a Mel pode fazer quando o prazo estoura. */
  seDemorar: string;
};

const OPERACOES: Record<Operacao, ConfigOperacao> = {
  extrair: {
    sistema: PROMPT_EXTRACAO,
    schema: SCHEMA_EXTRACAO,
    effort: "medium",
    recusa: "A IA recusou o pedido; confira o texto colado e tente de novo.",
    prazoMs: PRAZO_EXTRACAO_MS,
    retentativas: 2,
    seDemorar: "Tente de novo; se persistir, cole só os dados de quem assina.",
  },
  redigir: {
    sistema: PROMPT_CONDICOES_ESPECIAIS,
    schema: SCHEMA_CONDICOES_ESPECIAIS,
    effort: "high",
    recusa: "A IA recusou o pedido; tente reformular as observações.",
    prazoMs: PRAZO_LONGO_MS,
    retentativas: 1,
    seDemorar: "Tente de novo; se persistir, encurte as observações.",
  },
  revisar: {
    sistema: PROMPT_REVISAO,
    schema: SCHEMA_REVISAO,
    effort: "high",
    recusa: "A IA recusou a revisão deste contrato. Tente de novo em instantes.",
    prazoMs: PRAZO_LONGO_MS,
    retentativas: 1,
    seDemorar: "Tente de novo em alguns minutos.",
  },
};

/**
 * Monta a requisicao. Exportada para o teste conferir o que vai para a API
 * sem depender de rede.
 *
 * O que NAO vai, de proposito (cada um da 400 no Fable 5.1):
 * - `thinking`: o raciocinio e sempre ligado; `disabled` ou `budget_tokens`
 *   sao recusados. A profundidade se controla pelo `effort`.
 * - `temperature`/`top_p`/`top_k`: removidos nesta familia.
 * - `tool_choice` forcado e mensagem final de assistente (prefill): a saida em
 *   JSON vem da saida estruturada (`output_config.format`), que e o caminho
 *   suportado para isso.
 */
export function montarRequisicao(operacao: Operacao, mensagem: string): BetaMessageStreamParams {
  const config = OPERACOES[operacao];
  return {
    model: MODELO_IA,
    max_tokens: MAX_TOKENS,
    betas: [...BETAS_IA],
    fallbacks: "default",
    // O system e estavel entre chamadas; o cache_control no ultimo (unico)
    // bloco deixa o prompt em cache e o que varia fica so na mensagem.
    system: [{ type: "text", text: config.sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: mensagem }],
    output_config: {
      effort: config.effort,
      format: { type: "json_schema", schema: config.schema },
    },
  };
}

// ---------------------------------------------------------- saidas (zod) --

// Espelham os esquemas JSON de prompts.ts. A saida estruturada ja garante a
// forma, mas o parse aqui e a ultima porta antes do painel: se a API mudar ou o
// fallback responder fora do combinado, o erro e nosso e legivel, nao um
// `undefined` no meio do contrato.

const enderecoIa = z.object({
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  uf: z.string(),
  cep: z.string(),
});

const saidaExtracao = z.object({
  tipo: z.enum(["pf", "pj"]),
  pf: z.object({
    nome: z.string(),
    nacionalidade: z.string(),
    cpf: z.string(),
    email: z.string(),
    telefone: z.string(),
    endereco: enderecoIa,
  }),
  pj: z.object({
    razaoSocial: z.string(),
    cnpj: z.string(),
    endereco: enderecoIa,
    representante: z.object({
      nome: z.string(),
      cpf: z.string(),
      cargo: z.string(),
      email: z.string(),
      telefone: z.string(),
    }),
  }),
  vinculo: z.string(),
  observacoes: z.array(z.string()),
});

const saidaCondicoes = z.object({
  necessaria: z.boolean(),
  paragrafos: z.array(z.string()),
  naoIncorporado: z.array(z.string()),
});

const saidaRevisao = z.object({
  avisos: z.array(
    z.object({
      clausula: z.string(),
      texto: z.string(),
      gravidade: z.enum(GRAVIDADES_REVISAO),
    }),
  ),
});

// ---------------------------------------------------------------- redator --

export class RedatorAnthropic implements RedatorContrato {
  constructor(
    private readonly cliente: ClienteIa,
    private readonly prazosMs: Partial<Record<Operacao, number>> = {},
  ) {}

  async extrairContratante(texto: string): Promise<ResultadoExtracao> {
    if (!texto.trim()) {
      throw new IaError("Cole o texto com os dados de quem assina antes de pedir à IA.", "vazio");
    }
    const saida = await this.chamar("extrair", mensagemExtracao(texto), saidaExtracao);
    return {
      contratante: paraContratante(saida),
      observacoes: limparLista(saida.observacoes),
    };
  }

  async redigirCondicoesEspeciais(e: EntradaRedacao): Promise<ResultadoCondicoesEspeciais> {
    // Sem observacao nao ha o que redigir: nem gasta a chamada.
    if (!e.observacoes.trim()) {
      return { necessaria: false, paragrafos: [], naoIncorporado: [] };
    }
    const saida = await this.chamar("redigir", mensagemCondicoesEspeciais(e), saidaCondicoes);
    const paragrafos = saida.necessaria ? limparParagrafos(saida.paragrafos) : [];
    return {
      necessaria: paragrafos.length > 0,
      paragrafos,
      naoIncorporado: limparLista(saida.naoIncorporado),
    };
  }

  async revisar(e: EntradaRevisao): Promise<Aviso[]> {
    if (!e.contratoAnonimizado.trim()) {
      throw new IaError("Não há texto de contrato para revisar.", "vazio");
    }
    const saida = await this.chamar("revisar", mensagemRevisao(e), saidaRevisao);
    return paraAvisos(saida.avisos);
  }

  private async chamar<T>(operacao: Operacao, mensagem: string, formato: z.ZodType<T>): Promise<T> {
    const config = OPERACOES[operacao];
    const prazo = this.prazosMs[operacao] ?? config.prazoMs;
    const sinal = AbortSignal.timeout(prazo);
    let resposta: BetaMessage;
    try {
      // stream + finalMessage: com o raciocinio sempre ligado, uma revisao pode
      // levar minutos, e uma requisicao sem streaming fica sem byte nenhum ate
      // o fim -- terreno de timeout de proxy. O `signal` e o que corta o
      // stream no prazo (o `timeout` so vale ate os cabecalhos).
      resposta = await this.cliente.beta.messages
        .stream(montarRequisicao(operacao, mensagem), {
          signal: sinal,
          maxRetries: config.retentativas,
          timeout: prazo,
        })
        .finalMessage();
    } catch (erro) {
      // Prazo estourado: o SDK devolve "abortado", mas para a Mel e demora. A
      // rota de redacao monta o contrato sem a clausula e mostra esta frase.
      if (sinal.aborted) {
        registrar("error", operacao, "prazo");
        throw new IaError(
          `A IA demorou demais para responder (mais de ${Math.round(prazo / 60_000) || 1} min) e a chamada foi encerrada. ${config.seDemorar}`,
          "timeout",
        );
      }
      throw traduzirErro(operacao, erro);
    }

    // stop_reason ANTES de ler o conteudo: numa recusa o conteudo vem vazio ou
    // pela metade, e numa resposta cortada o JSON esta incompleto.
    switch (resposta.stop_reason) {
      case "end_turn":
        break;
      case "refusal": {
        // A categoria e um rotulo fixo da API ("cyber", "bio"...), nao conteudo.
        const categoria = resposta.stop_details?.category ?? "sem-categoria";
        registrar("error", operacao, `refusal ${categoria}`);
        throw new IaError(OPERACOES[operacao].recusa, "refusal");
      }
      case "max_tokens":
      case "model_context_window_exceeded":
        registrar("error", operacao, resposta.stop_reason);
        throw new IaError(
          "A resposta da IA ficou incompleta. Tente de novo; se persistir, encurte as observações.",
          resposta.stop_reason,
        );
      default:
        registrar("error", operacao, `stop ${resposta.stop_reason ?? "nulo"}`);
        throw new IaError("A IA não terminou a resposta. Tente de novo.", "stop");
    }

    const bruto = textoDaResposta(resposta);
    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch {
      registrar("error", operacao, "json");
      throw new IaError("A IA devolveu uma resposta fora do formato esperado. Tente de novo.", "json");
    }

    const lido = formato.safeParse(json);
    if (!lido.success) {
      registrar("error", operacao, "formato");
      throw new IaError("A IA devolveu uma resposta fora do formato esperado. Tente de novo.", "formato");
    }

    // O modelo que respondeu vai no log: se foi o de reserva (fallback), da
    // para ver com que frequencia o Fable recusa texto de contrato.
    registrar("info", operacao, `ok ${resposta.model}`);
    return lido.data;
  }
}

/**
 * Junta os blocos de texto, em ordem, ignorando raciocinio e marcadores de
 * fallback. Num fallback no meio do streaming, o modelo de reserva CONTINUA o
 * texto parcial do primeiro (a API manda o parcial como contexto), entao o JSON
 * inteiro e a concatenacao do que veio antes e depois do bloco `fallback`.
 */
function textoDaResposta(resposta: BetaMessage): string {
  let texto = "";
  for (const bloco of resposta.content) {
    if (bloco.type === "text") texto += bloco.text;
  }
  return texto;
}

// ----------------------------------------------------------------- erros --

/**
 * Erro do SDK -> IaError com texto para a Mel. Do mais especifico para o mais
 * geral (as classes herdam umas das outras). Erro que nao e do SDK (bug nosso)
 * sobe como esta: esconde-lo atras de "a IA falhou" atrasaria o diagnostico.
 */
function traduzirErro(operacao: Operacao, erro: unknown): unknown {
  if (!(erro instanceof Anthropic.AnthropicError)) return erro;

  if (erro instanceof Anthropic.APIError) {
    // status + tipo do erro da API ("rate_limit_error"): diagnostico suficiente,
    // e nenhum dos dois carrega o corpo da requisicao.
    registrar("error", operacao, [erro.status ?? "sem-status", erro.type].filter(Boolean).join(" "));
  } else {
    registrar("error", operacao, erro.name);
  }

  if (erro instanceof Anthropic.APIConnectionTimeoutError) {
    return new IaError("A IA demorou demais para responder. Tente de novo.", "timeout");
  }
  if (erro instanceof Anthropic.APIUserAbortError) {
    return new IaError("A chamada à IA foi interrompida. Tente de novo.", "abortado");
  }
  if (erro instanceof Anthropic.APIConnectionError) {
    return new IaError(
      "Não foi possível falar com a IA agora. Confira a conexão e tente de novo.",
      "conexao",
    );
  }
  if (erro instanceof Anthropic.AuthenticationError) {
    return new IaError("A chave da IA foi recusada (confira a ANTHROPIC_API_KEY).", "401");
  }
  if (erro instanceof Anthropic.PermissionDeniedError || erro instanceof Anthropic.NotFoundError) {
    return new IaError(
      "A conta da IA não tem acesso ao modelo configurado. Avise o suporte.",
      String(erro.status),
    );
  }
  if (erro instanceof Anthropic.RateLimitError) {
    return new IaError(
      "A IA está com muitas chamadas no momento. Espere um minuto e tente de novo.",
      "429",
    );
  }
  if (erro instanceof Anthropic.BadRequestError) {
    return new IaError(
      "A IA recusou o formato do pedido. Tente de novo; se persistir, avise o suporte.",
      "400",
    );
  }
  if (
    erro instanceof Anthropic.InternalServerError ||
    // Sobrecarga no meio do streaming chega como evento de erro, sem status HTTP.
    (erro instanceof Anthropic.APIError && erro.type === "overloaded_error")
  ) {
    return new IaError("A IA está instável no momento. Tente de novo em alguns minutos.", "5xx");
  }
  return new IaError("A IA não conseguiu responder agora. Tente de novo.", "api");
}

function registrar(nivel: "info" | "error", operacao: Operacao, codigo: string): void {
  console[nivel](`[contrato:ia] ${operacao} ${codigo}`);
}

// --------------------------------------------------------- pos-processamento --

/** Espaco colapsado e teto de tamanho: e o mesmo limite dos campos de `tipos.ts`. */
function linha(s: string, max = 2000): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

const soDigitos = (s: string) => s.replace(/\D/g, "");

function limparLista(itens: string[]): string[] {
  return itens.map((i) => linha(i)).filter(Boolean);
}

function paraEndereco(e: z.infer<typeof enderecoIa>) {
  return {
    logradouro: linha(e.logradouro),
    numero: linha(e.numero),
    complemento: linha(e.complemento),
    bairro: linha(e.bairro),
    cidade: linha(e.cidade),
    uf: linha(e.uf).toUpperCase(),
    cep: soDigitos(e.cep),
  };
}

/**
 * A saida da extracao no formato de `Contratante`, normalizada do jeito que o
 * resto do sistema guarda: CPF, CEP e telefone so com digitos; CNPJ com digitos
 * e letras maiusculas (o CNPJ alfanumerico da Receita vale desde julho de
 * 2026, e `soDigitos` jogaria fora as letras de um numero valido); e-mail em
 * minusculas e sem espaco.
 *
 * `genero` fica "" SEMPRE: o schema de saida nem tem o campo, e o default do
 * `contratanteSchema` o completa vazio. Concordancia errada ("inscrito" para
 * uma mulher) e o erro que a Mel mais cometia nos contratos antigos; por isso e
 * ela quem decide, nunca a IA.
 */
function paraContratante(s: z.infer<typeof saidaExtracao>): Contratante {
  const email = (v: string) => linha(v).replace(/\s/g, "").toLowerCase();
  const nacionalidade = linha(s.pf.nacionalidade).toLowerCase();

  return contratanteSchema.parse({
    tipo: s.tipo,
    vinculo: linha(s.vinculo).toLowerCase(),
    pf: {
      nome: linha(s.pf.nome),
      // "brasileira"/"brasileiro" sai do genero escolhido pela Mel; vindo daqui,
      // poderia contrariar a escolha dela. O prompt ja pede vazio; isto garante.
      nacionalidade: /^brasileir[oa]$/.test(nacionalidade) ? "" : nacionalidade,
      cpf: soDigitos(s.pf.cpf),
      email: email(s.pf.email),
      telefone: soDigitos(s.pf.telefone),
      endereco: paraEndereco(s.pf.endereco),
    },
    pj: {
      razaoSocial: linha(s.pj.razaoSocial),
      cnpj: limparCnpj(s.pj.cnpj),
      endereco: paraEndereco(s.pj.endereco),
      representante: {
        nome: linha(s.pj.representante.nome),
        cpf: soDigitos(s.pj.representante.cpf),
        cargo: linha(s.pj.representante.cargo),
        email: email(s.pj.representante.email),
        telefone: soDigitos(s.pj.representante.telefone),
      },
    },
  });
}

/**
 * Um item por paragrafo, sem quebra de linha dentro (o PDF justifica o
 * paragrafo inteiro; um "\n" no meio viraria um buraco). Se o modelo juntou
 * dois paragrafos num item com linha em branco, eles voltam a ser dois.
 *
 * Tambem tira o que a montagem ja poe e sairia em dobro: um titulo solto no
 * comeco ("DAS CONDIÇÕES ESPECIAIS") e o paragrafo unico sobre prevalencia.
 * NAO corta paragrafo por tamanho nem por quantidade: texto juridico truncado
 * em silencio e pior que texto longo; o limite e checado em validarTextoIa e
 * aparece para a Mel como problema.
 */
function limparParagrafos(paragrafos: string[]): string[] {
  const titulo = /^(cl[áa]usula\b.*|das condi[çc][õo]es especiais)$/i;
  const prevalencia = /^par[áa]grafo [úu]nico\b.*prevalece/i;

  return paragrafos
    .flatMap((p) => p.split(/\n\s*\n/))
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "" && !titulo.test(p) && !prevalencia.test(p));
}

const ORDEM_GRAVIDADE: Record<Aviso["gravidade"], number> = {
  bloqueante: 0,
  atencao: 1,
  sugestao: 2,
};

/** Avisos da revisao -> `Aviso` (origem "ia"), os mais graves primeiro. */
function paraAvisos(avisos: z.infer<typeof saidaRevisao>["avisos"]): Aviso[] {
  const ids: readonly string[] = IDS_CLAUSULA;
  const vistos = new Set<string>();
  const saida: Aviso[] = [];

  for (const a of avisos) {
    const texto = linha(a.texto);
    if (!texto || vistos.has(texto)) continue;
    vistos.add(texto);

    const aviso: Aviso = { origem: "ia", gravidade: a.gravidade, texto };
    // Id fora da tabela nao vira link quebrado no painel: o aviso fica geral.
    if (ids.includes(a.clausula)) aviso.clausula = a.clausula;
    saida.push(aviso);
  }

  // sort e estavel: dentro da mesma gravidade, fica a ordem do revisor.
  return saida
    .sort((x, y) => ORDEM_GRAVIDADE[x.gravidade] - ORDEM_GRAVIDADE[y.gravidade])
    .slice(0, MAX_AVISOS);
}
