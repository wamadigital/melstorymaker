/**
 * E2E das rotas do contrato (`/api/admin/leads/[id]/contrato/**`): dados,
 * texto, edicao, PDF, download, assinatura em dry run, trava do texto e a
 * exclusao do lead levando os arquivos do bucket privado.
 *
 *   npm run dev -- -p 3100                          # em outro terminal
 *   npm run e2e:contrato -- http://localhost:3100
 *
 * PASSE A URL BASE. O padrao (http://localhost:3000) existe so por simetria
 * com os outros e2e: nesta maquina a porta 3000 e de OUTRO projeto. Antes de
 * criar qualquer coisa, o script confere que a base responde como o Sistema
 * Mel (401 em JSON numa rota do admin) e aborta se nao responder.
 *
 * SO RODA CONTRA SERVIDOR LOCAL (localhost, 127.0.0.1, [::1], *.localhost).
 * Producao tambem responde 401 "Sessão expirada.", e o script criaria admin e
 * lead no banco de verdade e poderia gastar credito de assinatura. Para
 * outra base, a flag explicita: `-- <base> --permitir-remoto`.
 *
 * Pre-requisitos:
 * - `supabase/schema.sql` aplicado (tabela `contratos` e bucket privado
 *   `contratos`). Sem isso as escritas respondem 503 e o script para cedo.
 * - ASSINATURA_DRY_RUN=1 no SERVIDOR testado (no dev, o .env.local que o
 *   `npm run dev` le). Quem diz o modo e o proprio servidor, no GET do
 *   contrato, ANTES do envio: o .env de quem roda o script nao prova nada
 *   sobre o servidor do outro lado. Fora do dry run a etapa de assinatura NAO
 *   roda -- ela mandaria o contrato de verdade e gastaria credito -- e o
 *   script termina vermelho, de proposito.
 * - Com ANTHROPIC_API_KEY, "gerar texto" chama a IA de verdade (custa e leva
 *   alguns segundos). Sem ela, confere o aviso de IA nao configurada.
 *
 * Cria admin e lead temporarios e remove so o que criou. Dados FICTICIOS: o
 * CPF foi gerado para passar no digito verificador e os e-mails sao do
 * dominio reservado example.com (nao entregam para ninguem).
 */
import { createClient } from "@supabase/supabase-js";
import { pacoteDoCatalogo, precoPacote } from "@/lib/contrato/catalogo";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import { dadosContratoSchema, type DadosContrato, type DocumentoContrato } from "@/lib/contrato/tipos";

const ARGS = process.argv.slice(2);
const PERMITIR_REMOTO = ARGS.includes("--permitir-remoto");
const BASE = (ARGS.find((a) => !a.startsWith("--")) || "http://localhost:3000").replace(/\/+$/, "");
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = URL_SB.replace("https://", "").split(".")[0];

const COM_IA = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

/**
 * A base e desta maquina? `localhost`, `127.0.0.1`, `[::1]` e `*.localhost`
 * (que o navegador e o Node resolvem para o loopback). Qualquer outra coisa
 * -- inclusive o dominio de producao -- exige `--permitir-remoto`.
 */
export function baseEhLocal(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

let falhas = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  falhas++;
};
const aviso = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const checar = (c: boolean, m: string) => (c ? ok(m) : erro(m));

const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

const EMAIL_TEMP = `contrato-${Date.now()}@wama.digital`;
const SENHA_TEMP = `E2e!${Math.random().toString(36).slice(2)}Aa9`;
const criados: string[] = [];

/** As colunas que NUNCA podem chegar ao navegador. */
const INTERNAS = ["pdf_path", "posicoes_assinatura", "assinatura_token", "assinado_path", "trilha_path"];

type Json = Record<string, unknown> & {
  erro?: string;
  campos?: string[];
  registro?: (Record<string, unknown> & { status?: string; documento?: DocumentoContrato | null }) | null;
};

async function lerJson(r: Response): Promise<Json> {
  return (await r.json().catch(() => ({}))) as Json;
}

function semColunasInternas(registro: Record<string, unknown> | null | undefined, onde: string) {
  const vazadas = INTERNAS.filter((c) => registro && c in registro);
  checar(vazadas.length === 0, `${onde}: registro sem colunas internas${vazadas.length ? ` (veio ${vazadas.join(", ")})` : ""}`);
}

/** Lead de teste direto pela service role: o foco sao as rotas do contrato. */
async function semearLead(): Promise<string> {
  const { data, error } = await admin
    .from("leads")
    .insert({
      categoria: "casamento",
      status: "aguardando_revisao",
      respostas: {
        nome: "Lúcia",
        noivos: "TESTE Contrato",
        data: "2027-08-31",
        horario: "16:00",
        local_cerimonia: "Espaço Teste",
        local_festa: "Espaço Teste",
        making_of: "Não",
        entrega: "Em até 1 semana",
        contato_email: "lead.contrato@example.com",
        contato_whatsapp: "(19) 99999-7777",
      },
      nome_display: "TESTE Contrato",
      data_evento: "2027-08-31",
      email: "lead.contrato@example.com",
      whatsapp: "19999997777",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`não consegui criar o lead de teste: ${error?.message}`);
  criados.push(data.id);
  return data.id as string;
}

/** Contrato completo de casamento, pacote principal, 30/70. Tudo ficticio. */
function dadosCompletos(observacoes = ""): DadosContrato {
  const pacote = pacoteDoCatalogo("casamento", "Pacote Principal")!;
  return dadosContratoSchema.parse({
    contratante: {
      tipo: "pf",
      pf: {
        nome: "Helena Duarte Vasconcelos",
        genero: "feminino",
        cpf: "41827365080",
        email: "helena.teste@example.com",
        telefone: "19991234567",
        endereco: {
          logradouro: "Rua dos Ipês",
          numero: "245",
          complemento: "",
          bairro: "Jardim das Flores",
          cidade: "Campinas",
          uf: "SP",
          cep: "13087000",
        },
      },
    },
    evento: {
      data: "2027-08-31",
      horarioInicio: "16:00",
      homenageado: "TESTE Contrato",
      locais: [{ rotulo: "Local da cerimônia e recepção", endereco: "Espaço Teste, Rua Um, 10, Centro, Campinas/SP" }],
      alimentacao: true,
    },
    servico: {
      tabela: "2027",
      pacote: pacote.nome,
      valorPacote: precoPacote("casamento", "2027", pacote.nome) ?? 0,
      escopo: pacote.escopo,
    },
    pagamento: pagamentoDoPreset("30/70"),
    observacoes,
  });
}

async function arquivosNoBucket(leadId: string): Promise<string[]> {
  const { data } = await admin.storage.from("contratos").list(leadId, { limit: 100 });
  return (data ?? []).map((o) => o.name);
}

async function main() {
  console.log(`\n\x1b[1mE2E do contrato\x1b[0m  (${BASE})\n`);

  // -------------------------------------------------- a base e desta maquina?
  if (!baseEhLocal(BASE) && !PERMITIR_REMOTO) {
    console.error(
      `\n\x1b[31m${BASE} não é um servidor local.\x1b[0m\n` +
        "Este script cria admin e lead de teste no banco que o servidor usa e exercita o envio para assinatura.\n" +
        "Rode contra o `npm run dev` (npm run e2e:contrato -- http://localhost:3100) ou, sabendo o que faz,\n" +
        "acrescente --permitir-remoto.\n",
    );
    process.exit(1);
  }
  if (!baseEhLocal(BASE)) aviso(`base remota permitida por --permitir-remoto: ${BASE}`);

  // ------------------------------------------------ a base e o Sistema Mel?
  const sonda = await fetch(`${BASE}/api/admin/leads/00000000-0000-0000-0000-000000000000/contrato`).catch(() => null);
  const jsonSonda = sonda ? await lerJson(sonda) : {};
  if (!sonda || sonda.status !== 401 || jsonSonda.erro !== "Sessão expirada.") {
    console.error(
      `\n\x1b[31m${BASE} não respondeu como o Sistema Mel (esperava 401 "Sessão expirada.", veio ${sonda?.status ?? "sem resposta"}).\x1b[0m\n` +
        "Suba o `npm run dev` em uma porta livre e passe a URL: npm run e2e:contrato -- http://localhost:3100\n",
    );
    process.exit(1);
  }
  ok("a base responde como o Sistema Mel (401 sem sessão)");

  // ----------------------------------------------------------------- sessao
  await admin.auth.admin.createUser({ email: EMAIL_TEMP, password: SENHA_TEMP, email_confirm: true });
  const publico = createClient(URL_SB, ANON, { auth: { persistSession: false } });
  const { data: sess, error: eLogin } = await publico.auth.signInWithPassword({ email: EMAIL_TEMP, password: SENHA_TEMP });
  if (eLogin || !sess.session) {
    erro(`login: ${eLogin?.message}`);
    await limpar();
    process.exit(1);
  }
  const nomeCookie = `sb-${REF}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64url");
  const partes: string[] = [];
  for (let i = 0; i < valor.length; i += 3180) partes.push(valor.slice(i, i + 3180));
  const cookie =
    partes.length === 1 ? `${nomeCookie}=${valor}` : partes.map((p, i) => `${nomeCookie}.${i}=${p}`).join("; ");
  ok("sessão de admin temporária pronta");

  const id = await semearLead();
  const url = (sufixo = "") => `${BASE}/api/admin/leads/${id}/contrato${sufixo}`;
  const chamar = (metodo: string, sufixo: string, corpo?: unknown, comSessao = true) =>
    fetch(url(sufixo), {
      method: metodo,
      headers: {
        ...(comSessao ? { Cookie: cookie } : {}),
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });

  // --------------------------------------------------------------- portaria
  const semCookie = await chamar("GET", "", undefined, false);
  checar(semCookie.status === 401, `sem sessão → 401 (veio ${semCookie.status})`);

  const naoUuid = await fetch(`${BASE}/api/admin/leads/nao-e-uuid/contrato`, { headers: { Cookie: cookie } });
  checar(naoUuid.status === 404, `id não-uuid → 404 (veio ${naoUuid.status})`);

  const inexistente = await fetch(`${BASE}/api/admin/leads/${crypto.randomUUID()}/contrato`, { headers: { Cookie: cookie } });
  checar(inexistente.status === 404, `lead inexistente → 404 (veio ${inexistente.status})`);

  const vazio = await chamar("GET", "");
  const jsonVazio = await lerJson(vazio);
  checar(vazio.status === 200 && jsonVazio.registro === null, `GET sem contrato → 200 { registro: null } (veio ${vazio.status})`);
  checar(
    typeof jsonVazio.assinaturaDryRun === "boolean",
    `GET do contrato diz o modo da assinatura do servidor (veio ${JSON.stringify(jsonVazio.assinaturaDryRun)})`,
  );

  // ------------------------------------------------------------------ dados
  const lixo = await chamar("PUT", "", { dados: { servico: { tabela: "1999" } } });
  checar(lixo.status === 400, `PUT com dados inválidos → 400 (veio ${lixo.status})`);

  const salvou = await chamar("PUT", "", { dados: dadosCompletos() });
  const jsonSalvou = await lerJson(salvou);
  checar(salvou.status === 200, `PUT dados → 200 (veio ${salvou.status}${jsonSalvou.erro ? `: ${jsonSalvou.erro}` : ""})`);
  if (salvou.status === 503) {
    erro("a tabela ou o bucket de contratos não existem: aplique supabase/schema.sql e rode de novo");
    await limpar();
    process.exit(1);
  }
  checar(jsonSalvou.registro?.status === "rascunho", `registro novo nasce em "rascunho" (veio ${jsonSalvou.registro?.status})`);
  semColunasInternas(jsonSalvou.registro, "PUT dados");

  // ------------------------------------------------------------------ texto
  const incompletos = dadosCompletos();
  incompletos.contratante.pf.cpf = "";
  const faltando = await chamar("POST", "/redigir", { dados: incompletos });
  const jsonFaltando = await lerJson(faltando);
  checar(faltando.status === 422, `gerar texto sem CPF → 422 (veio ${faltando.status})`);
  checar(
    Array.isArray(jsonFaltando.campos) && jsonFaltando.campos.some((c) => c.includes("CPF")),
    `422 lista o CPF em "campos": ${JSON.stringify(jsonFaltando.campos)}`,
  );

  const observacoes = "A CONTRATADA chega ao local com antecedência para conhecer o espaço antes do início da cobertura.";
  const redigiu = await chamar("POST", "/redigir", { dados: dadosCompletos(observacoes) });
  const jsonRedigiu = await lerJson(redigiu);
  checar(redigiu.status === 200, `gerar texto completo → 200 (veio ${redigiu.status}${jsonRedigiu.erro ? `: ${jsonRedigiu.erro}` : ""})`);
  const documento = jsonRedigiu.registro?.documento;
  checar(jsonRedigiu.registro?.status === "redigido" && !!documento, `status "redigido" com documento`);
  const avisos = (jsonRedigiu.registro?.avisos ?? []) as { origem: string; texto: string }[];
  const clausulas = documento?.clausulas ?? [];
  if (COM_IA) {
    const temClausula = clausulas.some((c) => c.id === "condicoes_especiais" && c.origem === "ia");
    const temAvisoIa = avisos.some((a) => a.origem === "ia");
    checar(temClausula || temAvisoIa, "com ANTHROPIC_API_KEY: condições especiais redigidas (ou aviso da IA explicando)");
  } else {
    checar(
      avisos.some((a) => a.texto.startsWith("A IA não está configurada")),
      "sem ANTHROPIC_API_KEY: aviso de que as observações não entraram no texto",
    );
    checar(!clausulas.some((c) => c.id === "condicoes_especiais"), "sem IA, sem cláusula de condições especiais");
  }

  if (!documento) {
    erro("sem documento, o resto do roteiro não tem o que testar");
    await limpar();
    process.exit(1);
  }

  // ---------------------------------------------------------------- edicao
  const semForo = { ...documento, clausulas: documento.clausulas.filter((c) => c.id !== "foro") };
  const removeu = await chamar("PUT", "/documento", { documento: semForo });
  const jsonRemoveu = await lerJson(removeu);
  checar(removeu.status === 422, `remover cláusula obrigatória (foro) → 422 (veio ${removeu.status})`);
  checar((jsonRemoveu.campos ?? []).some((c) => c.includes("DO FORO")), `422 diz qual cláusula falta: ${JSON.stringify(jsonRemoveu.campos)}`);

  const editado = {
    ...documento,
    clausulas: documento.clausulas.map((c) =>
      c.id === "entrega"
        ? { ...c, paragrafos: [...c.paragrafos, "O link será enviado ao e-mail da CONTRATANTE."], origem: "padrao" }
        : c,
    ),
  };
  const editou = await chamar("PUT", "/documento", { documento: editado });
  const jsonEditou = await lerJson(editou);
  checar(editou.status === 200, `editar cláusula → 200 (veio ${editou.status}${jsonEditou.erro ? `: ${jsonEditou.erro}` : ""})`);
  const entrega = jsonEditou.registro?.documento?.clausulas.find((c) => c.id === "entrega");
  checar(entrega?.origem === "editada", `cláusula alterada vira "editada" mesmo que o navegador diga "padrao" (veio ${entrega?.origem})`);

  // -------------------------------------------------------------------- PDF
  const gerou = await chamar("POST", "/pdf");
  const jsonGerou = await lerJson(gerou);
  checar(gerou.status === 200, `gerar PDF → 200 (veio ${gerou.status}${jsonGerou.erro ? `: ${jsonGerou.erro}` : ""})`);
  checar(jsonGerou.registro?.status === "pdf_gerado", `status "pdf_gerado" (veio ${jsonGerou.registro?.status})`);
  checar(Number(jsonGerou.paginas) >= 3, `PDF com ${jsonGerou.paginas} páginas`);
  checar(jsonGerou.usouFallbackDeFonte === false, "PDF com a DM Sans (sem fonte reserva)");
  semColunasInternas(jsonGerou.registro, "POST pdf");
  checar((await arquivosNoBucket(id)).includes("contrato.pdf"), "contrato.pdf no bucket privado");

  const baixou = await chamar("GET", "/arquivo?tipo=rascunho");
  const bytes = new Uint8Array(await baixou.arrayBuffer());
  checar(baixou.status === 200, `baixar PDF com sessão → 200 (veio ${baixou.status})`);
  checar(baixou.headers.get("content-type") === "application/pdf", `content-type application/pdf (veio ${baixou.headers.get("content-type")})`);
  checar(Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-", "o corpo é um PDF");
  checar((baixou.headers.get("cache-control") ?? "").includes("no-store"), `cache-control no-store (veio ${baixou.headers.get("cache-control")})`);
  checar(
    (baixou.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''"),
    `content-disposition com nome em UTF-8 (veio ${baixou.headers.get("content-disposition")})`,
  );

  const baixouSemSessao = await chamar("GET", "/arquivo?tipo=rascunho", undefined, false);
  checar(baixouSemSessao.status === 401, `baixar PDF sem sessão → 401 (veio ${baixouSemSessao.status})`);
  const semAssinado = await chamar("GET", "/arquivo?tipo=assinado");
  checar(semAssinado.status === 404, `contrato assinado antes de assinar → 404 (veio ${semAssinado.status})`);
  const tipoRuim = await chamar("GET", "/arquivo?tipo=qualquer");
  checar(tipoRuim.status === 400, `tipo de arquivo inválido → 400 (veio ${tipoRuim.status})`);

  // ------------------------------------------------------------- assinatura
  // O modo e perguntado ao SERVIDOR, logo antes do envio: e ele que mandaria
  // o contrato. Resposta que nao seja `true` (inclusive um servidor antigo,
  // sem o campo) conta como envio de verdade, e o envio nao acontece.
  const modo = await lerJson(await chamar("GET", ""));
  if (modo.assinaturaDryRun !== true) {
    erro(
      `o servidor em ${BASE} não está em ASSINATURA_DRY_RUN (veio ${JSON.stringify(modo.assinaturaDryRun)}): a etapa de assinatura NÃO foi exercitada (ela mandaria o contrato de verdade e gastaria crédito)`,
    );
  } else {
    const enviou = await chamar("POST", "/assinatura");
    const jsonEnviou = await lerJson(enviou);
    checar(enviou.status === 200, `enviar para assinatura (dry run) → 200 (veio ${enviou.status}${jsonEnviou.erro ? `: ${jsonEnviou.erro}` : ""})`);
    checar(jsonEnviou.dryRun === true, "a resposta confirma dry run");
    if (enviou.status === 200 && jsonEnviou.dryRun !== true) {
      aviso("o servidor NÃO está em dry run: cancelando o envio imediatamente");
    }
    checar(jsonEnviou.registro?.status === "enviado", `status "enviado" (veio ${jsonEnviou.registro?.status})`);
    checar(jsonEnviou.registro?.assinatura_status === "enviado", "assinatura_status \"enviado\"");
    const signatarios = (jsonEnviou.registro?.assinatura_signatarios ?? []) as unknown[];
    checar(signatarios.length === 2, `2 signatários (CONTRATANTE e CONTRATADA), veio ${signatarios.length}`);
    semColunasInternas(jsonEnviou.registro, "POST assinatura");

    const deNovo = await chamar("POST", "/assinatura");
    checar(deNovo.status === 409, `enviar de novo com o envio aberto → 409 (veio ${deNovo.status})`);

    const travadoDados = await chamar("PUT", "", { dados: dadosCompletos() });
    checar(travadoDados.status === 409, `salvar dados com o texto travado → 409 (veio ${travadoDados.status})`);
    const travadoTexto = await chamar("POST", "/redigir", { dados: dadosCompletos() });
    checar(travadoTexto.status === 409, `gerar texto com o texto travado → 409 (veio ${travadoTexto.status})`);
    const travadoEdicao = await chamar("PUT", "/documento", { documento: editado });
    checar(travadoEdicao.status === 409, `editar com o texto travado → 409 (veio ${travadoEdicao.status})`);
    const travadoPdf = await chamar("POST", "/pdf");
    checar(travadoPdf.status === 409, `regerar PDF com o texto travado → 409 (veio ${travadoPdf.status})`);

    const consultou = await chamar("GET", "/assinatura");
    const jsonConsultou = await lerJson(consultou);
    checar(consultou.status === 200 && jsonConsultou.registro?.status === "enviado", `consultar → 200, segue "enviado"`);

    const cancelou = await chamar("DELETE", "/assinatura");
    const jsonCancelou = await lerJson(cancelou);
    checar(cancelou.status === 200, `cancelar envio → 200 (veio ${cancelou.status}${jsonCancelou.erro ? `: ${jsonCancelou.erro}` : ""})`);
    checar(jsonCancelou.registro?.status === "pdf_gerado", `volta a "pdf_gerado" (veio ${jsonCancelou.registro?.status})`);
    checar(jsonCancelou.registro?.assinatura_status === "cancelado", "assinatura_status \"cancelado\"");

    const cancelouDeNovo = await chamar("DELETE", "/assinatura");
    checar(cancelouDeNovo.status === 409, `cancelar sem envio aberto → 409 (veio ${cancelouDeNovo.status})`);

    // ---------------------------- envio que a plataforma nao alcanca mais
    // O registro do envio corrompido (token ilegivel) prendia o contrato em
    // "enviado" para sempre. O token e estragado direto no banco, so neste
    // lead de teste; o provedor o recusa ANTES de qualquer chamada a
    // plataforma, entao nada sai para a iLoveAPI.
    const reenviou = await chamar("POST", "/assinatura");
    const jsonReenviou = await lerJson(reenviou);
    checar(
      reenviou.status === 200 && jsonReenviou.dryRun === true,
      `enviar de novo depois de cancelar (dry run) → 200 (veio ${reenviou.status}${jsonReenviou.erro ? `: ${jsonReenviou.erro}` : ""})`,
    );
    const { error: eToken } = await admin
      .from("contratos")
      .update({ assinatura_token: "registro-corrompido" })
      .eq("lead_id", id)
      .eq("status", "enviado");
    checar(!eToken, `token do envio estragado no banco para o teste${eToken ? `: ${eToken.message}` : ""}`);

    const consultouPerdido = await chamar("GET", "/assinatura");
    const jsonPerdido = await lerJson(consultouPerdido);
    if (consultouPerdido.status === 503) {
      aviso("o servidor não tem ILOVEAPI_PUBLIC_KEY: o caminho do envio inalcançável não foi exercitado");
    } else {
      checar(
        consultouPerdido.status === 409 && jsonPerdido.pedidoInexistente === true,
        `consultar envio com token ilegível → 409 com pedidoInexistente (veio ${consultouPerdido.status})`,
      );
      checar(/Cancelar envio/.test(jsonPerdido.erro ?? ""), `o recado aponta o “Cancelar envio”: ${jsonPerdido.erro}`);

      const destravou = await chamar("DELETE", "/assinatura");
      const jsonDestravou = await lerJson(destravou);
      checar(
        destravou.status === 200,
        `cancelar envio com token ilegível → 200 (veio ${destravou.status}${jsonDestravou.erro ? `: ${jsonDestravou.erro}` : ""})`,
      );
      checar(
        jsonDestravou.registro?.status === "pdf_gerado" && jsonDestravou.registro?.assinatura_status === "cancelado",
        `destravado: "pdf_gerado" com assinatura "cancelado" (veio ${jsonDestravou.registro?.status}/${jsonDestravou.registro?.assinatura_status})`,
      );
      semColunasInternas(jsonDestravou.registro, "DELETE assinatura inalcançável");
    }
  }

  // -------------------------------------------- pagamento "Personalizado"
  // O texto livre da Mel: com IA, ela interpreta e a clausula sai do codigo; a
  // interpretacao fica gravada NOS DADOS, e uma copia forjada vinda do
  // navegador e ignorada. Sem IA, a clausula sai bloqueada, com o texto dela.
  {
    const texto = "30% de entrada na assinatura para reservar a data e o restante até 10 dias antes do evento";
    const forjada = {
      textoFonte: texto,
      pendencias: [],
      grupos: [{ quantidade: 1, valorCentavos: 1, percentual: null, vencimento: "forjado", sinal: true, determinavel: true }],
    };
    const pag = { ...dadosCompletos(), pagamento: { ...pagamentoDoPreset("personalizado"), textoLivre: texto, interpretacao: forjada } };
    const r = await chamar("POST", "/redigir", { dados: pag });
    const j = await lerJson(r);
    checar(r.status === 200, `personalizado: gerar texto → 200 (veio ${r.status}${j.erro ? `: ${j.erro}` : ""})`);
    const interp = (j.registro as { dados?: DadosContrato } | undefined)?.dados?.pagamento?.interpretacao;
    const clausula = (j.registro?.documento?.clausulas ?? []).find((c: { id: string }) => c.id === "pagamento");
    checar(clausula?.origem === "ia", "personalizado: a cláusula de pagamento nasce como texto da IA (conferível)");
    checar(!JSON.stringify(j.registro?.documento ?? {}).includes("forjado"), "personalizado: a interpretação forjada no navegador foi ignorada");
    if (COM_IA) {
      checar(!!interp && interp.textoFonte === texto && interp.grupos.length >= 2, "com IA: interpretação gravada nos dados, com o texto de que saiu");
      checar((clausula?.problemas ?? []).length === 0, `com IA: parcelas somam o total (problemas: ${JSON.stringify(clausula?.problemas ?? [])})`);
      checar((clausula?.paragrafos ?? []).some((p: string) => p.includes("a título de sinal")), "com IA: a entrada virou sinal");
    } else {
      checar(!interp, "sem IA: nenhuma interpretação gravada");
      checar((clausula?.problemas ?? []).length > 0, "sem IA: a cláusula sai bloqueada até a Mel conferir");
    }
  }

  // -------------------------------------------------- excluir o lead limpa tudo
  const excluiu = await fetch(`${BASE}/api/admin/leads/${id}`, { method: "DELETE", headers: { Cookie: cookie } });
  checar(excluiu.status === 200, `excluir o lead → 200 (veio ${excluiu.status})`);
  checar((await arquivosNoBucket(id)).length === 0, "a pasta do lead no bucket contratos ficou vazia");
  const { data: linha } = await admin.from("contratos").select("lead_id").eq("lead_id", id).maybeSingle();
  checar(!linha, "a linha em contratos caiu junto (on delete cascade)");

  await limpar();

  if (falhas) {
    console.log(`\n\x1b[31m\x1b[1m${falhas} falha(s).\x1b[0m\n`);
    process.exit(1);
  }
  console.log("\n\x1b[32m\x1b[1mContrato aprovado.\x1b[0m\n");
}

async function limpar() {
  for (const leadId of criados) {
    const nomes = await arquivosNoBucket(leadId).catch(() => []);
    if (nomes.length) await admin.storage.from("contratos").remove(nomes.map((n) => `${leadId}/${n}`));
  }
  if (criados.length) await admin.from("leads").delete().in("id", criados);
  const { data } = await admin.auth.admin.listUsers();
  const temp = data?.users.find((u) => u.email === EMAIL_TEMP);
  if (temp) await admin.auth.admin.deleteUser(temp.id);
  ok("lead, arquivos e admin temporários removidos");
}

// So roda quando chamado como script: o teste importa `baseEhLocal` sem
// disparar o roteiro.
if (require.main === module) {
  main().catch(async (e) => {
    console.error(e);
    await limpar();
    process.exit(1);
  });
}
