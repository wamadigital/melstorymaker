import { z } from "zod";
import { assinaturaEmDryRun } from "@/lib/assinatura/adapter";
import { dadosContratoSchema } from "@/lib/contrato/tipos";
import { lerRegistro, salvarRegistro } from "@/lib/supabase/contratos";
import {
  MUDOU_NO_MEIO,
  Recusa,
  STATUS_EDITAVEIS,
  carregarLead,
  lerCorpo,
  recusarSeTravado,
  responder,
  rotaDoContrato,
} from "./_comum";

export const runtime = "nodejs";

/**
 * GET /api/admin/leads/[id]/contrato -- o contrato do lead, ou `null`.
 *
 * O registro vem SEM as colunas internas (caminho no Storage, token da
 * assinatura, posicoes do campo de assinatura): o select e explicito em
 * `lerRegistro`.
 *
 * `assinaturaDryRun` e so o booleano do modo (o painel ja o recebe pela
 * pagina), sem chave nem segredo. Existe para quem fala com a API de fora --
 * o `e2e:contrato` -- saber, ANTES de clicar em enviar, se ESTE servidor
 * mandaria o contrato de verdade. O .env de quem roda o teste nao diz isso.
 */
export const GET = rotaDoContrato("ler", async (_req, id) => {
  await carregarLead(id);
  return responder({ registro: await lerRegistro(id), assinaturaDryRun: assinaturaEmDryRun() });
});

const corpo = z.object({ dados: dadosContratoSchema });

/**
 * PUT /api/admin/leads/[id]/contrato -- "Salvar rascunho".
 *
 * Grava so os DADOS; o status fica como esta (o texto ja gerado continua la
 * ate a Mel gerar de novo). Primeiro salvamento cria o registro em "rascunho".
 * Com o contrato na assinatura (ou assinado), 409: os dados que alimentam o
 * texto nao mudam enquanto o cliente esta assinando.
 */
export const PUT = rotaDoContrato("salvar", async (req, id) => {
  const { dados } = await lerCorpo(req, corpo);
  await carregarLead(id);

  const atual = await lerRegistro(id);
  recusarSeTravado(atual?.status);

  // Escrita guardada pelo status lido: se o envio para assinatura travou o
  // texto no meio do caminho, isto vira 409 em vez de mexer num contrato que
  // o cliente ja recebeu.
  const registro = atual
    ? await salvarRegistro(id, { dados }, { status: STATUS_EDITAVEIS })
    : await salvarRegistro(id, { dados, status: "rascunho", avisos: [] });
  if (!registro) throw new Recusa(409, MUDOU_NO_MEIO);

  return responder({ registro });
});
