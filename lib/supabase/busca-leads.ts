/** A mesma busca no quadro, na seleção de Esfriou e na navegação do detalhe. */
const CAMPOS_TEXTO = [
  "nome_display", "respostas->>nome", "respostas->>noivos",
  "respostas->>local_cerimonia", "respostas->>local_festa",
] as const;

const ACENTOS: Record<string, string> = {
  a: "[aáàâãä]", e: "[eéèêë]", i: "[iíìîï]",
  o: "[oóòôõö]", u: "[uúùûü]", c: "[cç]",
};

function textoLiteral(termo: string): string {
  return termo.normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[aeiouc]/gi, letra => ACENTOS[letra.toLowerCase()]);
}

/**
 * imatch procura trechos sem distinguir caixa. Só o código cria a regex;
 * pontuação digitada é literal. As aspas escapam também a gramática PostgREST.
 * Nenhum dado adicional das respostas precisa ser enviado ao navegador.
 */
export function filtroBuscaLeads(termo: string): string | null {
  const texto = termo.trim();
  if (!texto) return null;
  const valor = JSON.stringify(textoLiteral(texto));
  const filtros = CAMPOS_TEXTO.map(campo => `${campo}.imatch.${valor}`);

  if (/^[\d\s()+.\-]+$/.test(texto)) {
    let digitos = texto.replace(/\D/g, "");
    // O banco guarda só dígitos, com ou sem DDI. Nunca retirar o DDD 55.
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
    if (digitos) filtros.push(`whatsapp.imatch.${JSON.stringify(digitos)}`);
  }
  return filtros.join(",");
}

export function aplicarBuscaLeads<T extends { or(filtros: string): T }>(consulta: T, termo: string): T {
  const filtro = filtroBuscaLeads(termo);
  return filtro ? consulta.or(filtro) : consulta;
}
