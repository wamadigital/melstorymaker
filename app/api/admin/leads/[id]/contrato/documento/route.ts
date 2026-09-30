import { z } from "zod";
import { ehClausulaDoModelo, validarDocumento } from "@/lib/contrato/validar";
import { documentoContratoSchema, type Clausula, type DocumentoContrato } from "@/lib/contrato/tipos";
import { lerRegistro } from "@/lib/supabase/contratos";
import { Recusa, carregarLead, lerCorpo, recusarSeTravado, responder, rotaDoContrato } from "../_comum";
import { gravarTextoEditado } from "../_escrita";

export const runtime = "nodejs";

const corpo = z.object({ documento: documentoContratoSchema });

/** Clausula que a Mel acrescenta no editor. */
const ID_LIVRE = /^livre-[1-9]\d{0,3}$/;

const colapsar = (s: string) => s.replace(/\s+/g, " ").trim();

/** Mesmo texto, ignorando espaco e paragrafo vazio (o editor re-serializa). */
function mesmoTexto(a: Clausula, b: Clausula): boolean {
  const paragrafos = (c: Clausula) => c.paragrafos.map(colapsar).filter(Boolean);
  return colapsar(a.titulo) === colapsar(b.titulo) && JSON.stringify(paragrafos(a)) === JSON.stringify(paragrafos(b));
}

/**
 * PUT /api/admin/leads/[id]/contrato/documento -- a Mel edita o texto.
 *
 * So as CLAUSULAS vem do editor (ordem, titulo, paragrafos, acrescentar e
 * remover). Partes, preambulo, local e data e o bloco de assinaturas ficam
 * como o sistema montou: sao derivados dos dados, e e o e-mail do bloco de
 * assinaturas que recebe o link. Editados a mao, o PDF diria uma pessoa e o
 * link iria para outra. Para mudar quem assina, muda-se o dado e gera-se o
 * texto de novo.
 *
 * `origem` e `problemas` NUNCA sao aceitos do navegador: clausula igual a
 * salva fica exatamente como estava (inclusive uma clausula da IA com
 * problema, que continua bloqueando o PDF); clausula alterada ou nova vira
 * "editada" e sem problemas -- editar e a Mel assumir o texto.
 */
export const PUT = rotaDoContrato("editar", async (req, id) => {
  const { documento } = await lerCorpo(req, corpo);
  await carregarLead(id);

  const atual = await lerRegistro(id);
  recusarSeTravado(atual?.status);
  if (!atual?.documento) throw new Recusa(409, "Gere o texto do contrato antes de editar.");

  const desconhecidas = documento.clausulas.filter((c) => !ehClausulaDoModelo(c.id) && !ID_LIVRE.test(c.id));
  if (desconhecidas.length > 0) {
    throw new Recusa(422, "Há cláusula com um identificador que o sistema não conhece.", {
      campos: desconhecidas.map((c) => `Cláusula “${colapsar(c.titulo) || "sem título"}”`),
    });
  }

  const salvas = new Map(atual.documento.clausulas.map((c) => [c.id, c]));
  const clausulas: Clausula[] = documento.clausulas.map((c) => {
    const salva = salvas.get(c.id);
    if (salva && mesmoTexto(salva, c)) return salva;
    return {
      id: c.id,
      titulo: colapsar(c.titulo),
      paragrafos: c.paragrafos.map((p) => p.trim()),
      origem: "editada",
      problemas: [],
    };
  });

  const novo: DocumentoContrato = { ...atual.documento, clausulas };

  // Sem mudanca nenhuma (Salvar sem ter mexido): nao derruba o PDF a toa.
  if (JSON.stringify(clausulas) === JSON.stringify(atual.documento.clausulas)) {
    return responder({ registro: atual });
  }

  const problemas = validarDocumento(novo);
  if (problemas.length > 0) {
    throw new Recusa(422, "O texto tem problemas que impedem salvar.", { campos: problemas });
  }

  // Validado: agora da para tirar paragrafo vazio sem esvaziar clausula.
  const final = documentoContratoSchema.parse({
    ...novo,
    clausulas: clausulas.map((c) => ({ ...c, paragrafos: c.paragrafos.filter((p) => p.trim()) })),
  });

  // Texto mudou: nenhum PDF o representa mais, e o que a outra aba tiver
  // gravado depois da leitura vira 409 em vez de ser sobrescrito.
  const registro = await gravarTextoEditado(id, atual, final);

  const alteradas = clausulas.filter((c) => c !== salvas.get(c.id)).length;
  const removidas = atual.documento.clausulas.filter((c) => !clausulas.some((n) => n.id === c.id)).length;
  console.log(`[contrato] ${id} texto editado (${alteradas} cláusula(s) alterada(s), ${removidas} removida(s))`);

  return responder({ registro });
});
