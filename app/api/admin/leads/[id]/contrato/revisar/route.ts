import { anonimizar, anonimizarTexto, dadosPessoaisNoTexto, desanonimizar, resumoParaIa } from "@/lib/contrato/anonimizar";
import { criarRedator, iaDisponivel, IaIndisponivelError } from "@/lib/contrato/ia";
import type { Aviso } from "@/lib/contrato/tipos";
import { lerRegistro, salvarRegistro } from "@/lib/supabase/contratos";
import {
  Recusa,
  carregarLead,
  contextoDeMontagem,
  ehAvisoNaoIncorporado,
  responder,
  rotaDoContrato,
} from "../_comum";
import { recusaDaIa } from "../_ia";

export const runtime = "nodejs";
export const maxDuration = 300;

const MUDOU_DURANTE_REVISAO = "O contrato mudou enquanto a IA revisava. Peça a revisão de novo.";

/**
 * POST /api/admin/leads/[id]/contrato/revisar -- a IA le o contrato montado e
 * devolve AVISOS. Nao reescreve nada: quem decide o que muda e a Mel.
 *
 * Os avisos novos substituem os da revisao anterior (origem "ia"). Ficam os
 * do sistema e os da redacao ("Observação que ficou fora do texto: ..."): o
 * painel chama esta rota logo depois de gerar o texto, e sem essa excecao o
 * recado da redacao sumiria antes de a Mel le-lo.
 *
 * Pode rodar com o contrato na assinatura: so grava avisos, nao toca no texto.
 */
export const POST = rotaDoContrato("revisar", async (_req, id) => {
  const lead = await carregarLead(id);

  const atual = await lerRegistro(id);
  if (!atual?.documento) throw new Recusa(409, "Gere o texto do contrato antes de revisar.");
  if (!iaDisponivel()) throw new Recusa(503, new IaIndisponivelError().message);

  const ctx = contextoDeMontagem(lead);
  const dados = atual.dados;

  // Decisao travada 3: contrato, resumo e observacoes vao com marcadores no
  // lugar dos dados pessoais.
  const entrada = {
    contratoAnonimizado: anonimizar(atual.documento, dados),
    resumo: resumoParaIa(dados, ctx),
    observacoes: anonimizarTexto(dados.observacoes, dados),
    // O revisor nao repete o que a Mel ja esta vendo.
    avisosSistema: atual.avisos.filter((a) => a.origem === "sistema").map((a) => a.texto),
  };

  const vazou = dadosPessoaisNoTexto(
    `${entrada.contratoAnonimizado}\n${entrada.resumo}\n${entrada.observacoes}`,
    dados,
  );
  if (vazou.length > 0) {
    console.warn(`[contrato] ${id} revisar: IA não chamada, dado pessoal após anonimizar (${vazou.join(", ")})`);
    throw new Recusa(
      422,
      `Não mandei o contrato para a IA porque um dado pessoal (${vazou.join(", ")}) continuaria visível para ela.`,
    );
  }

  let revisados: Aviso[];
  try {
    revisados = await criarRedator().revisar(entrada);
  } catch (e) {
    throw recusaDaIa(e, id, "revisar") ?? e;
  }
  // O revisor escreve com os marcadores ("[HOMENAGEADO]"); a Mel le os nomes.
  const avisosIa: Aviso[] = revisados.map((a) => ({ ...a, origem: "ia", texto: desanonimizar(a.texto, dados) }));

  // A revisao leva ate minutos. Se o texto ou os dados mudaram nesse meio
  // tempo, os avisos falam de um contrato que nao existe mais: descarta.
  // As duas leituras vem do banco (jsonb), entao a ordem das chaves e a mesma.
  const depois = await lerRegistro(id);
  if (
    !depois?.documento ||
    JSON.stringify(depois.documento) !== JSON.stringify(atual.documento) ||
    JSON.stringify(depois.dados) !== JSON.stringify(atual.dados)
  ) {
    throw new Recusa(409, MUDOU_DURANTE_REVISAO);
  }

  const avisos = [...depois.avisos.filter((a) => a.origem !== "ia" || ehAvisoNaoIncorporado(a)), ...avisosIa];
  // Guardada pela releitura: dela ate aqui, qualquer escrita (outra aba
  // editando o texto) faz os avisos falarem de um contrato que nao existe mais.
  const registro = await salvarRegistro(
    id,
    { avisos, revisado_em: new Date().toISOString() },
    { status: [depois.status], atualizadoEm: depois.updated_at },
  );
  if (!registro) throw new Recusa(409, MUDOU_DURANTE_REVISAO);

  console.log(`[contrato] ${id} revisado pela IA (${avisosIa.length} aviso(s))`);
  return responder({ registro });
});
