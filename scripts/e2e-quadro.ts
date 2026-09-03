/**
 * E2E do quadro de leads: exercita `PATCH /api/admin/leads/[id]/status`, que e a
 * primeira rota do sistema em que uma PESSOA reescreve o status de um lead.
 *
 *   npm run dev          # em outro terminal
 *   npm run e2e:quadro
 *
 * O teste que mais importa e o 4: ele prova que recusar o destino `incompleto`
 * realmente mantem o formulario publico fechado. Se um dia alguem afrouxar a
 * matriz de `lib/admin/status.ts`, e este script que fica vermelho.
 *
 * Cria admin e leads temporarios e remove tudo no fim.
 */
import { createClient } from "@supabase/supabase-js";
import { STATUS, type Status } from "@/lib/form/types";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";

const BASE = process.argv[2] || "http://localhost:3000";
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = URL_SB.replace("https://", "").split(".")[0];

let falhas = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  falhas++;
};
const checar = (c: boolean, m: string) => (c ? ok(m) : erro(m));

const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

const EMAIL_TEMP = `quadro-${Date.now()}@wama.digital`;
const SENHA_TEMP = `E2e!${Math.random().toString(36).slice(2)}Aa9`;
const criados: string[] = [];

/** Lead de teste direto pela service role: o foco aqui e a rota de status. */
async function semear(status: Status, opcoes: { comPdf?: boolean } = {}) {
  const { data } = await admin
    .from("leads")
    .insert({
      categoria: "casamento",
      status,
      respostas: {
        nome: "Lúcia",
        noivos: "TESTE Quadro",
        data: "2027-08-31",
        contato_email: "lead.teste@example.com",
        contato_whatsapp: "(19) 99999-8888",
      },
      nome_display: "TESTE Quadro",
      data_evento: "2027-08-31",
      email: "lead.teste@example.com",
      whatsapp: "19999998888",
      pdf_url: opcoes.comPdf ? "https://exemplo.invalid/proposta.pdf" : null,
    })
    .select("id")
    .single();
  criados.push(data!.id);
  return data!.id as string;
}

async function main() {
  console.log("\n\x1b[1mE2E do quadro de leads\x1b[0m\n");

  await admin.auth.admin.createUser({
    email: EMAIL_TEMP,
    password: SENHA_TEMP,
    email_confirm: true,
  });
  const publico = createClient(URL_SB, ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await publico.auth.signInWithPassword({
    email: EMAIL_TEMP,
    password: SENHA_TEMP,
  });
  if (e2 || !sess.session) {
    erro(`login: ${e2?.message}`);
    await limpar();
    process.exit(1);
  }

  const nomeCookie = `sb-${REF}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64url");
  const partes: string[] = [];
  for (let i = 0; i < valor.length; i += 3180) partes.push(valor.slice(i, i + 3180));
  const cookie =
    partes.length === 1
      ? `${nomeCookie}=${valor}`
      : partes.map((p, i) => `${nomeCookie}.${i}=${p}`).join("; ");
  const auth = { Cookie: cookie, "Content-Type": "application/json" };
  ok("sessão de admin temporária pronta");

  const mover = (id: string, corpo: Record<string, unknown>, comSessao = true) =>
    fetch(`${BASE}/api/admin/leads/${id}/status`, {
      method: "PATCH",
      headers: comSessao ? auth : { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  // ---------------------------------------------------------------- portaria
  const revisao = await semear("aguardando_revisao");

  const semCookie = await mover(revisao, { status: "enviado" }, false);
  checar(semCookie.status === 401, `sem sessão → 401 (veio ${semCookie.status})`);

  const naoUuid = await mover("nao-e-uuid", { status: "enviado" });
  checar(naoUuid.status === 404, `id não-uuid → 404 (veio ${naoUuid.status})`);

  const lixo = await mover(revisao, { status: "coluna_inventada" });
  checar(lixo.status === 400, `status inexistente → 400 (veio ${lixo.status})`);

  // ------------------------------------------------- PERIGO A: voltar p/ Novo
  const paraNovo = await mover(revisao, { status: "incompleto" });
  const jsonNovo = await paraNovo.json().catch(() => ({}));
  checar(paraNovo.status === 422, `destino "incompleto" → 422 (veio ${paraNovo.status})`);
  checar(
    typeof jsonNovo.erro === "string" && jsonNovo.erro.includes("não volta para Novo"),
    `mensagem explica a recusa: "${jsonNovo.erro}"`,
  );

  // A prova de que a recusa serve para alguma coisa: o formulario publico
  // continua fechado depois dela.
  const autosave = await fetch(`${BASE}/api/leads/${revisao}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ respostas: { noivos: "INVASOR" } }),
  });
  checar(autosave.status === 409, `autosave público segue fechado → 409 (veio ${autosave.status})`);

  const { data: intacto } = await admin
    .from("leads")
    .select("status, respostas")
    .eq("id", revisao)
    .single();
  checar(intacto?.status === "aguardando_revisao", "lead continua em aguardando_revisao");
  checar(
    (intacto?.respostas as Record<string, string>)?.noivos === "TESTE Quadro",
    "respostas não foram sobrescritas",
  );

  // ------------------------------------------- PERIGO B: "Enviado" sem proposta
  const semPdf = await mover(revisao, { status: "enviado" });
  const jsonSemPdf = await semPdf.json().catch(() => ({}));
  checar(semPdf.status === 422, `"enviado" sem PDF → 422 (veio ${semPdf.status})`);
  checar(jsonSemPdf.erro?.includes("Gere a proposta"), `mensagem orienta: "${jsonSemPdf.erro}"`);

  // ------------------------------------------------------ transições legítimas
  const comPdf = await semear("aguardando_revisao", { comPdf: true });

  const enviou = await mover(comPdf, { status: "enviado", de: "aguardando_revisao" });
  const jsonEnviou = await enviou.json().catch(() => ({}));
  checar(enviou.status === 200, `"enviado" com PDF → 200 (veio ${enviou.status})`);
  checar(!!jsonEnviou.enviado_em, "enviado_em carimbado ao entrar em enviado");
  const carimbo = jsonEnviou.enviado_em as string;

  const voltou = await mover(comPdf, { status: "aguardando_revisao" });
  checar(voltou.status === 200, `enviado → aguardando_revisao (desfazer) → 200`);
  const { data: apos } = await admin
    .from("leads")
    .select("status, enviado_em")
    .eq("id", comPdf)
    .single();
  checar(apos?.status === "aguardando_revisao", "status voltou para aguardando_revisao");
  checar(apos?.enviado_em === carimbo, "enviado_em NÃO foi limpo ao voltar (e-mail não desenvia)");

  const cliente = await mover(comPdf, { status: "virou_cliente" });
  checar(cliente.status === 200, `aguardando_revisao → virou_cliente → 200 (veio ${cliente.status})`);

  const repetido = await mover(comPdf, { status: "virou_cliente" });
  checar(repetido.status === 200, "mover para o status atual → 200 idempotente");

  // --------------------------------------------------------- concorrência (de)
  const velho = await mover(comPdf, { status: "enviado", de: "aguardando_revisao" });
  const jsonVelho = await velho.json().catch(() => ({}));
  checar(velho.status === 409, `"de" desatualizado → 409 (veio ${velho.status})`);
  checar(jsonVelho.erro?.includes("mudou de coluna"), `mensagem de concorrência: "${jsonVelho.erro}"`);

  // ------------------------------------------------------------- o quadro abre
  const pagina = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
  const html = await pagina.text();
  checar(pagina.status === 200, `/admin abre (HTTP ${pagina.status})`);
  // Derivado do enum, e nao de uma lista escrita a mao: status novo passava por
  // aqui sem nunca ser conferido -- foi o que aconteceu com "Lead perdido".
  for (const status of STATUS) {
    checar(html.includes(ROTULO_STATUS[status]), `coluna "${ROTULO_STATUS[status]}" no HTML`);
  }

  await limpar();

  if (falhas) {
    console.log(`\n\x1b[31m\x1b[1m${falhas} falha(s).\x1b[0m\n`);
    process.exit(1);
  }
  console.log("\n\x1b[32m\x1b[1mQuadro aprovado.\x1b[0m\n");
}

async function limpar() {
  if (criados.length) await admin.from("leads").delete().in("id", criados);
  const { data } = await admin.auth.admin.listUsers();
  const temp = data?.users.find((u) => u.email === EMAIL_TEMP);
  if (temp) await admin.auth.admin.deleteUser(temp.id);
  ok("leads e admin temporários removidos");
}

main().catch(async (e) => {
  console.error(e);
  await limpar();
  process.exit(1);
});
