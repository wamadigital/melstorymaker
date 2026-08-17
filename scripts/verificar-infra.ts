/**
 * Diagnostico da infra a partir do .env.local.
 *
 *   npm run infra:verificar
 *
 * Testa cada chave de verdade (banco, storage, auth, Resend) e diz exatamente
 * o que falta. Nunca imprime segredo: chaves aparecem mascaradas.
 *
 * Le process.env direto, sem passar pelo lib/env.ts, porque aquele modulo
 * estoura no primeiro problema -- e a graca aqui e listar TODOS de uma vez.
 */
import { createClient } from "@supabase/supabase-js";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const falha = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const alerta = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const titulo = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

let problemas = 0;
const erro = (m: string) => {
  falha(m);
  problemas++;
};

/** Mostra so o suficiente para conferir que e a chave certa. */
function mascarar(v: string): string {
  if (v.length <= 12) return `${v.slice(0, 2)}…(${v.length} chars)`;
  return `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)`;
}

function ler(nome: string): string | null {
  const v = process.env[nome]?.trim();
  return v ? v : null;
}

async function main() {
  console.log("\n\x1b[1mVerificação da infra — Mel Storymaker\x1b[0m");

  // ---------------------------------------------------------------- variaveis
  titulo("1. Variáveis de ambiente");

  const url = ler("NEXT_PUBLIC_SUPABASE_URL");
  const anon = ler("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = ler("SUPABASE_SERVICE_ROLE_KEY");
  const provider = ler("MAIL_PROVIDER") ?? "resend";
  const resendKey = ler("RESEND_API_KEY");
  const mailFrom = ler("MAIL_FROM");
  const replyTo = ler("MAIL_REPLY_TO");
  const dryRun = ler("MAIL_DRY_RUN");
  const whats = ler("MEL_WHATSAPP");
  const appUrl = ler("APP_URL");

  // `segredo: true` mascara. URL do projeto, remetente e WhatsApp aparecem
  // inteiros de proposito: e olhando para eles que se percebe que o valor
  // colado veio do projeto errado.
  const obrigatorias: { nome: string; valor: string | null; segredo?: boolean }[] = [
    { nome: "NEXT_PUBLIC_SUPABASE_URL", valor: url },
    { nome: "NEXT_PUBLIC_SUPABASE_ANON_KEY", valor: anon, segredo: true },
    { nome: "SUPABASE_SERVICE_ROLE_KEY", valor: service, segredo: true },
    { nome: "MAIL_FROM", valor: mailFrom },
    { nome: "MEL_WHATSAPP", valor: whats },
    { nome: "APP_URL", valor: appUrl },
  ];

  for (const { nome, valor, segredo } of obrigatorias) {
    if (valor) ok(`${nome} = ${segredo ? mascarar(valor) : valor}`);
    else erro(`${nome} está vazia`);
  }

  // Erro classico: colar a anon key no lugar da service role. As duas sao JWT
  // parecidos, e o sintoma seria o painel vazio sem nenhuma mensagem de erro.
  if (anon && service && anon === service) {
    erro("SUPABASE_SERVICE_ROLE_KEY é idêntica à anon key — são chaves diferentes no painel");
  }

  if (whats && !/^\d{12,13}$/.test(whats)) {
    erro(`MEL_WHATSAPP precisa ser só dígitos com DDI (ex: 5519999998888). Recebi: "${whats}"`);
  }
  if (mailFrom && !mailFrom.includes("@")) {
    erro(`MAIL_FROM precisa conter um e-mail. Recebi: "${mailFrom}"`);
  }
  if (replyTo) ok(`MAIL_REPLY_TO = ${replyTo}`);
  else alerta("MAIL_REPLY_TO vazia: as respostas dos leads não voltam pro Gmail da Mel");

  const emDryRun = dryRun === "1" || dryRun?.toLowerCase() === "true";
  if (emDryRun) ok("MAIL_DRY_RUN ligado — e-mail vai pro log, não pro lead");
  else alerta("MAIL_DRY_RUN DESLIGADO — clicar em 'Enviar' manda e-mail de verdade");

  // ----------------------------------------------------------------- supabase
  titulo("2. Supabase");

  if (!url || !service || !anon) {
    erro("pulando: faltam as chaves do Supabase");
  } else {
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Tabela leads + schema aplicado.
    const { count, error: erroTabela } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true });

    if (erroTabela) {
      if (/does not exist|schema cache/i.test(erroTabela.message)) {
        erro("tabela `leads` não existe — rode supabase/schema.sql no SQL Editor");
      } else {
        erro(`erro ao consultar leads: ${erroTabela.message}`);
      }
    } else {
      ok(`tabela \`leads\` acessível pela service role (${count ?? 0} registros)`);
    }

    // RLS de verdade: o cliente anon NAO pode enxergar lead nenhum.
    const anonimo = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: vazamento, error: erroAnon } = await anonimo.from("leads").select("id").limit(1);

    if (erroAnon) {
      ok("RLS bloqueando o cliente anon (leads inacessível sem service role)");
    } else if ((vazamento?.length ?? 0) > 0) {
      erro(
        "VAZAMENTO: o cliente anon está lendo leads. A tabela deve ter RLS ligado e ZERO policies.",
      );
    } else {
      ok("RLS bloqueando o cliente anon (nenhuma linha retornada)");
    }

    // Bucket das propostas.
    const { data: bucket, error: erroBucket } = await admin.storage.getBucket("propostas");
    if (erroBucket || !bucket) {
      erro(`bucket \`propostas\` não encontrado — rode supabase/schema.sql (${erroBucket?.message})`);
    } else if (!bucket.public) {
      erro("bucket `propostas` existe mas NÃO é público: o link do PDF no WhatsApp não vai abrir");
    } else {
      ok("bucket `propostas` existe e é público");
    }

    // Usuaria admin da Mel.
    const { data: usuarios, error: erroAuth } = await admin.auth.admin.listUsers();
    if (erroAuth) {
      erro(`não consegui listar usuários: ${erroAuth.message}`);
    } else if (usuarios.users.length === 0) {
      erro("nenhuma usuária no Auth — crie a conta da Mel em Authentication > Users > Add user");
    } else {
      ok(
        `${usuarios.users.length} usuária(s) no Auth: ${usuarios.users.map((u) => u.email).join(", ")}`,
      );
    }
  }

  // ------------------------------------------------------------------- resend
  titulo("3. E-mail");

  if (provider === "gmail") {
    const gmailUser = ler("GMAIL_USER");
    const gmailPass = ler("GMAIL_APP_PASSWORD");
    if (gmailUser && gmailPass) ok(`MAIL_PROVIDER=gmail com ${gmailUser} configurado`);
    else erro("MAIL_PROVIDER=gmail mas falta GMAIL_USER e/ou GMAIL_APP_PASSWORD");
  } else if (!resendKey) {
    if (emDryRun) alerta("RESEND_API_KEY vazia (ok enquanto MAIL_DRY_RUN=1)");
    else erro("RESEND_API_KEY vazia e MAIL_DRY_RUN desligado: o envio vai falhar");
  } else {
    ok(`RESEND_API_KEY = ${mascarar(resendKey)}`);

    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${resendKey}` },
      });

      if (r.status === 401 || r.status === 403) {
        erro("Resend recusou a API key (401/403) — gere outra em resend.com/api-keys");
      } else if (!r.ok) {
        erro(`Resend respondeu ${r.status}`);
      } else {
        const json = (await r.json()) as { data?: { name: string; status: string }[] };
        const dominios = json.data ?? [];

        if (dominios.length === 0) {
          erro("nenhum domínio no Resend — adicione melstorymaker.com.br em resend.com/domains");
        }

        for (const d of dominios) {
          if (d.status === "verified") ok(`domínio ${d.name}: verificado`);
          else
            alerta(
              `domínio ${d.name}: ${d.status} — o envio só funciona depois de verificar ` +
                `(ou use MAIL_PROVIDER=gmail como contingência)`,
            );
        }

        // O remetente precisa usar um dominio que o Resend conhece.
        const dominioDoFrom = mailFrom?.match(/@([^\s>]+)/)?.[1];
        if (dominioDoFrom && dominios.length > 0) {
          if (dominios.some((d) => d.name === dominioDoFrom)) {
            ok(`MAIL_FROM usa @${dominioDoFrom}, que está cadastrado no Resend`);
          } else {
            erro(
              `MAIL_FROM usa @${dominioDoFrom}, que NÃO está no Resend ` +
                `(cadastrados: ${dominios.map((d) => d.name).join(", ")})`,
            );
          }
        }
      }
    } catch (e) {
      erro(`não consegui falar com a API do Resend: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ resumo
  console.log("");
  if (problemas === 0) {
    console.log("\x1b[32m\x1b[1mTudo certo. Pode rodar `npm run dev`.\x1b[0m\n");
  } else {
    console.log(
      `\x1b[31m\x1b[1m${problemas} problema(s) para resolver antes de rodar.\x1b[0m\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
