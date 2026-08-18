/**
 * Confere que nenhum segredo real chegou ao bundle servido ao navegador.
 *
 *   npm run build && npm run bundle:verificar
 *
 * Procura pelos VALORES das chaves, nao pelos nomes. Grepar por "service_role"
 * ou "sb_secret" da falso positivo: a propria biblioteca do Supabase carrega
 * essas strings para detectar o formato da chave. O unico teste que significa
 * alguma coisa e procurar o segredo em si.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = ".next/static";

const SEGREDOS: [string, string][] = [
  ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""],
  ["GMAIL_APP_PASSWORD", process.env.GMAIL_APP_PASSWORD ?? ""],
];

function* arquivos(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* arquivos(p);
    else yield p;
  }
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`\n${DIR} não existe. Rode \`npm run build\` antes.\n`);
    process.exit(1);
  }

  // Segredo curto demais daria falso positivo por coincidencia.
  const conferir = SEGREDOS.filter(([, v]) => v.trim().length > 8);
  if (conferir.length === 0) {
    console.error("\nNenhum segredo preenchido no .env.local: nada a verificar.\n");
    process.exit(1);
  }

  let vazou = false;
  let total = 0;

  for (const arquivo of arquivos(DIR)) {
    total++;
    const conteudo = fs.readFileSync(arquivo, "utf8");
    for (const [nome, valor] of conferir) {
      if (conteudo.includes(valor.trim())) {
        console.log(`  \x1b[31m✗ ${nome} encontrada em ${arquivo}\x1b[0m`);
        vazou = true;
      }
    }
  }

  console.log(
    `\n  ${total} arquivos servidos ao navegador varridos, ` +
      `procurando ${conferir.length} segredo(s) pelo valor`,
  );

  if (vazou) {
    console.log("\n\x1b[31m\x1b[1mVAZAMENTO: segredo no bundle do client.\x1b[0m\n");
    process.exit(1);
  }
  console.log("\n\x1b[32m\x1b[1mOK — nenhum segredo real no bundle.\x1b[0m\n");
}

main();
