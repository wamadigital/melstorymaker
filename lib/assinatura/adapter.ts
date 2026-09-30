import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import type {
  Assinante,
  DadosContrato,
  PapelAssinatura,
  PosicaoAssinatura,
  SignatarioStatus,
  StatusAssinatura,
} from "@/lib/contrato/tipos";

// Assinatura eletronica do contrato. Mesmo desenho do MailAdapter: nenhuma rota
// fala com a iLoveAPI direto, tudo passa por `ProvedorAssinatura`, e por isso a
// trava do ASSINATURA_DRY_RUN nao tem como ser contornada por engano. O envio so
// acontece por clique explicito da Mel (decisao do owner, 29/09/2026) -- nada
// aqui dispara sozinho.
//
// O contrato e PII (CPF, endereco, e-mail). Este modulo nunca loga nome nem
// e-mail completo, nem corpo de resposta da plataforma: o corpo de erro da
// iLoveAPI pode ecoar os signatarios que mandamos.

// ------------------------------------------------------------------ tipos --

export type Signatario = { papel: PapelAssinatura; nome: string; email: string };

export type PedidoAssinatura = {
  /** O MESMO PDF que a Mel conferiu no painel, baixado do bucket. */
  pdf: Uint8Array;
  /** Como o arquivo aparece para quem assina: "Contrato - Maria Eduarda.pdf". */
  nomeArquivo: string;
  signatarios: Signatario[];
  /** Uma (ou mais) por papel, vindas de `renderizarContrato`. */
  posicoes: PosicaoAssinatura[];
  assunto: string;
  mensagem: string;
  /** Prazo para assinar. A iLoveAPI aceita de 1 a 130. */
  diasValidade: number;
};

export type ResultadoEnvio = {
  /** Opaco para quem chama. Vai para a coluna interna `assinatura_token`. */
  token: string;
  status: StatusAssinatura;
  signatarios: SignatarioStatus[];
};

export type ResultadoConsulta = {
  status: StatusAssinatura;
  signatarios: SignatarioStatus[];
  /** ISO 8601, so quando `status` e "concluido". */
  concluidoEm: string | null;
};

/**
 * O que a rota ja sabe de cada signatario: e o que `enviar` devolveu e ficou
 * salvo em `assinatura_signatarios`. `SignatarioStatus[]` serve direto.
 *
 * Existe porque o PAPEL (contratante, contratada, anuente) nao viaja pela
 * plataforma: ela so conhece nome e e-mail. Na consulta, o papel e recuperado
 * cruzando o e-mail de volta com esta lista.
 */
export type SignatarioConhecido = {
  papel: PapelAssinatura | null;
  email: string;
  nome?: string;
};

export const NOMES_PROVEDOR = ["ilovepdf", "dry-run"] as const;
export type NomeProvedor = (typeof NOMES_PROVEDOR)[number];

export interface ProvedorAssinatura {
  readonly nome: NomeProvedor;
  enviar(p: PedidoAssinatura): Promise<ResultadoEnvio>;
  /**
   * `conhecidos` e opcional so para manter a assinatura simples de chamar; sem
   * ele o provedor nao tem como saber o papel de cada um e devolve `papel: null`.
   * A rota deve passar `registro.assinatura_signatarios`.
   */
  consultar(token: string, conhecidos?: readonly SignatarioConhecido[]): Promise<ResultadoConsulta>;
  baixarAssinado(token: string): Promise<Uint8Array>;
  baixarTrilha(token: string): Promise<Uint8Array>;
  cancelar(token: string): Promise<void>;
}

// ------------------------------------------------------------------- copy --

/** Assunto do e-mail que a plataforma manda a cada signatario. */
export const ASSUNTO_ASSINATURA = "Contrato de prestação de serviços | Mel Simão Storymaker";

/** Corpo do mesmo e-mail. Sobrio de proposito: e o primeiro contato formal com o contrato. */
export const MENSAGEM_ASSINATURA =
  "Olá! Segue o contrato de prestação de serviços de storymaker para sua assinatura eletrônica. Qualquer dúvida, é só falar com a Mel.";

/** Prazo padrao para assinar. Evento costuma estar a meses; 30 dias com lembrete a cada 3 basta. */
export const DIAS_VALIDADE_PADRAO = 30;

/** A iLoveAPI recusa `expiration_days` fora de 1..130. */
const DIAS_VALIDADE_MIN = 1;
const DIAS_VALIDADE_MAX = 130;

// ----------------------------------------------------------------- erros --

export type CodigoErroAssinatura =
  /** A plataforma respondeu com erro HTTP. */
  | "http"
  /** A conta da iLoveAPI esta sem credito de assinatura. */
  | "sem_creditos"
  | "timeout"
  | "rede"
  /** A plataforma respondeu 2xx com algo que nao da para usar. */
  | "resposta_invalida"
  /** O pedido montado pela rota nao da para enviar (e-mail invalido, posicao faltando...). */
  | "pedido_invalido"
  /** Token de OUTRO provedor (envio de teste na iLoveAPI, envio de verdade no dry run). */
  | "token_invalido"
  /**
   * Token que nao da para ler: nao aponta para pedido nenhum. Diferente de
   * `token_invalido`, nao ha outro provedor que saiba trata-lo.
   */
  | "token_ilegivel"
  /**
   * O pedido nao existe mais na plataforma (404): apagado pelo painel dela, ou
   * nunca existiu com aquele identificador. No cancelamento, so depois de a
   * consulta confirmar o 404 do void.
   */
  | "inexistente"
  /** Nao ha arquivo para baixar (ainda nao assinado, ou envio de teste). */
  | "sem_arquivo"
  /** Tentou cancelar o que ja foi assinado por todos. */
  | "ja_concluido";

/**
 * Erro com mensagem HUMANA, pronta para a tela da Mel. O detalhe tecnico
 * (etapa, status HTTP) fica nos campos, para a rota logar sem precisar do texto.
 */
export class AssinaturaError extends Error {
  readonly codigo: CodigoErroAssinatura;
  readonly etapa: string | null;
  readonly status: number | null;

  constructor(
    mensagem: string,
    opcoes: { codigo: CodigoErroAssinatura; etapa?: string | null; status?: number | null },
  ) {
    super(mensagem);
    this.name = "AssinaturaError";
    this.codigo = opcoes.codigo;
    this.etapa = opcoes.etapa ?? null;
    this.status = opcoes.status ?? null;
  }
}

/**
 * O envio gravado no registro nao tem mais como ser alcancado na plataforma:
 * ela diz que o pedido nao existe (404), ou o token guardado e ilegivel.
 *
 * Sem esta saida o contrato ficava preso em "enviado" para sempre: consultar
 * e cancelar falhavam, o texto seguia travado e a unica tela que destravava
 * era excluir o lead. Quem decide o que fazer e a rota: no cancelamento,
 * encerrar o envio so no sistema; na consulta, dizer a Mel que o "Cancelar
 * envio" destrava.
 *
 * `token_invalido` fica de fora de proposito: e token de OUTRO provedor (um
 * envio de verdade chegando ao dry run), e o pedido de verdade pode estar vivo
 * na caixa do cliente.
 */
export function pedidoInalcancavel(e: unknown): e is AssinaturaError {
  return e instanceof AssinaturaError && (e.codigo === "inexistente" || e.codigo === "token_ilegivel");
}

/**
 * Sem chave da iLoveAPI e com o dry run desligado. Classe separada (e nao um
 * AssinaturaError) porque a resposta e outra: 503, "nao configurado", e nao uma
 * falha da plataforma. Uma rota que so testasse `instanceof AssinaturaError`
 * trataria configuracao faltando como plataforma fora do ar.
 */
export class AssinaturaNaoConfiguradaError extends Error {
  constructor() {
    super("A assinatura eletrônica não está configurada.");
    this.name = "AssinaturaNaoConfiguradaError";
  }
}

// ------------------------------------------------------------- utilitarios --

/** Para comparar e-mails: a plataforma pode devolver com outra caixa. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * "mel@wama.digital" -> "m***@wama.digital". Para log: da para saber que e-mail
 * era sem que o log vire uma lista de contatos de clientes.
 */
export function mascararEmail(email: string): string {
  const e = email.trim();
  const arroba = e.lastIndexOf("@");
  if (arroba < 0) return "***";
  return `${e.slice(0, Math.min(1, arroba))}***@${e.slice(arroba + 1)}`;
}

/** Nome sem acento, caixa nem espaco repetido: so para casar, nunca para exibir. */
function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Descobre o papel de um signatario que voltou da plataforma. Pelo e-mail
 * primeiro, que e unico por envio (`validarPedido` garante). Pelo nome so se o
 * e-mail nao casar -- o caso real e a Mel corrigir no painel da iLoveAPI o
 * e-mail de alguem que digitou errado -- e so quando exatamente um conhecido
 * tem aquele nome: na duvida, `null` e melhor que atribuir o papel errado.
 */
export function recuperarPapel(
  email: string,
  nome: string,
  conhecidos: readonly SignatarioConhecido[],
): PapelAssinatura | null {
  const porEmail = conhecidos.find((c) => normalizarEmail(c.email) === normalizarEmail(email));
  if (porEmail) return porEmail.papel;

  const alvo = normalizarNome(nome);
  if (!alvo) return null;
  const porNome = conhecidos.filter((c) => c.nome && normalizarNome(c.nome) === alvo);
  return porNome.length === 1 ? porNome[0].papel : null;
}

/**
 * Quem a PLATAFORMA ve assinando, a partir do bloco de assinaturas do texto.
 *
 * E o mesmo bloco, com uma diferenca: CONTRATANTE pessoa juridica. No PDF a
 * linha e da EMPRESA ("Alfa Eventos Ltda." com "p. Roberto Alves, CPF ..."
 * embaixo), porque a parte do contrato e ela. Mas quem recebe o e-mail, digita
 * a assinatura e fica registrado na trilha de auditoria e uma PESSOA, o
 * representante -- a iLoveAPI trata `name` como o nome completo de quem
 * recebe. Com a razao social ali, a trilha diria que uma empresa assinou, sem
 * dizer quem, e a assinatura digitada sairia com o nome da empresa.
 *
 * O nome vem dos DADOS, e nao de recortar o texto do bloco: a rota ja confere
 * que o bloco e os dados sao as mesmas pessoas antes de enviar.
 */
export function signatariosDoContrato(assinaturas: readonly Assinante[], dados: DadosContrato): Signatario[] {
  const c = dados.contratante;
  const representante = c.tipo === "pj" ? c.pj.representante.nome.replace(/\s+/g, " ").trim() : "";
  return assinaturas.map((a) => ({
    papel: a.papel,
    // Sem representante o `validarPedido` recusaria o nome vazio; a razao
    // social ao menos identifica a parte. Na pratica `faltantes` ja barra.
    nome: a.papel === "contratante" && representante ? representante : a.nome,
    email: a.email,
  }));
}

/**
 * Nome do arquivo como aparece na plataforma e no e-mail. Tira separador de
 * caminho e caractere de controle, garante o ".pdf" e um tamanho razoavel.
 */
export function nomeArquivoSeguro(nome: string): string {
  const base = nome
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .slice(0, 120)
    .trim();
  return `${base || "Contrato"}.pdf`;
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "CONTRATANTE", "CONTRATADA", "ANUENTE": como o papel aparece no contrato. */
function rotuloPapel(papel: PapelAssinatura): string {
  return papel.toUpperCase();
}

function invalido(mensagem: string): AssinaturaError {
  return new AssinaturaError(mensagem, { codigo: "pedido_invalido" });
}

/** O PDF comeca com "%PDF-" (a especificacao tolera lixo nos primeiros 1024 bytes). */
export function pareceSerPdf(bytes: Uint8Array): boolean {
  const inicio = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return inicio.includes("%PDF-");
}

/**
 * Tudo que precisa estar certo ANTES de gastar um credito de assinatura. Roda
 * tambem no dry run, de proposito: e o dry run que roda no desenvolvimento, e e
 * la que um e-mail repetido ou uma posicao faltando tem de aparecer -- nao no
 * primeiro envio de verdade, com a cliente esperando o link.
 */
export function validarPedido(p: PedidoAssinatura): void {
  if (!p.pdf || p.pdf.length === 0 || !pareceSerPdf(p.pdf)) {
    throw invalido("O arquivo do contrato não é um PDF válido. Gere o PDF de novo.");
  }
  if (p.signatarios.length === 0) {
    throw invalido("O contrato não tem ninguém para assinar.");
  }
  if (
    !Number.isInteger(p.diasValidade) ||
    p.diasValidade < DIAS_VALIDADE_MIN ||
    p.diasValidade > DIAS_VALIDADE_MAX
  ) {
    throw invalido(
      `O prazo para assinar precisa ficar entre ${DIAS_VALIDADE_MIN} e ${DIAS_VALIDADE_MAX} dias.`,
    );
  }

  const papeisVistos = new Set<PapelAssinatura>();
  const emailsVistos = new Map<string, PapelAssinatura>();

  for (const s of p.signatarios) {
    const rotulo = rotuloPapel(s.papel);

    // As posicoes sao indexadas por papel: dois signatarios com o mesmo papel
    // receberiam o campo de assinatura no mesmo lugar do PDF.
    if (papeisVistos.has(s.papel)) {
      throw invalido(`Há duas pessoas assinando como ${rotulo}.`);
    }
    papeisVistos.add(s.papel);

    if (!s.nome.trim()) {
      throw invalido(`Falta o nome de quem assina como ${rotulo}.`);
    }
    const email = normalizarEmail(s.email);
    if (!REGEX_EMAIL.test(email)) {
      throw invalido(`O e-mail de quem assina como ${rotulo} não parece válido.`);
    }

    // Um e-mail por pessoa: a plataforma manda UM link por endereco, e e pelo
    // e-mail que o papel de cada um e recuperado na consulta. Casal que usa o
    // mesmo e-mail precisa informar dois.
    const outro = emailsVistos.get(email);
    if (outro) {
      throw invalido(
        `${rotuloPapel(outro)} e ${rotulo} estão com o mesmo e-mail. Cada pessoa precisa de um e-mail próprio para assinar.`,
      );
    }
    emailsVistos.set(email, s.papel);

    const posicoes = p.posicoes.filter((pos) => pos.papel === s.papel);
    if (posicoes.length === 0) {
      throw invalido(
        `O PDF não tem o lugar da assinatura de quem assina como ${rotulo}. Gere o PDF de novo.`,
      );
    }
    for (const pos of posicoes) {
      const numerosOk = [pos.x, pos.yTopo, pos.largura, pos.altura].every(Number.isFinite);
      if (
        !numerosOk ||
        !Number.isInteger(pos.pagina) ||
        pos.pagina < 1 ||
        pos.x < 0 ||
        pos.yTopo < 0 ||
        pos.altura <= 0
      ) {
        throw invalido(
          `O lugar da assinatura de quem assina como ${rotulo} ficou inválido no PDF. Gere o PDF de novo.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- dry run --

/**
 * Todo token do dry run comeca assim. E o que permite `provedorDoToken` saber,
 * depois, qual provedor fez cada envio -- mesmo que o ASSINATURA_DRY_RUN tenha
 * mudado no meio do caminho.
 */
export const PREFIXO_TOKEN_DRY_RUN = "dry-";

function exigirTokenDeTeste(token: string, etapa: string): void {
  if (token.startsWith(PREFIXO_TOKEN_DRY_RUN)) return;
  // Responder "tudo certo" para um envio de verdade faria o banco divergir da
  // plataforma: o painel diria "cancelado" com o pedido vivo na caixa do cliente.
  throw new AssinaturaError(
    "Este envio foi feito pela plataforma de assinatura de verdade, e o sistema está em modo de teste (ASSINATURA_DRY_RUN). Desligue o modo de teste para consultá-lo ou cancelá-lo.",
    { codigo: "token_invalido", etapa },
  );
}

function pendentes(lista: readonly SignatarioConhecido[]): SignatarioStatus[] {
  return lista.map((s) => ({
    papel: s.papel,
    nome: s.nome ?? "",
    email: s.email,
    status: "pendente",
    assinadoEm: null,
  }));
}

/**
 * Provedor de desenvolvimento: valida o pedido como o de verdade, loga um
 * resumo SEM PII e nao envia nada. E o padrao local (ASSINATURA_DRY_RUN=1), pelo
 * mesmo motivo do MAIL_DRY_RUN: nunca mandar contrato de teste para o e-mail de
 * um cliente real.
 */
export class ProvedorDryRun implements ProvedorAssinatura {
  readonly nome = "dry-run" as const;

  async enviar(p: PedidoAssinatura): Promise<ResultadoEnvio> {
    validarPedido(p);
    const token = `${PREFIXO_TOKEN_DRY_RUN}${randomUUID()}`;

    const quem = p.signatarios
      .map((s) => `${s.papel} ${mascararEmail(s.email)}`)
      .join(", ");
    const onde = p.posicoes.map((pos) => `${pos.papel} p.${pos.pagina}`).join(", ");

    // Nem nome de quem assina nem nome do arquivo (que leva o nome do
    // homenageado): so o que ajuda a depurar.
    console.info(
      [
        "",
        "──────── ASSINATURA (ASSINATURA_DRY_RUN=1, nada foi enviado) ────────",
        `signatários: ${p.signatarios.length} (${quem})`,
        `posições:    ${onde}`,
        `pdf:         ${(p.pdf.length / 1024).toFixed(0)} kB`,
        `validade:    ${p.diasValidade} dias`,
        `token:       ${token}`,
        "─────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );

    return { token, status: "enviado", signatarios: pendentes(p.signatarios) };
  }

  async consultar(
    token: string,
    conhecidos: readonly SignatarioConhecido[] = [],
  ): Promise<ResultadoConsulta> {
    exigirTokenDeTeste(token, "consultar");
    // Nada foi enviado, entao ninguem assina nunca: o envio de teste fica
    // "enviado" ate a Mel cancelar.
    return { status: "enviado", signatarios: pendentes(conhecidos), concluidoEm: null };
  }

  async baixarAssinado(token: string): Promise<Uint8Array> {
    exigirTokenDeTeste(token, "download-signed");
    throw semArquivoDeTeste("download-signed");
  }

  async baixarTrilha(token: string): Promise<Uint8Array> {
    exigirTokenDeTeste(token, "download-audit");
    throw semArquivoDeTeste("download-audit");
  }

  async cancelar(token: string): Promise<void> {
    exigirTokenDeTeste(token, "void");
    console.info("[assinatura] DRY RUN, envio de teste cancelado (nada havia sido enviado)");
  }
}

function semArquivoDeTeste(etapa: string): AssinaturaError {
  return new AssinaturaError(
    "Em modo de teste (ASSINATURA_DRY_RUN) nada foi enviado, então não existe contrato assinado para baixar.",
    { codigo: "sem_arquivo", etapa },
  );
}

// ---------------------------------------------------------------- fabrica --

export type ConfigAssinatura = { dryRun: boolean; publicKey: string | undefined };

function lerConfig(): ConfigAssinatura {
  return {
    dryRun: Boolean(env.ASSINATURA_DRY_RUN),
    publicKey: env.ILOVEAPI_PUBLIC_KEY?.trim() || undefined,
  };
}

/** Modo de teste ligado: o painel mostra o aviso ambar. */
export function assinaturaEmDryRun(): boolean {
  return lerConfig().dryRun;
}

/**
 * Da para clicar em "Enviar para assinatura"? Sim no dry run (e assim que o
 * fluxo inteiro e testado sem conta nenhuma) e sim com a chave da iLoveAPI.
 * Nao, e o botao fica desabilitado com explicacao, sem nenhum dos dois.
 */
export function assinaturaConfigurada(): boolean {
  const c = lerConfig();
  return c.dryRun || Boolean(c.publicKey);
}

/**
 * A decisao, sem passar pelo env: exportada para teste. O cliente da iLoveAPI
 * entra por import dinamico, como o GmailAdapter -- quem so usa o dry run nao
 * carrega o modulo.
 */
export async function escolherProvedor(c: ConfigAssinatura): Promise<ProvedorAssinatura> {
  if (c.dryRun) return new ProvedorDryRun();
  if (!c.publicKey) throw new AssinaturaNaoConfiguradaError();

  const { ILoveApi } = await import("./ilovepdf");
  return new ILoveApi({ publicKey: c.publicKey });
}

/**
 * Provedor para um envio NOVO: segue o ASSINATURA_DRY_RUN.
 *
 * Unico ponto do sistema que decide por onde o contrato sai. A interface
 * continua existindo com um provedor so pelo mesmo motivo do MailAdapter: o dry
 * run e troca de uma linha e nenhuma rota conhece a iLoveAPI.
 */
export async function criarProvedorAssinatura(): Promise<ProvedorAssinatura> {
  return escolherProvedor(lerConfig());
}

/**
 * Provedor para um envio que JA EXISTE (consultar, baixar, cancelar): quem
 * decide e o proprio token, nao o env de agora. Envio de teste continua sendo de
 * teste depois que o dry run e desligado; e envio de verdade continua sendo de
 * verdade com o dry run ligado -- ele so existe porque alguem enviou de verdade,
 * e trata-lo com o provedor de teste faria o banco dizer "cancelado" enquanto o
 * pedido segue vivo na caixa do cliente.
 */
export async function provedorDoToken(token: string): Promise<ProvedorAssinatura> {
  if (token.startsWith(PREFIXO_TOKEN_DRY_RUN)) return new ProvedorDryRun();
  return escolherProvedor({ ...lerConfig(), dryRun: false });
}
