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
 * Tambem cobre o "Lembrar por e-mail" dos cartoes de "Novo"
 * (`POST /api/admin/leads/[id]/lembrete-email`) e a pagina `/continuar/[id]`
 * do link do e-mail. As recusas rodam contra qualquer base; o ENVIO so contra
 * servidor local com MAIL_DRY_RUN=1 no .env.local -- e o servidor ainda tem de
 * confirmar o dry run na resposta, senao o script fica vermelho.
 *
 * E a caixa "ja chamei" ao lado do "Chamar no WhatsApp"
 * (`PATCH /api/admin/leads/[id]/chamado`): marca, desmarca, e recusa fora de
 * "Novo".
 *
 * Cria admin e leads temporarios e remove tudo no fim.
 */
import { createClient } from "@supabase/supabase-js";
import { STATUS, type Status } from "@/lib/form/types";
import { ROTULO_STATUS } from "@/lib/admin/rotulos";
import { baseEhLocal } from "./e2e-contrato";

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
const aviso = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

const EMAIL_TEMP = `quadro-${Date.now()}@wama.digital`;
const SENHA_TEMP = `E2e!${Math.random().toString(36).slice(2)}Aa9`;
const criados: string[] = [];

/**
 * Destino dos lembretes por e-mail do teste. `.invalid` e reservado (RFC 2606)
 * e nunca resolve: se um dia o dry run falhar, o e-mail nao chega a ninguem.
 */
const EMAIL_LEAD_LEMBRETE = "lead.teste@exemplo.invalid";
const MAIL_DRY_RUN_LOCAL = ["1", "true"].includes((process.env.MAIL_DRY_RUN ?? "").toLowerCase());

/** Lead de teste direto pela service role: o foco aqui e a rota de status. */
async function semear(
  status: Status,
  opcoes: { comPdf?: boolean; email?: string | null; lembreteEmailEm?: string } = {},
) {
  const email = opcoes.email === undefined ? "lead.teste@example.com" : opcoes.email;
  const { data } = await admin
    .from("leads")
    .insert({
      categoria: "casamento",
      status,
      respostas: {
        nome: "Lúcia",
        noivos: "TESTE Quadro",
        data: "2027-08-31",
        ...(email && { contato_email: email }),
        contato_whatsapp: "(19) 99999-8888",
      },
      nome_display: "TESTE Quadro",
      data_evento: "2027-08-31",
      email,
      whatsapp: "19999998888",
      pdf_url: opcoes.comPdf ? "https://exemplo.invalid/proposta.pdf" : null,
      lembrete_email_em: opcoes.lembreteEmailEm ?? null,
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

  // ------------------------------------------------------ lembrete por e-mail
  const lembrar = (id: string, comSessao = true) =>
    fetch(`${BASE}/api/admin/leads/${id}/lembrete-email`, {
      method: "POST",
      headers: comSessao ? { Cookie: cookie } : {},
    });
  const carimboDe = async (id: string) =>
    (await admin.from("leads").select("status, lembrete_email_em").eq("id", id).single()).data;
  const DIA = 86_400_000;

  const novo = await semear("incompleto", { email: EMAIL_LEAD_LEMBRETE });

  const lSemCookie = await lembrar(novo, false);
  checar(lSemCookie.status === 401, `lembrete sem sessão → 401 (veio ${lSemCookie.status})`);

  const lNaoUuid = await lembrar("nao-e-uuid");
  checar(lNaoUuid.status === 404, `lembrete com id não-uuid → 404 (veio ${lNaoUuid.status})`);

  const semEmail = await semear("incompleto", { email: null });
  const lSemEmail = await lembrar(semEmail);
  checar(lSemEmail.status === 422, `lembrete para lead sem e-mail → 422 (veio ${lSemEmail.status})`);

  // O lembrete chama de volta para o formulario: fora de "Novo" nao ha para
  // onde voltar.
  const foraDeNovo = await semear("aguardando_revisao", { email: EMAIL_LEAD_LEMBRETE });
  const lFora = await lembrar(foraDeNovo);
  checar(lFora.status === 409, `lembrete fora de Novo → 409 (veio ${lFora.status})`);
  checar(!(await carimboDe(foraDeNovo))?.lembrete_email_em, "fora de Novo nada é carimbado");

  const ha3Dias = new Date(Date.now() - 3 * DIA).toISOString();
  const lembradoHa3 = await semear("incompleto", { email: EMAIL_LEAD_LEMBRETE, lembreteEmailEm: ha3Dias });
  const lCedo = await lembrar(lembradoHa3);
  const jsonCedo = await lCedo.json().catch(() => ({}));
  checar(lCedo.status === 409, `lembrete de 3 dias atrás → 409 (veio ${lCedo.status})`);
  checar(jsonCedo.erro?.includes("O próximo libera em"), `mensagem diz quando libera: "${jsonCedo.erro}"`);
  checar(
    Date.parse((await carimboDe(lembradoHa3))?.lembrete_email_em) === Date.parse(ha3Dias),
    "a recusa não mexe no carimbo",
  );

  // A pagina de passagem do link do e-mail.
  const passagem = await fetch(`${BASE}/continuar/${novo}`, { redirect: "manual" });
  const htmlPassagem = await passagem.text();
  checar(passagem.status === 200, `/continuar/{id} → 200 (veio ${passagem.status})`);
  checar(
    htmlPassagem.includes(`"mel:lead_id","${novo}"`),
    "/continuar grava o lead no localStorage e segue para o formulário",
  );
  checar(passagem.headers.get("referrer-policy") === "no-referrer", "/continuar responde no-referrer");
  const passagemTorta = await fetch(`${BASE}/continuar/nao-e-uuid`, { redirect: "manual" });
  checar(
    passagemTorta.status === 307 && (passagemTorta.headers.get("location") ?? "").endsWith("/formulario"),
    `/continuar com id torto → 307 para o formulário (veio ${passagemTorta.status})`,
  );

  if (!baseEhLocal(BASE) || !MAIL_DRY_RUN_LOCAL) {
    aviso("envio do lembrete pulado: só roda contra servidor local, com MAIL_DRY_RUN=1 no .env.local");
  } else {
    const enviou = await lembrar(novo);
    const jsonEnviou = await enviou.json().catch(() => ({}));
    checar(enviou.status === 200, `lembrete em Novo com e-mail → 200 (veio ${enviou.status})`);
    checar(jsonEnviou.dryRun === true, "o servidor confirmou o dry run: nada saiu de verdade");
    const carimbado = await carimboDe(novo);
    checar(
      Date.parse(carimbado?.lembrete_email_em) === Date.parse(jsonEnviou.lembrete_email_em),
      "lembrete_email_em carimbado",
    );
    checar(carimbado?.status === "incompleto", "o lead continua em Novo");

    const deNovo = await lembrar(novo);
    checar(deNovo.status === 409, `segundo clique logo depois → 409 (veio ${deNovo.status})`);

    // Dois cliques ao mesmo tempo (ou duas abas): a escrita condicional deixa
    // passar um so -- sao dois e-mails a menos na caixa do lead.
    const corrida = await semear("incompleto", { email: EMAIL_LEAD_LEMBRETE });
    const [a, b] = await Promise.all([lembrar(corrida), lembrar(corrida)]);
    checar(
      [a.status, b.status].sort().join(",") === "200,409",
      `dois cliques simultâneos → um 200 e um 409 (veio ${a.status} e ${b.status})`,
    );

    const ha7Dias = new Date(Date.now() - 7 * DIA - 60_000).toISOString();
    await admin.from("leads").update({ lembrete_email_em: ha7Dias }).eq("id", novo);
    const liberado = await lembrar(novo);
    checar(liberado.status === 200, `passados 7 dias, libera de novo → 200 (veio ${liberado.status})`);

    const quadro = await (await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } })).text();
    checar(
      quadro.includes("Lembrete enviado") && quadro.includes("Libera de novo em 7 dias"),
      "o cartão mostra o botão travado, com a legenda de quando libera",
    );
    checar(quadro.includes("Libera de novo em 4 dias"), "o lembrado há 3 dias libera em 4");
  }

  // ----------------------------------------------- "ja chamei no WhatsApp"
  const marcarChamado = (id: string, corpo: unknown, comSessao = true) =>
    fetch(`${BASE}/api/admin/leads/${id}/chamado`, {
      method: "PATCH",
      headers: comSessao ? auth : { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  const chamadoDe = async (id: string) =>
    (await admin.from("leads").select("chamado_whatsapp_em").eq("id", id).single()).data
      ?.chamado_whatsapp_em;

  const paraChamar = await semear("incompleto");

  const cSemCookie = await marcarChamado(paraChamar, { chamado: true }, false);
  checar(cSemCookie.status === 401, `"já chamei" sem sessão → 401 (veio ${cSemCookie.status})`);

  const cNaoUuid = await marcarChamado("nao-e-uuid", { chamado: true });
  checar(cNaoUuid.status === 404, `"já chamei" com id não-uuid → 404 (veio ${cNaoUuid.status})`);

  const cInexistente = await marcarChamado(crypto.randomUUID(), { chamado: true });
  checar(cInexistente.status === 404, `"já chamei" em lead que não existe → 404 (veio ${cInexistente.status})`);

  const cLixo = await marcarChamado(paraChamar, { chamado: "sim" });
  checar(cLixo.status === 400, `"já chamei" com payload torto → 400 (veio ${cLixo.status})`);

  const marcou = await marcarChamado(paraChamar, { chamado: true });
  const jsonMarcou = await marcou.json().catch(() => ({}));
  checar(marcou.status === 200, `marcar "já chamei" em Novo → 200 (veio ${marcou.status})`);
  checar(
    !!jsonMarcou.chamado_whatsapp_em &&
      Date.parse(await chamadoDe(paraChamar)) === Date.parse(jsonMarcou.chamado_whatsapp_em),
    "chamado_whatsapp_em carimbado",
  );

  // O cartao sai do servidor ja apagado e com a caixa marcada.
  const quadroChamado = await (await fetch(`${BASE}/admin`, { headers: { Cookie: cookie } })).text();
  checar(
    quadroChamado.includes("Já chamado no WhatsApp em ") && quadroChamado.includes('aria-disabled="true"'),
    "o cartão mostra o botão apagado e a caixa marcada, com a data",
  );

  const desmarcou = await marcarChamado(paraChamar, { chamado: false });
  checar(desmarcou.status === 200, `desmarcar → 200 (veio ${desmarcou.status})`);
  checar((await chamadoDe(paraChamar)) === null, "desmarcar limpa o carimbo");

  // Fora de "Novo" o botao nem existe: a rota recusa, e nada e carimbado.
  const cFora = await marcarChamado(foraDeNovo, { chamado: true });
  checar(cFora.status === 409, `"já chamei" fora de Novo → 409 (veio ${cFora.status})`);
  checar((await chamadoDe(foraDeNovo)) === null, "fora de Novo nada é carimbado");

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
