import { dataMinima, normalizarOpcoes } from "./engine";
import type { Passo, Respostas } from "./types";

// Validacao compartilhada entre o formulario (client) e os route handlers
// (server). Mensagens sempre em pt-BR -- elas aparecem pro lead.

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const RE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function somenteDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * DDDs que existem de fato no Brasil. Serve para pegar erro de digitacao
 * obvio (00, 10, 20...), nao para auditar o numero: se o DDD existe e o
 * tamanho bate, passa. Preferimos deixar um numero errado entrar a barrar um
 * lead legitimo -- a Mel liga e confere, o formulario nao e a Receita Federal.
 */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Checagem simples de telefone brasileiro. Retorna a mensagem de erro ou null.
 *
 * Aceita com ou sem o 55 na frente (lead que cola o numero internacional),
 * celular de 11 digitos e fixo de 10 -- WhatsApp Business roda em fixo, entao
 * barrar 10 digitos travaria empresa de verdade no fluxo corporativo.
 */
export function validarTelefoneBr(valor: string): string | null {
  let d = somenteDigitos(valor);
  // DDI colado na frente: 55 + DDD + numero.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);

  if (d.length !== 10 && d.length !== 11) {
    return "O WhatsApp precisa ter DDD + número. Ex: (19) 99999-9999";
  }
  if (!DDDS.has(Number.parseInt(d.slice(0, 2), 10))) {
    return "Esse DDD não existe. Confere pra mim?";
  }
  // Celular no Brasil comeca com 9 desde 2016. So exigimos isso quando o
  // numero TEM 11 digitos; com 10, e fixo e a regra nao se aplica.
  if (d.length === 11 && d[2] !== "9") {
    return "Número de celular começa com 9 depois do DDD.";
  }
  return null;
}

/** Aplica a mascara (00) 00000-0000 progressivamente, enquanto o lead digita. */
export function mascararTelefone(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Retorna a mensagem de erro, ou null se estiver valido.
 * `hoje` e injetavel para o teste nao depender da data real.
 */
export function validarResposta(passo: Passo, valor: string, hoje = new Date()): string | null {
  const v = (valor ?? "").trim();

  if (!v) {
    return passo.obrigatorio ? "Esse campo é obrigatório." : null;
  }

  switch (passo.tipo) {
    case "email":
      return RE_EMAIL.test(v) ? null : "Confere pra mim? Esse e-mail parece incompleto.";

    case "telefone":
      return validarTelefoneBr(v);

    case "data": {
      if (!RE_DATA_ISO.test(v)) return "Escolhe uma data válida.";
      const min = dataMinima(passo, hoje);
      // Comparacao lexicografica de ISO evita fuso horario por completo.
      if (min && v < min) return "A data precisa ser de hoje em diante.";
      return null;
    }

    case "hora":
      return RE_HORA.test(v) ? null : "Escolhe um horário válido.";

    case "numero": {
      if (!/^\d+$/.test(v)) return "Digita só o número, por favor.";
      const n = Number.parseInt(v, 10);
      const min = typeof passo.min === "number" ? passo.min : undefined;
      const max = typeof passo.max === "number" ? passo.max : undefined;
      if (min !== undefined && n < min) return `Precisa ser ${min} ou mais.`;
      if (max !== undefined && n > max) return `Precisa ser ${max} ou menos.`;
      return null;
    }

    case "escolha_unica": {
      const validos = normalizarOpcoes(passo.opcoes).map((o) => o.valor);
      return validos.includes(v) ? null : "Escolhe uma das opções.";
    }

    case "texto":
    default:
      return null;
  }
}

/** Valida um conjunto de passos de uma vez. Usado no submit final. */
export function validarPassos(
  passos: Passo[],
  respostas: Respostas,
  hoje = new Date(),
): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const passo of passos) {
    const erro = validarResposta(passo, respostas[passo.id] ?? "", hoje);
    if (erro) erros[passo.id] = erro;
  }
  return erros;
}
