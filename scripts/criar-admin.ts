/**
 * Cria a conta de acesso da Mel ao painel.
 *
 *   npm run admin:criar -- mel@exemplo.com
 *   npm run admin:criar -- mel@exemplo.com "senha-escolhida"
 *   npm run admin:criar -- mel@exemplo.com --redefinir
 *
 * Sem senha no argumento, gera uma forte e imprime UMA vez.
 *
 * Se a conta ja existe, o script NAO mexe nela sem `--redefinir`: trocar a
 * senha por engano trancaria a Mel do lado de fora do proprio painel.
 *
 * Existe em vez de criar pelo dashboard por causa do `email_confirm: true`.
 * No painel do Supabase isso e um toggle discreto ("Auto Confirm User") que,
 * esquecido, cria a conta em estado pendente: a Mel tenta entrar e recebe
 * "Email not confirmed", sem nenhuma pista do motivo. Aqui nao tem como esquecer.
 *
 * Nao existe tela de cadastro no sistema, de proposito (CLAUDE.md #9): a
 * usuaria e unica e nasce por aqui.
 */
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Sem I, l, 1, O, 0: a senha vai ser lida em voz alta ou digitada a mao.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SIMBOLOS = "!@#$%&*?";

function gerarSenha(tamanho = 20): string {
  const pool = ALFABETO + SIMBOLOS;
  // randomInt e criptograficamente seguro; Math.random nao seria aceitavel aqui.
  return Array.from({ length: tamanho }, () => pool[randomInt(pool.length)]).join("");
}

async function main() {
  const args = process.argv.slice(2);
  const redefinir = args.includes("--redefinir");
  const [email, senhaArg] = args.filter((a) => a !== "--redefinir");

  if (!email || !email.includes("@")) {
    console.error(
      "\nUso: npm run admin:criar -- <email> [senha] [--redefinir]\n" +
        "  --redefinir: troca a senha de uma conta que ja existe.\n",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !service) {
    console.error(
      "\nFaltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env.local.\n" +
        "A criacao de usuaria exige a service role: a API de admin do Auth nao\n" +
        "e exposta pelo MCP, por seguranca.\n",
    );
    process.exit(1);
  }

  const senha = senhaArg || gerarSenha();
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Nunca sobrescrever silenciosamente: se a conta ja existe, trocar a senha
  // sem avisar deixaria a Mel trancada do lado de fora sem entender por que.
  const { data: existentes, error: erroLista } = await admin.auth.admin.listUsers();
  if (erroLista) {
    console.error(`\nNao consegui listar as usuarias: ${erroLista.message}\n`);
    process.exit(1);
  }

  const jaExiste = existentes.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (jaExiste) {
    // Trocar a senha por acidente trancaria a Mel do lado de fora sem que ela
    // entendesse o motivo -- por isso exige a flag explicita.
    if (!redefinir) {
      console.log(
        `\nJa existe uma conta com ${email} (criada em ${jaExiste.created_at}).\n` +
          `Nada foi alterado.\n\n` +
          `Para definir uma senha nova:\n` +
          `  npm run admin:criar -- ${email} --redefinir\n`,
      );
      process.exit(0);
    }

    const { error: erroSenha } = await admin.auth.admin.updateUserById(jaExiste.id, {
      password: senha,
      email_confirm: true,
    });
    if (erroSenha) {
      console.error(`\nFalha ao redefinir a senha: ${erroSenha.message}\n`);
      process.exit(1);
    }

    console.log(
      [
        "",
        "\x1b[32m✓ Senha redefinida\x1b[0m",
        "",
        `  e-mail: ${email}`,
        `  senha:  ${senha}`,
        "",
        "  \x1b[33mA senha anterior deixou de valer neste momento.\x1b[0m",
        "",
        "  Entrar em: /admin/login",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    // O ponto principal deste script. Sem isso a conta nasce pendente.
    email_confirm: true,
  });

  if (error) {
    console.error(`\nFalha ao criar: ${error.message}\n`);
    process.exit(1);
  }

  console.log(
    [
      "",
      "\x1b[32m✓ Conta criada e confirmada\x1b[0m",
      "",
      `  e-mail: ${data.user.email}`,
      `  senha:  ${senha}`,
      "",
      senhaArg
        ? "  (senha definida por voce)"
        : "  \x1b[33mAnote agora: esta senha nao e recuperavel, so redefinivel.\x1b[0m",
      "",
      "  Entrar em: /admin/login",
      "",
    ].join("\n"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
