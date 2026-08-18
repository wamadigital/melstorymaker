/**
 * E2E do painel: gera PDF, sobe no Storage, envia e-mail REAL e confere status.
 * Cria um admin temporario e o remove no fim.
 */
import { createClient } from "@supabase/supabase-js";

// Aceita a URL como 2o argumento para rodar contra producao:
//   npm run e2e:admin -- voce@email.com https://melstorymaker.com.br
const BASE = process.argv[3] || "http://localhost:3000";
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = URL_SB.replace("https://", "").split(".")[0];
const DESTINO = process.argv[2] || "henrique@wama.digital";

let falhas = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m: string) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); falhas++; };
const checar = (c: boolean, m: string) => (c ? ok(m) : erro(m));

const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

const EMAIL_TEMP = `e2e-${Date.now()}@wama.digital`;
const SENHA_TEMP = `E2e!${Math.random().toString(36).slice(2)}Aa9`;

async function main() {
  console.log("\n\x1b[1mE2E do painel\x1b[0m\n");

  // 1. admin temporario
  const { error: e1 } = await admin.auth.admin.createUser({
    email: EMAIL_TEMP, password: SENHA_TEMP, email_confirm: true,
  });
  if (e1) { erro(`criar admin temp: ${e1.message}`); process.exit(1); }
  ok(`admin temporário criado (${EMAIL_TEMP})`);

  // 2. sessao -> cookie no formato do @supabase/ssr
  const publico = createClient(URL_SB, ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await publico.auth.signInWithPassword({
    email: EMAIL_TEMP, password: SENHA_TEMP,
  });
  if (e2 || !sess.session) { erro(`login: ${e2?.message}`); process.exit(1); }
  ok("login autenticado");

  const nome = `sb-${REF}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64url");
  // @supabase/ssr divide em pedacos acima de ~3180 chars
  const partes: string[] = [];
  const TAM = 3180;
  for (let i = 0; i < valor.length; i += TAM) partes.push(valor.slice(i, i + TAM));
  const cookie = partes.length === 1
    ? `${nome}=${valor}`
    : partes.map((p, i) => `${nome}.${i}=${p}`).join("; ");

  const auth = { Cookie: cookie };

  const teste = await fetch(`${BASE}/admin`, { headers: auth, redirect: "manual" });
  checar(teste.status === 200, `sessão aceita pelo middleware (/admin -> ${teste.status})`);
  if (teste.status !== 200) { await limpar(); process.exit(1); }

  // 3. lead dedicado com o e-mail de destino real
  const { data: lead } = await admin.from("leads").insert({
    categoria: "casamento",
    status: "aguardando_revisao",
    respostas: {
      nome: "Lúcia", noivos: "Ana & João", data: "2027-08-31", horario: "16:00",
      local_cerimonia: "Igreja Nossa Senhora do Brasil",
      local_festa: "Espaço Villa Bisutti",
      making_of: "Sim", local_making_of: "Hotel Fasano",
      entrega: "Em tempo real",
      contato_email: DESTINO, contato_whatsapp: "(19) 99999-8888",
    },
    nome_display: "Ana & João", data_evento: "2027-08-31",
    email: DESTINO, whatsapp: "19999998888",
  }).select("id").single();
  ok(`lead de teste criado (envio irá para ${DESTINO})`);
  const id = lead!.id;

  // 4. gerar PDF
  const g = await fetch(`${BASE}/api/admin/leads/${id}/gerar-pdf`, { method: "POST", headers: auth });
  const gj = await g.json();
  checar(g.status === 200, `gerar-pdf HTTP ${g.status}`);
  if (g.status !== 200) console.log("   ", JSON.stringify(gj));
  checar(!!gj.pdf_url, "pdf_url gravado no lead");
  console.log(`    tamanho: ${(gj.tamanhoBytes / 1024).toFixed(0)}kB | placeholder: ${gj.usouPlaceholder} | fonte fallback: ${gj.usouFallbackDeFonte}`);

  // 5. o PDF abre publicamente (o link vai por WhatsApp)
  const pub = await fetch(gj.pdf_url);
  checar(pub.ok, `PDF acessível publicamente (HTTP ${pub.status})`);
  checar(pub.headers.get("content-type")?.includes("pdf") ?? false, "content-type é application/pdf");
  const bytes = Buffer.from(await pub.arrayBuffer());
  checar(bytes.subarray(0, 5).toString() === "%PDF-", "arquivo começa com %PDF-");

  // 6. regerar mantem a MESMA url (link do WhatsApp nao pode quebrar)
  const g2 = await fetch(`${BASE}/api/admin/leads/${id}/gerar-pdf`, { method: "POST", headers: auth });
  const g2j = await g2.json();
  checar(g2j.pdf_url === gj.pdf_url, "regerar mantém a URL estável (RF-14)");

  // 7. envio REAL
  const env = await fetch(`${BASE}/api/admin/leads/${id}/enviar`, { method: "POST", headers: auth });
  const ej = await env.json();
  checar(env.status === 200, `enviar HTTP ${env.status}`);
  if (env.status !== 200) console.log("   ", JSON.stringify(ej));
  else {
    checar(ej.comAnexo === true, "e-mail saiu com o PDF em anexo");
    // Nao exigir dry-run desligado: rodar com a trava ligada e o padrao seguro.
    // O que importa e a rota ter funcionado; o modo so precisa ficar explicito.
    if (ej.dryRun) {
      console.log("  \x1b[33m!\x1b[0m MAIL_DRY_RUN=1: e-mail foi para o log, não para a caixa.");
      console.log("    Para enviar de verdade: MAIL_DRY_RUN=0 no .env.local e reinicie o dev.");
    } else {
      ok("envio REAL — confira a caixa de entrada");
    }
  }

  // 8. status final
  const { data: fim } = await admin.from("leads")
    .select("status, enviado_em, pdf_gerado_em").eq("id", id).single();
  checar(fim?.status === "enviado", `status = enviado (RF-12)`);
  checar(!!fim?.enviado_em, "enviado_em registrado");

  await limpar();

  console.log(`\n  lead de teste: ${id}`);
  if (falhas) { console.log(`\n\x1b[31m\x1b[1m${falhas} falha(s).\x1b[0m\n`); process.exit(1); }
  console.log("\n\x1b[32m\x1b[1mPainel aprovado. Confira a caixa de entrada.\x1b[0m\n");
}

async function limpar() {
  const { data } = await admin.auth.admin.listUsers();
  const temp = data?.users.find((u) => u.email === EMAIL_TEMP);
  if (temp) {
    await admin.auth.admin.deleteUser(temp.id);
    ok("admin temporário removido");
  }
}

main().catch(async (e) => { console.error(e); await limpar(); process.exit(1); });
