import "server-only";
import {
  ASSUNTO_ASSINATURA,
  AssinaturaError,
  AssinaturaNaoConfiguradaError,
  DIAS_VALIDADE_PADRAO,
  MENSAGEM_ASSINATURA,
  criarProvedorAssinatura,
  nomeArquivoSeguro,
  pedidoInalcancavel,
  provedorDoToken,
  signatariosDoContrato,
  type CodigoErroAssinatura,
  type ProvedorAssinatura,
  type ResultadoEnvio,
} from "@/lib/assinatura/adapter";
import { assinaturasDoContrato } from "@/lib/contrato/clausulas";
import { validarEmail } from "@/lib/contrato/documento";
import { baseDeRedacao, type ContextoMontagem } from "@/lib/contrato/montar";
import type { Assinante, DadosContrato, DocumentoContrato, RegistroContrato } from "@/lib/contrato/tipos";
import {
  ErroBancoContrato,
  baixarPdf,
  caminhoAssinado,
  caminhoTrilha,
  guardarPdf,
  lerRegistro,
  registroPublico,
  salvarRegistro,
  sha256Hex,
  type CondicaoEscrita,
  type PatchContrato,
  type RegistroContratoInterno,
} from "@/lib/supabase/contratos";
import { Recusa, contextoDeMontagem, responder, type LeadDoContrato } from "../_comum";

// O fluxo da assinatura (enviar, consultar, cancelar), fora do `route.ts` para
// ser testavel: o Next so aceita GET/POST/... e configuracao como export de
// rota, e o teste precisa chamar isto com um provedor e um banco falsos. A
// rota so carrega o lead e o registro e chama daqui.

/** Tudo que o fluxo usa de fora. O padrao e o de verdade; o teste troca. */
export type IoAssinatura = {
  criarProvedor: () => Promise<ProvedorAssinatura>;
  provedorDoToken: (token: string) => Promise<ProvedorAssinatura>;
  ler: (leadId: string) => Promise<RegistroContrato | null>;
  salvar: (leadId: string, patch: PatchContrato, condicao?: CondicaoEscrita) => Promise<RegistroContrato | null>;
  baixarPdf: (caminho: string) => Promise<Uint8Array | null>;
  guardarPdf: (caminho: string, bytes: Uint8Array, opcoes: { substituir: boolean }) => Promise<"gravado" | "ja_existia">;
};

export const IO_ASSINATURA: IoAssinatura = {
  criarProvedor: criarProvedorAssinatura,
  provedorDoToken,
  ler: lerRegistro,
  salvar: salvarRegistro,
  baixarPdf,
  guardarPdf,
};

// ------------------------------------------------------------------- erros --

/**
 * Status HTTP por codigo do AssinaturaError. A mensagem ja vem humana do
 * adapter; o log leva so etapa, HTTP e codigo -- o corpo de erro da iLoveAPI
 * pode ecoar e-mails de quem assina.
 */
const STATUS_DO_ERRO: Record<CodigoErroAssinatura, number> = {
  http: 502,
  sem_creditos: 503,
  timeout: 504,
  rede: 502,
  resposta_invalida: 502,
  pedido_invalido: 422,
  token_invalido: 409,
  token_ilegivel: 409,
  inexistente: 409,
  sem_arquivo: 404,
  ja_concluido: 409,
};

export function recusaDaAssinatura(e: unknown, id: string, etapa: string): Recusa | null {
  if (e instanceof AssinaturaNaoConfiguradaError) return new Recusa(503, e.message);
  if (e instanceof AssinaturaError) {
    console.warn(
      `[contrato] ${id} ${etapa}: assinatura ${e.codigo} (etapa ${e.etapa ?? "-"}, HTTP ${e.status ?? "-"})`,
    );
    return new Recusa(STATUS_DO_ERRO[e.codigo], e.message);
  }
  return null;
}

async function provedorDoEnvio(
  token: string,
  id: string,
  etapa: string,
  io: IoAssinatura,
): Promise<ProvedorAssinatura> {
  try {
    return await io.provedorDoToken(token);
  } catch (e) {
    throw recusaDaAssinatura(e, id, etapa) ?? e;
  }
}

/**
 * O recado da consulta quando o pedido sumiu da plataforma. Aponta a saida,
 * porque sem ela a Mel so ve "Atualizar status" falhar para sempre.
 */
export const MENSAGEM_PEDIDO_SUMIU =
  "Não encontrei este envio na plataforma de assinatura: ele pode ter sido apagado pelo painel da iLovePDF. Use “Cancelar envio” para destravar o contrato e enviar de novo.";

/** Motivo para o LOG (sem PII): so o que aconteceu, nunca quem. */
function motivoInalcancavel(e: AssinaturaError): string {
  return e.codigo === "inexistente"
    ? "o pedido não existe mais na plataforma (404)"
    : "o token do envio é ilegível";
}

// ------------------------------------------------------------ quem assina --

const chave = (a: Assinante) => [a.papel, a.rotulo, a.nome, a.documento, a.email].join("\u0000");

/**
 * Quem assina no TEXTO e quem os DADOS dizem hoje sao as mesmas pessoas, com
 * os mesmos documentos e e-mails?
 *
 * Salvar dados nao regera o texto. Se a Mel corrigiu o e-mail (ou o CPF) de
 * quem assina depois de gerar o PDF, o link iria para o endereco velho e o
 * PDF mostraria o CPF velho -- e ninguem perceberia ate o cliente reclamar.
 * Compara pela mesma funcao que monta o bloco de assinaturas.
 */
function conferirQuemAssina(documento: DocumentoContrato, dados: DadosContrato, ctx: ContextoMontagem): void {
  let esperado: Assinante[] | null = null;
  try {
    esperado = assinaturasDoContrato(baseDeRedacao(dados, ctx));
  } catch {
    esperado = null;
  }
  const iguais =
    esperado !== null &&
    esperado.length === documento.assinaturas.length &&
    esperado.every((a, i) => chave(a) === chave(documento.assinaturas[i]));
  if (!iguais) {
    throw new Recusa(
      409,
      "Os dados de quem assina mudaram depois que o texto foi gerado. Gere o texto e o PDF de novo antes de enviar.",
    );
  }
}

// ------------------------------------------------------------------ envio --

type EstadoAnterior = Pick<
  RegistroContratoInterno,
  | "assinatura_provedor"
  | "assinatura_token"
  | "assinatura_status"
  | "assinatura_signatarios"
  | "assinatura_enviada_em"
  | "assinatura_atualizada_em"
>;

/**
 * Devolve o registro a "pdf_gerado" quando o envio nao chegou a sair. Falhar
 * aqui nao pode esconder o erro original: loga e segue. O registro fica em
 * "enviado" sem token, e o "Cancelar envio" do painel o destrava.
 */
async function desfazerReserva(id: string, anterior: EstadoAnterior, io: IoAssinatura): Promise<void> {
  try {
    await io.salvar(id, { status: "pdf_gerado", ...anterior }, { status: ["enviado"], token: null });
  } catch {
    console.error(`[contrato] ${id} enviar: não consegui desfazer a reserva do envio`);
  }
}

/**
 * "Confirmar envio" (POST /contrato/assinatura).
 *
 * So por clique da Mel, e so em "pdf_gerado". O arquivo enviado e o MESMO que
 * ela conferiu: baixado do bucket e comparado pelo sha256 com o que foi gerado.
 *
 * Duplo clique mandaria dois e-mails ao cliente e gastaria dois creditos. Por
 * isso o envio RESERVA o registro antes de falar com a plataforma: um UPDATE
 * guardado leva "pdf_gerado" -> "enviado" (ainda sem token), e so um dos
 * cliques consegue. A reserva tambem e guardada pelo `updated_at` lido: quem
 * assina foi conferido contra ESTA leitura dos dados, e uma escrita no meio
 * (outra aba corrigindo um e-mail) invalida a conferencia. O texto fica
 * travado desde a reserva. Se o envio falhar, a reserva e desfeita; se der
 * certo, o token e gravado com o mesmo guard.
 */
export async function enviarParaAssinatura(
  id: string,
  lead: LeadDoContrato,
  reg: RegistroContratoInterno | null,
  io: IoAssinatura = IO_ASSINATURA,
): Promise<Response> {
  if (!reg) throw new Recusa(409, "Gere o texto e o PDF do contrato antes de enviar para assinatura.");
  if (reg.status === "enviado") throw new Recusa(409, "O contrato já está aguardando assinaturas.");
  if (reg.status === "assinado") throw new Recusa(409, "O contrato já foi assinado por todos.");
  if (reg.status !== "pdf_gerado") throw new Recusa(409, "Gere o PDF do contrato antes de enviar para assinatura.");

  const { documento, pdf_path, pdf_sha256, posicoes_assinatura: posicoes } = reg;
  if (!documento || !pdf_path || !pdf_sha256 || !posicoes?.length) {
    throw new Recusa(409, "Gere o PDF do contrato de novo antes de enviar.");
  }

  conferirQuemAssina(documento, reg.dados, contextoDeMontagem(lead));

  const emailsRuins = documento.assinaturas.filter((a) => !validarEmail(a.email));
  if (emailsRuins.length > 0) {
    throw new Recusa(422, "Há e-mail de quem assina que não parece válido.", {
      campos: emailsRuins.map((a) => `E-mail de quem assina como ${a.rotulo}`),
    });
  }
  if (documento.assinaturas.some((a) => !posicoes.some((p) => p.papel === a.papel))) {
    throw new Recusa(409, "O PDF não tem o lugar da assinatura de todos. Gere o PDF de novo.");
  }

  // Antes da reserva: sem provedor configurado nao ha o que desfazer.
  let provedor: ProvedorAssinatura;
  try {
    provedor = await io.criarProvedor();
  } catch (e) {
    throw recusaDaAssinatura(e, id, "enviar") ?? e;
  }

  const anterior: EstadoAnterior = {
    assinatura_provedor: reg.assinatura_provedor,
    assinatura_token: reg.assinatura_token,
    assinatura_status: reg.assinatura_status,
    assinatura_signatarios: reg.assinatura_signatarios,
    assinatura_enviada_em: reg.assinatura_enviada_em,
    assinatura_atualizada_em: reg.assinatura_atualizada_em,
  };

  const reservado = await io.salvar(
    id,
    {
      status: "enviado",
      assinatura_provedor: null,
      assinatura_token: null,
      assinatura_status: null,
      assinatura_signatarios: null,
      assinatura_enviada_em: null,
      assinatura_atualizada_em: new Date().toISOString(),
    },
    { status: ["pdf_gerado"], pdfSha256: pdf_sha256, atualizadoEm: reg.updated_at },
  );
  if (!reservado) {
    throw new Recusa(409, "O contrato mudou ou já está sendo enviado. Atualize a página.");
  }

  // Contratante PJ vai a plataforma com o nome do REPRESENTANTE (quem assina
  // de fato); a razao social fica no bloco impresso do PDF.
  const signatarios = signatariosDoContrato(documento.assinaturas, reg.dados);
  const homenageado = (reg.dados.evento.homenageado || lead.nome_display || "").trim();

  let resultado: ResultadoEnvio;
  try {
    const pdf = await io.baixarPdf(pdf_path);
    if (!pdf) throw new Recusa(409, "Não encontrei o PDF do contrato. Gere o PDF de novo.");
    if (sha256Hex(pdf) !== pdf_sha256) {
      throw new Recusa(
        409,
        "O PDF guardado não é o que foi gerado por último. Gere o PDF de novo e confira antes de enviar.",
      );
    }
    resultado = await provedor.enviar({
      pdf,
      nomeArquivo: nomeArquivoSeguro(homenageado ? `Contrato - ${homenageado}` : "Contrato"),
      signatarios,
      posicoes,
      assunto: ASSUNTO_ASSINATURA,
      mensagem: MENSAGEM_ASSINATURA,
      diasValidade: DIAS_VALIDADE_PADRAO,
    });
  } catch (e) {
    await desfazerReserva(id, anterior, io);
    throw recusaDaAssinatura(e, id, "enviar") ?? e;
  }

  const agora = new Date().toISOString();
  const salvo = await io
    .salvar(
      id,
      {
        assinatura_provedor: provedor.nome,
        assinatura_token: resultado.token,
        assinatura_status: resultado.status,
        assinatura_signatarios: resultado.signatarios,
        assinatura_enviada_em: agora,
        assinatura_atualizada_em: agora,
      },
      { status: ["enviado"], token: null },
    )
    .catch(() => null);

  if (!salvo) {
    // O pedido existe na plataforma, mas o registro nao o guardou (a reserva
    // foi desfeita por um "Cancelar envio" no meio do caminho, ou o banco
    // falhou). Um pedido que o sistema nao conhece nao pode ficar vivo na caixa
    // do cliente: cancela.
    try {
      await provedor.cancelar(resultado.token);
      console.warn(`[contrato] ${id} enviar: registro mudou durante o envio, pedido cancelado (${provedor.nome})`);
    } catch {
      console.error(`[contrato] ${id} enviar: pedido órfão na plataforma (${provedor.nome}); cancelar no painel dela`);
      throw new Recusa(
        500,
        "O envio saiu, mas não consegui registrá-lo nem cancelá-lo. Cancele o pedido no painel da iLoveAPI antes de enviar de novo.",
      );
    }
    throw new Recusa(409, "O contrato mudou enquanto era enviado, então cancelei o envio. Confira e envie de novo.");
  }

  console.log(`[contrato] ${id} enviado para assinatura (${provedor.nome})`);
  return responder({ registro: salvo, dryRun: provedor.nome === "dry-run" });
}

// ---------------------------------------------------------------- consulta --

/**
 * Traz o estado da plataforma para o registro ("Atualizar status"). So age em
 * "enviado" com token; qualquer outro estado volta como esta (idempotente: o
 * painel chama isto ao abrir a pagina).
 *
 * - enviado: atualiza quem ja assinou;
 * - concluido: baixa o PDF assinado e a trilha de auditoria, grava nos
 *   caminhos imutaveis (sem sobrescrever; se ja existem, segue) e so entao
 *   marca "assinado". Faltou um dos dois? Continua "enviado" e a proxima
 *   consulta tenta de novo -- "assinado" sem o arquivo assinado seria mentira;
 * - recusado, expirado, cancelado: volta a "pdf_gerado", com o motivo em
 *   `assinatura_status`, para a Mel corrigir e enviar de novo;
 * - o pedido sumiu da plataforma (404) ou o token nao se le: 409 com o
 *   caminho de saida ("Cancelar envio"). A consulta NAO destrava sozinha: e
 *   chamada ao abrir a pagina, e encerrar um envio e decisao da Mel.
 */
export async function sincronizar(
  id: string,
  reg: RegistroContratoInterno,
  io: IoAssinatura = IO_ASSINATURA,
): Promise<RegistroContrato | null> {
  const token = reg.assinatura_token;
  if (reg.status !== "enviado" || !token) return registroPublico(reg);

  const provedor = await provedorDoEnvio(token, id, "consultar", io);
  let r;
  try {
    r = await provedor.consultar(token, reg.assinatura_signatarios ?? []);
  } catch (e) {
    if (pedidoInalcancavel(e)) {
      console.warn(`[contrato] ${id} consultar: ${motivoInalcancavel(e)} (${provedor.nome})`);
      throw new Recusa(409, e.codigo === "inexistente" ? MENSAGEM_PEDIDO_SUMIU : e.message, {
        pedidoInexistente: true,
      });
    }
    throw recusaDaAssinatura(e, id, "consultar") ?? e;
  }

  const agora = new Date().toISOString();
  const base: PatchContrato = {
    assinatura_status: r.status,
    assinatura_signatarios: r.signatarios,
    assinatura_atualizada_em: agora,
  };
  const guarda = { status: ["enviado"] as const, token };
  const salvarOuReler = async (patch: PatchContrato) =>
    (await io.salvar(id, patch, guarda)) ?? (await io.ler(id));

  if (r.status === "concluido") {
    let assinado_path: string;
    let trilha_path: string;
    try {
      assinado_path = caminhoAssinado(id, token);
      await io.guardarPdf(assinado_path, await provedor.baixarAssinado(token), { substituir: false });
      trilha_path = caminhoTrilha(id, token);
      await io.guardarPdf(trilha_path, await provedor.baixarTrilha(token), { substituir: false });
    } catch (e) {
      // Guarda ao menos quem assinou; o status do contrato fica "enviado" e a
      // proxima consulta tenta baixar de novo.
      await io.salvar(id, base, guarda).catch(() => null);
      // So loga (etapa/HTTP/codigo); a frase da tela e uma so para os dois casos.
      if (e instanceof AssinaturaError) recusaDaAssinatura(e, id, "baixar assinado");
      if (e instanceof AssinaturaError || e instanceof ErroBancoContrato) {
        throw new Recusa(
          502,
          "Todos assinaram, mas não consegui guardar o contrato assinado agora. Clique em “Atualizar status” de novo em instantes.",
        );
      }
      throw e;
    }

    const registro = await salvarOuReler({
      ...base,
      status: "assinado",
      assinado_em: r.concluidoEm ?? agora,
      assinado_path,
      trilha_path,
    });
    console.log(`[contrato] ${id} assinado por todos (${provedor.nome})`);
    return registro;
  }

  if (r.status === "recusado" || r.status === "expirado" || r.status === "cancelado") {
    const registro = await salvarOuReler({ ...base, status: "pdf_gerado" });
    console.log(`[contrato] ${id} assinatura encerrada sem concluir: ${r.status} (${provedor.nome})`);
    return registro;
  }

  return salvarOuReler(base);
}

// ------------------------------------------------------------ cancelamento --

/**
 * "Cancelar envio" (DELETE /contrato/assinatura).
 *
 * Anula o pedido na plataforma (os links deixam de funcionar) e devolve o
 * contrato a "pdf_gerado", destravando o texto. Se todos ja tinham assinado,
 * nao ha o que cancelar: segue o caminho do concluido e guarda o assinado.
 *
 * Se a plataforma diz que o pedido nao existe mais (404 no cancelamento E na
 * consulta), ou o token gravado nao se le, nao ha o que anular por aqui: o
 * envio e encerrado SO no sistema, com o mesmo guard do cancelamento normal.
 * Sem isto o contrato ficava preso em "enviado" para sempre -- consultar e
 * cancelar falhavam e o texto nunca destravava.
 */
export async function cancelarEnvio(
  id: string,
  reg: RegistroContratoInterno | null,
  io: IoAssinatura = IO_ASSINATURA,
): Promise<Response> {
  if (!reg || reg.status !== "enviado") {
    throw new Recusa(409, "O contrato não está aguardando assinaturas.");
  }

  const agora = new Date().toISOString();
  const token = reg.assinatura_token;
  const encerrado: PatchContrato = {
    status: "pdf_gerado",
    assinatura_status: "cancelado",
    assinatura_atualizada_em: agora,
  };

  // Reserva sem token: um envio em andamento (ou que caiu no meio). Desfazer
  // a reserva basta -- se o envio ainda terminar, ele vai achar o registro
  // mudado e cancelar o proprio pedido na plataforma.
  if (!token) {
    const registro =
      (await io.salvar(id, encerrado, { status: ["enviado"], token: null })) ?? (await io.ler(id));
    console.warn(`[contrato] ${id} reserva de envio sem token desfeita`);
    return responder({ registro });
  }

  const provedor = await provedorDoEnvio(token, id, "cancelar", io);
  try {
    await provedor.cancelar(token);
  } catch (e) {
    if (e instanceof AssinaturaError && e.codigo === "ja_concluido") {
      const registro = await sincronizar(id, reg, io);
      return responder(
        {
          erro: "Todos já tinham assinado, então não dá mais para cancelar. O contrato assinado foi guardado.",
          registro,
        },
        409,
      );
    }
    if (pedidoInalcancavel(e)) {
      const registro = (await io.salvar(id, encerrado, { status: ["enviado"], token })) ?? (await io.ler(id));
      console.warn(`[contrato] ${id} cancelar: ${motivoInalcancavel(e)}; envio encerrado só no sistema (${provedor.nome})`);
      return responder({
        registro,
        pedidoInexistente: true,
        aviso:
          e.codigo === "inexistente"
            ? "O envio não existia mais na plataforma de assinatura, então foi encerrado só aqui. O texto está destravado."
            : "O registro do envio estava corrompido, então ele foi encerrado só aqui. Antes de enviar de novo, confira no painel da iLoveAPI se o pedido antigo não ficou aberto.",
      });
    }
    throw recusaDaAssinatura(e, id, "cancelar") ?? e;
  }

  const registro = (await io.salvar(id, encerrado, { status: ["enviado"], token })) ?? (await io.ler(id));

  console.log(`[contrato] ${id} envio para assinatura cancelado (${provedor.nome})`);
  return responder({ registro });
}
