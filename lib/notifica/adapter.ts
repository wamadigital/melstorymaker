import "server-only";
import { env } from "@/lib/env";

/**
 * Envio da notificacao interna para o WhatsApp da Mel.
 *
 * Provider: CallMeBot (callmebot.com) -- gateway gratuito de notificacao
 * pessoal. A Mel autoriza UMA vez (manda uma mensagem para o numero deles e
 * recebe a apikey) e dali em diante so RECEBE. Nada e enviado do numero dela,
 * entao nao existe risco de banimento para o numero dela; o remetente e o bot
 * do proprio servico.
 *
 * Regras que nao mudam mesmo se o provider mudar:
 * 1. Falha aqui NUNCA pode quebrar o submit do lead. Quem chama ja esta em
 *    after() (pos-resposta) e este modulo ainda engole o erro com log.
 * 2. Conteudo minimo: a mensagem atravessa um terceiro. Ver mensagem.ts.
 * 3. Sem fone+apikey configurados, e um no-op declarado no log -- ambiente de
 *    dev e preview funcionam sem nenhuma conta.
 */
export async function notificarMel(texto: string): Promise<void> {
  if (env.NOTIFICA_DRY_RUN) {
    console.log("[notifica] DRY RUN, mensagem que seria enviada:\n" + texto);
    return;
  }

  const fone = env.NOTIFICA_WHATSAPP_FONE;
  const apikey = env.NOTIFICA_WHATSAPP_APIKEY;
  if (!fone || !apikey) {
    console.log("[notifica] desligada (NOTIFICA_WHATSAPP_FONE/APIKEY ausentes)");
    return;
  }

  try {
    const url =
      "https://api.callmebot.com/whatsapp.php" +
      `?phone=${fone}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(texto)}`;

    // Timeout curto: isto roda pos-resposta, mas funcao serverless pendurada
    // em gateway lento e custo e risco de estourar o teto da execucao.
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const corpo = await r.text();

    // O CallMeBot devolve 200 ate para falha logica; o corpo e que diz.
    if (!r.ok || /error/i.test(corpo)) {
      console.error(`[notifica] CallMeBot recusou (HTTP ${r.status}): ${corpo.slice(0, 200)}`);
      return;
    }
    console.log("[notifica] WhatsApp da Mel notificado");
  } catch (e) {
    console.error("[notifica] falha ao notificar (submit do lead NAO foi afetado)", e);
  }
}
