import { z } from "zod";
import { anonimizar, anonimizarTexto, dadosPessoaisNoTexto, desanonimizar, resumoParaIa } from "@/lib/contrato/anonimizar";
import { criarRedator, iaDisponivel, IaError, IaIndisponivelError } from "@/lib/contrato/ia";
import { faltantes, montarContrato, type ContextoMontagem } from "@/lib/contrato/montar";
import { dadosContratoSchema, type Aviso, type DadosContrato, type DocumentoContrato } from "@/lib/contrato/tipos";
import { lerRegistro, salvarRegistro } from "@/lib/supabase/contratos";
import {
  MUDOU_NO_MEIO,
  Recusa,
  STATUS_EDITAVEIS,
  avisoNaoIncorporado,
  carregarLead,
  contextoDeMontagem,
  lerCorpo,
  recusarSeTravado,
  responder,
  rotaDoContrato,
} from "../_comum";
import { gravarTextoRedigido } from "../_escrita";

export const runtime = "nodejs";
// A redacao das condicoes especiais e a chamada mais longa do sistema
// (esforco alto, texto juridico). O client da IA corta antes disso.
export const maxDuration = 300;

const corpo = z.object({ dados: dadosContratoSchema });

/**
 * POST /api/admin/leads/[id]/contrato/redigir -- "Gerar texto do contrato".
 *
 * 1. Salva os dados (o que a Mel digitou nunca se perde por um 422).
 * 2. Faltou dado? 422 com a lista -- nada e montado pela metade.
 * 3. Monta o contrato inteiro por codigo (o nucleo deterministico).
 * 4. Se ha observacoes, a IA redige "Das condições especiais" a partir delas,
 *    lendo o contrato ANONIMIZADO. O texto volta com os nomes, e conferido
 *    (numero sem origem, trecho que o CDC anula) e entra como clausula "ia".
 * 5. Grava texto e avisos em "redigido" e ZERA o PDF: ele era de outro texto.
 *    Se outra aba mexeu nos dados ou no texto durante a IA, 409 e nada e
 *    gravado (`gravarTextoRedigido`).
 *
 * A IA falhar NUNCA trava a Mel: o contrato sai sem a clausula e um aviso diz
 * por que, para ela gerar de novo ou escrever a clausula no editor.
 */
export const POST = rotaDoContrato("redigir", async (req, id) => {
  const { dados } = await lerCorpo(req, corpo);
  const lead = await carregarLead(id);

  const atual = await lerRegistro(id);
  recusarSeTravado(atual?.status);

  const salvo = atual
    ? await salvarRegistro(id, { dados }, { status: STATUS_EDITAVEIS })
    : await salvarRegistro(id, { dados, status: "rascunho", avisos: [] });
  if (!salvo) throw new Recusa(409, MUDOU_NO_MEIO);

  const ctx = contextoDeMontagem(lead);
  const campos = faltantes(dados, ctx);
  if (campos.length > 0) {
    throw new Recusa(422, "Faltam dados para montar o contrato.", { campos });
  }

  const base = montarContrato(dados, ctx);
  const especiais = await condicoesEspeciais(id, dados, ctx, base.documento);
  // Montar de novo (e nao enxertar a clausula): e montarContrato que confere o
  // texto da IA contra o resto do contrato e preenche os `problemas`.
  const final = especiais.paragrafos ? montarContrato(dados, ctx, especiais.paragrafos) : base;

  // A IA pode ter levado minutos: se outra aba mudou os dados ou o texto
  // nesse meio tempo, este texto e de uma versao que nao existe mais (409).
  const registro = await gravarTextoRedigido(id, salvo, {
    documento: final.documento,
    avisos: [...final.avisos, ...especiais.avisos],
  });

  const n = final.documento.clausulas.length;
  console.log(
    `[contrato] ${id} texto montado (${n} cláusulas${especiais.paragrafos ? ", com condições especiais da IA" : ""})`,
  );
  return responder({ registro });
});

// -------------------------------------------------------- condicoes especiais --

type CondicoesEspeciais = { paragrafos: string[] | null; avisos: Aviso[] };

const AVISO_SEM_IA: Aviso = {
  origem: "sistema",
  gravidade: "atencao",
  texto:
    "A IA não está configurada: as observações não foram incorporadas ao texto. Escreva a cláusula no editor.",
};

/** A frase da IA ja vem pronta; so garante o ponto final antes de emendar a instrucao. */
function comPonto(frase: string): string {
  const f = frase.trim();
  return /[.!?]$/.test(f) ? f : `${f}.`;
}

function avisoFalhaIa(motivo: string): Aviso {
  return {
    origem: "sistema",
    gravidade: "atencao",
    texto: `${comPonto(motivo)} As observações não entraram no texto: gere o texto de novo ou escreva a cláusula de condições especiais no editor.`,
  };
}

/**
 * Os paragrafos de "Das condições especiais" (com os nomes de volta) e os
 * avisos da redacao. `paragrafos: null` = sem clausula.
 *
 * Sem observacoes, a IA nem e chamada: nao ha o que redigir, e cada chamada
 * leva segundos e custa.
 */
async function condicoesEspeciais(
  id: string,
  dados: DadosContrato,
  ctx: ContextoMontagem,
  documento: DocumentoContrato,
): Promise<CondicoesEspeciais> {
  if (!dados.observacoes.trim()) return { paragrafos: null, avisos: [] };
  if (!iaDisponivel()) return { paragrafos: null, avisos: [AVISO_SEM_IA] };

  // Decisao travada 3: a IA nao recebe nome, CPF, e-mail, telefone nem
  // endereco de quem assina. As observacoes tambem passam pela troca: podem
  // trazer conversa colada do cliente.
  const entrada = {
    contratoAnonimizado: anonimizar(documento, dados),
    resumo: resumoParaIa(dados, ctx),
    observacoes: anonimizarTexto(dados.observacoes, dados),
  };

  // Rede de seguranca da anonimizacao: se algum dado pessoal sobreviveu a
  // troca, a IA nao e chamada. O log diz so a CATEGORIA ("nome", "CPF"),
  // nunca o valor.
  const vazou = dadosPessoaisNoTexto(
    `${entrada.contratoAnonimizado}\n${entrada.resumo}\n${entrada.observacoes}`,
    dados,
  );
  if (vazou.length > 0) {
    console.warn(`[contrato] ${id} redigir: IA não chamada, dado pessoal após anonimizar (${vazou.join(", ")})`);
    return {
      paragrafos: null,
      avisos: [
        {
          origem: "sistema",
          gravidade: "atencao",
          texto:
            `As observações não foram enviadas à IA porque um dado pessoal (${vazou.join(", ")}) continuaria visível para ela. ` +
            "Escreva a cláusula de condições especiais no editor.",
        },
      ],
    };
  }

  try {
    const r = await criarRedator().redigirCondicoesEspeciais(entrada);
    const avisos = r.naoIncorporado.filter((t) => t.trim()).map(avisoNaoIncorporado);
    const paragrafos = r.necessaria
      ? r.paragrafos.map((p) => desanonimizar(p, dados)).filter((p) => p.trim())
      : [];
    return { paragrafos: paragrafos.length > 0 ? paragrafos : null, avisos };
  } catch (e) {
    if (e instanceof IaIndisponivelError) return { paragrafos: null, avisos: [AVISO_SEM_IA] };
    if (e instanceof IaError) {
      console.warn(`[contrato] ${id} redigir: IA falhou (${e.codigo}), contrato montado sem a cláusula`);
      return { paragrafos: null, avisos: [avisoFalhaIa(e.message)] };
    }
    console.error(`[contrato] ${id} redigir: falha inesperada na IA`, e);
    return { paragrafos: null, avisos: [avisoFalhaIa("A IA falhou por um motivo inesperado.")] };
  }
}
