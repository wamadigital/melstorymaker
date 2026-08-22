import "server-only";

type Resultado<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

/**
 * Reexecuta uma LEITURA que falhou, antes de dar o erro por definitivo.
 *
 * Existe por uma falha real e observada: em 22/08/2026 o quadro de leads passou
 * a mostrar "JWT issued at future" em UMA das quatro colunas, enquanto as outras
 * tres carregavam no mesmo request. A causa e do lado do Supabase -- a chave
 * `sb_secret_` e trocada por um JWT curto dentro da infra deles, e quando o no
 * que assina esta um instante a frente do que valida, o `iat` cai no futuro e a
 * requisicao e recusada. Nao da para corrigir daqui, e nao ha o que corrigir:
 * repetir resolve, porque a proxima requisicao pega outro no.
 *
 * So para leitura. Repetir SELECT e seguro porque nao tem efeito colateral --
 * nao usar isto em insert/update/delete, onde retentativa pode duplicar
 * escrita.
 *
 * Retenta qualquer erro de proposito: distinguir "transitorio" de "definitivo"
 * pela mensagem seria adivinhacao, e um erro real so custa duas tentativas a
 * mais antes de aparecer igual.
 */
export async function lerComRetentativa<T>(
  rotulo: string,
  executar: () => PromiseLike<Resultado<T>>,
  { tentativas = 3, esperaMs = 120 } = {},
): Promise<Resultado<T>> {
  let ultimo: Resultado<T> = { data: null, error: { message: "sem tentativa" } };

  for (let n = 1; n <= tentativas; n++) {
    // `executar` devolve um builder novo a cada chamada: o do supabase-js e
    // thenable de uso unico e nao pode ser aguardado duas vezes.
    ultimo = await executar();

    if (!ultimo.error) {
      if (n > 1) console.log(`[supabase] ${rotulo}: ok na tentativa ${n}`);
      return ultimo;
    }

    if (n < tentativas) {
      console.warn(
        `[supabase] ${rotulo}: tentativa ${n}/${tentativas} falhou (${ultimo.error.message}), repetindo`,
      );
      await new Promise((r) => setTimeout(r, esperaMs * n));
    }
  }

  // Log com a mensagem tecnica: a tela mostra texto humano, e sem isto aqui a
  // causa ficaria invisivel -- foi o que aconteceu com o "JWT issued at future",
  // que nunca chegou aos logs da Vercel.
  console.error(
    `[supabase] ${rotulo}: falhou nas ${tentativas} tentativas -- ${ultimo.error?.message}`,
  );
  return ultimo;
}
