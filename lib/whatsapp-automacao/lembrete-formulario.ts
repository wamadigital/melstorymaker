import "server-only";
import { z } from "zod";

// Copy e pausas aprovadas. A quarta parte (link individual, pausa de 2s) nasce
// no SQL e fica congelada no snapshot; jobs existentes nunca sao recompostos.
export const MENSAGENS_LEMBRETE_FORMULARIO = Object.freeze([
  Object.freeze({ message: "Olá! Aqui é a Mel Storymaker 👋", delayBeforeSeconds: 0 }),
  Object.freeze({
    message: "Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊",
    delayBeforeSeconds: 2,
  }),
  Object.freeze({ message: "Suas respostas estão salvas. Para continuar de onde parou:", delayBeforeSeconds: 3 }),
] as const);

export type AmbienteLembreteFormulario = {
  WHATSAPP_AUTOMACAO_ATIVA?: string;
  WHATSAPP_LEMBRETE_FORMULARIO_ATIVO?: string;
  WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM?: string;
  APP_URL?: string;
};
export type ConfiguracaoLembreteFormulario = { inicioEm: string; appUrl: string };

const inicioSchema = z.string().datetime({ offset: true });
const flagAtiva = (valor: string | undefined) => valor?.toLowerCase() === "true" || valor === "1";

/** Apenas uma origem HTTPS: nenhum caminho, credencial, query ou fragmento. */
function origemHttps(valor: string | undefined): string | null {
  // Validar o texto antes do URL parser: ele normaliza /foo/.. e barras invertidas.
  if (!valor || !/^https:\/\/[^\s/?#\\@]+\/*$/i.test(valor)) return null;
  try {
    const url = new URL(valor);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^\/+$/u.test(url.pathname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Falha fechada; não lê ambiente nem relógio implicitamente. */
export function configuracaoLembreteFormulario(
  ambiente: AmbienteLembreteFormulario, agora: number,
): ConfiguracaoLembreteFormulario | null {
  if (!flagAtiva(ambiente.WHATSAPP_AUTOMACAO_ATIVA) ||
    !flagAtiva(ambiente.WHATSAPP_LEMBRETE_FORMULARIO_ATIVO)) return null;
  const inicio = inicioSchema.safeParse(ambiente.WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM);
  if (!inicio.success || !Number.isFinite(agora)) return null;
  const inicioMs = Date.parse(inicio.data);
  const appUrl = origemHttps(ambiente.APP_URL);
  if (!Number.isFinite(inicioMs) || inicioMs > agora || !appUrl) return null;
  return { inicioEm: new Date(inicioMs).toISOString(), appUrl };
}
