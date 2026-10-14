/**
 * Quem entra no painel. Sessao valida do Supabase Auth NAO basta: em 14/10/2026
 * o projeto de producao estava com o cadastro publico aberto
 * (`disable_signup: false`), e o middleware tratava qualquer usuario logado
 * como a Mel. Quem conseguisse criar e confirmar uma conta leria leads e
 * contratos (CPF, endereco) pela service role. A lista e a segunda tranca, para
 * o dia em que o cadastro for reaberto por engano no dashboard.
 *
 * `ADMIN_EMAILS` e separado por virgula e comparado sem caixa. Cada item e:
 *   - um e-mail exato: `mel@wama.digital`;
 *   - um dominio inteiro, comecando por `@`: `@wama.digital`. Vale so o dominio
 *     exato (`@wama.digital` nao libera `x@sub.wama.digital`). E mais frouxo: a
 *     tranca passa a ser quem controla as caixas do dominio, e depende de a
 *     confirmacao de e-mail continuar ligada no Supabase. Existe porque os
 *     `e2e:*` criam admins temporarios `<prefixo>-<timestamp>@wama.digital`.
 *
 * Sem a variavel, ou sem nenhum item valido, a lista e `null` e o painel fica
 * FECHADO para todo mundo (a Mel inclusive) -- mesma regra do middleware para
 * as envs do Supabase. Item torto e ignorado, nunca vira permissao.
 */
export type ListaAdmins = {
  emails: ReadonlySet<string>;
  dominios: ReadonlySet<string>;
};

const DOMINIO = /^[^\s@]+\.[^\s@]+$/;

function normalizar(v: string): string {
  return v.trim().toLowerCase();
}

/** Dominio de um e-mail ja normalizado, ou null se nao tiver formato de e-mail. */
function dominioDe(email: string): string | null {
  const arroba = email.indexOf("@");
  if (arroba <= 0 || arroba !== email.lastIndexOf("@")) return null;
  const dominio = email.slice(arroba + 1);
  return DOMINIO.test(dominio) ? dominio : null;
}

export function lerListaAdmins(bruto: string | undefined): ListaAdmins | null {
  const emails = new Set<string>();
  const dominios = new Set<string>();

  for (const item of (bruto ?? "").split(",").map(normalizar)) {
    if (item.startsWith("@")) {
      const dominio = item.slice(1);
      if (DOMINIO.test(dominio)) dominios.add(dominio);
    } else if (dominioDe(item)) {
      emails.add(item);
    }
  }

  return emails.size + dominios.size > 0 ? { emails, dominios } : null;
}

/** A conta pode usar o painel? Sem lista, ninguem pode. */
export function ehAdmin(email: string | null | undefined, lista: ListaAdmins | null): boolean {
  if (!lista || !email) return false;
  const normal = normalizar(email);
  const dominio = dominioDe(normal);
  if (!dominio) return false;
  return lista.emails.has(normal) || lista.dominios.has(dominio);
}
