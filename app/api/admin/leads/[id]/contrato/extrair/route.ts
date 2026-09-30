import { z } from "zod";
import { criarRedator } from "@/lib/contrato/ia";
import { carregarLead, lerCorpo, responder, rotaDoContrato } from "../_comum";
import { recusaDaIa } from "../_ia";

export const runtime = "nodejs";
// A extracao e curta, mas e chamada de modelo: a folga e a mesma das outras
// rotas de IA, e fica abaixo do limite da Vercel.
export const maxDuration = 300;

const corpo = z.object({ texto: z.string().trim().min(1).max(6000) });

/**
 * POST /api/admin/leads/[id]/contrato/extrair -- "Preencher com IA".
 *
 * A Mel cola o que o cliente mandou (nome, CPF, endereco, e-mail) e a IA
 * separa em campos. NAO salva nada: devolve o `Contratante` para o painel
 * mesclar so os campos nao vazios sobre o que ja esta preenchido, e a Mel
 * confere antes de salvar. O genero volta sempre vazio -- quem escolhe o
 * tratamento e ela, nunca a IA.
 *
 * E a unica chamada que manda dado pessoal a IA, e nao tem como ser diferente:
 * o texto colado E o dado. Por isso nada dele vai para log.
 */
export const POST = rotaDoContrato("extrair", async (req, id) => {
  const { texto } = await lerCorpo(req, corpo);
  await carregarLead(id);

  try {
    const { contratante, observacoes } = await criarRedator().extrairContratante(texto);
    return responder({ contratante, observacoes });
  } catch (e) {
    throw recusaDaIa(e, id, "extrair") ?? e;
  }
});
