/**
 * Teste ponta a ponta do fluxo publico, batendo nas rotas HTTP de verdade.
 *
 *   npm run dev                 # em outro terminal
 *   npm run e2e:formulario
 *
 * Cobre os criterios de aceite do PRD que o formulario precisa cumprir:
 * RF-02 (lead nasce antes da 2a pergunta), RF-04 (autosave e retomada),
 * RF-05 (ramificacao do making of) e RF-07 (submit muda o status).
 *
 * Roda nas 4 categorias, com making_of "Sim" e "Nao", e deixa os leads no
 * banco para a revisao no painel.
 */
import { passosVisiveis, resolverTemplateId } from "@/lib/form/engine";
import { CATEGORIAS, type Categoria, type Passo, type Respostas } from "@/lib/form/types";

const BASE = process.env.APP_URL ?? "http://localhost:3000";

let falhas = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  falhas++;
};
const checar = (cond: boolean, m: string) => (cond ? ok(m) : erro(m));

/**
 * O rate limit e 10 criacoes por minuto por IP. Rodar este teste duas vezes
 * seguidas estoura o limite, e sem esta checagem o resultado vira uma lista de
 * falhas sem relacao aparente com a causa.
 */
let avisouLimite = false;
function ehRateLimit(status: number): boolean {
  if (status !== 429) return false;
  if (!avisouLimite) {
    avisouLimite = true;
    console.log(
      "\n  \x1b[33m! rate limit atingido (10 criações/min por IP).\x1b[0m\n" +
        "    Não é bug: é o limite funcionando. Espere 1 minuto e rode de novo.\n",
    );
  }
  return true;
}

/** Respostas de exemplo por tipo de pergunta, derivadas do proprio arvore.json. */
function responder(passo: Passo, makingOf: "Sim" | "Não", idade: string): string {
  if (passo.id === "making_of") return makingOf;
  if (passo.id === "entrega") return "Em tempo real";
  if (passo.id === "contato_email") return "lead.teste@example.com";
  if (passo.id === "contato_whatsapp") return "(19) 99999-8888";
  if (passo.id === "idade") return idade;

  switch (passo.tipo) {
    case "data":
      return "2027-03-14";
    case "hora":
      return "19:30";
    case "numero":
      return String(typeof passo.min === "number" ? passo.min : 1);
    case "texto":
      if (passo.id === "nome") return "Lúcia Teste";
      if (passo.id === "noivos") return "Ana & João";
      if (passo.id === "debutante") return "Maria Eduarda";
      if (passo.id === "aniversariante") return "João Vitor";
      if (passo.id === "empresa") return "Acme Tecnologia Ltda";
      if (passo.id === "tipo_evento") return "Confraternização de fim de ano";
      return `Local de ${passo.id}`;
    default:
      return "x";
  }
}

async function json(r: Response) {
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function rodarCategoria(categoria: Categoria, makingOf: "Sim" | "Não", idade = "30") {
  const temIdade = passosVisiveis(categoria, {}).some((p) => p.id === "idade");
  const sufixo = temIdade ? `idade = ${idade}` : `making_of = ${makingOf}`;
  console.log(`\n\x1b[1m${categoria} (${sufixo})\x1b[0m`);

  // --- RF-02: o lead nasce na escolha da categoria ------------------------
  const criado = await json(
    await fetch(`${BASE}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria }),
    }),
  );

  if (ehRateLimit(criado.status)) return null;
  if (criado.status !== 201 || !criado.body?.id) {
    erro(`criacao falhou (HTTP ${criado.status}): ${JSON.stringify(criado.body)}`);
    return null;
  }
  const id: string = criado.body.id;
  ok(`lead criado antes da 2a pergunta (RF-02) — ${id.slice(0, 8)}`);

  const inicial = await json(await fetch(`${BASE}/api/leads/${id}`));
  checar(inicial.body?.status === "incompleto", "nasce com status incompleto");

  // --- RF-04: autosave passo a passo -------------------------------------
  const respostas: Respostas = {};
  let passos = passosVisiveis(categoria, respostas);

  for (let i = 0; i < passos.length; i++) {
    const passo = passos[i];
    respostas[passo.id] = responder(passo, makingOf, idade);

    // A ramificacao muda a lista de passos assim que making_of e respondido.
    passos = passosVisiveis(categoria, respostas);
    const proximo = passos[passos.findIndex((p) => p.id === passo.id) + 1];

    const r = await json(
      await fetch(`${BASE}/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, respostas, passo_atual: proximo?.id }),
      }),
    );
    if (r.status !== 200) {
      erro(`autosave falhou no passo "${passo.id}" (HTTP ${r.status})`);
      return null;
    }

    // --- RF-04: retomada no meio do preenchimento ------------------------
    if (i === 1) {
      const retomada = await json(await fetch(`${BASE}/api/leads/${id}`));
      checar(
        retomada.body?.passo_atual === proximo?.id,
        `retomada volta no passo certo (${proximo?.id})`,
      );
      checar(
        Object.keys(retomada.body?.respostas ?? {}).length === i + 1,
        "respostas parciais preservadas",
      );
    }
  }

  ok(`${passos.length} passos salvos`);

  // --- RF-05: ramificacao do making of -----------------------------------
  const temMakingOf = passosVisiveis(categoria, {}).some((p) => p.id === "making_of");
  if (temMakingOf) {
    const depois = await json(await fetch(`${BASE}/api/leads/${id}`));
    const chaves = Object.keys(depois.body?.respostas ?? {});
    if (makingOf === "Sim") {
      checar(chaves.includes("local_making_of"), "making_of = Sim guarda o local (RF-05)");
    } else {
      checar(
        !chaves.includes("local_making_of"),
        "making_of = Não não deixa local órfão no jsonb (RF-05)",
      );
    }
  }

  // --- RF-07: submit ------------------------------------------------------
  const submit = await json(await fetch(`${BASE}/api/leads/${id}/submit`, { method: "POST" }));
  checar(submit.status === 200, `submit aceito (HTTP ${submit.status})`);

  const final = await json(await fetch(`${BASE}/api/leads/${id}`));
  checar(final.body?.status === "aguardando_revisao", "status vira aguardando_revisao (RF-07)");

  // Formulario fechado depois do submit: o autosave publico nao pode mais editar.
  const depoisDoSubmit = await json(
    await fetch(`${BASE}/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respostas: { nome: "INVASOR" } }),
    }),
  );
  checar(depoisDoSubmit.status === 409, "autosave recusado após o submit (HTTP 409)");

  return id;
}

async function main() {
  console.log("\n\x1b[1mTeste ponta a ponta — formulário público\x1b[0m");
  console.log(`base: ${BASE}`);

  const ids: string[] = [];

  for (const categoria of CATEGORIAS) {
    const temRamificacao = passosVisiveis(categoria, {}).some((p) => p.id === "making_of");
    const temIdade = passosVisiveis(categoria, {}).some((p) => p.id === "idade");

    // Categorias com making of rodam nos dois caminhos; aniversario roda nas
    // duas idades, para exercitar as duas artes.
    const casos: { makingOf: "Sim" | "Não"; idade: string }[] = temIdade
      ? [
          { makingOf: "Sim", idade: "8" },
          { makingOf: "Sim", idade: "30" },
        ]
      : temRamificacao
        ? [
            { makingOf: "Sim", idade: "30" },
            { makingOf: "Não", idade: "30" },
          ]
        : [{ makingOf: "Sim", idade: "30" }];

    for (const caso of casos) {
      const id = await rodarCategoria(categoria, caso.makingOf, caso.idade);
      if (id) ids.push(id);

      if (temIdade) {
        const esperada = Number(caso.idade) <= 14 ? "aniversario_infantil" : "aniversario_adulto";
        checar(
          resolverTemplateId(categoria, { idade: caso.idade }) === esperada,
          `idade ${caso.idade} resolve para ${esperada}`,
        );
      }
    }
  }

  // --- validacao de entrada ------------------------------------------------
  console.log("\n\x1b[1mvalidação de entrada\x1b[0m");

  const categoriaInvalida = await json(
    await fetch(`${BASE}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria: "formatura" }),
    }),
  );
  if (!ehRateLimit(categoriaInvalida.status))
    checar(categoriaInvalida.status === 400, "categoria fora do arvore.json recusada (400)");

  const idInvalido = await json(await fetch(`${BASE}/api/leads/nao-e-uuid`));
  checar(idInvalido.status === 404, "id malformado recusado (404)");

  const submitVazio = await json(
    await fetch(`${BASE}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  if (!ehRateLimit(submitVazio.status))
    checar(submitVazio.status === 400, "corpo vazio recusado (400)");

  // Chave que nao existe no arvore.json nao pode entrar no jsonb.
  const novo = await json(
    await fetch(`${BASE}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria: "aniversario" }),
    }),
  );
  await fetch(`${BASE}/api/leads/${novo.body.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ respostas: { nome: "Teste", campo_injetado: "xxx" } }),
  });
  const checagem = await json(await fetch(`${BASE}/api/leads/${novo.body.id}`));
  checar(
    !("campo_injetado" in (checagem.body?.respostas ?? {})),
    "chave fora do arvore.json bloqueada no jsonb",
  );
  ids.push(novo.body.id);

  // --- protecao do admin ---------------------------------------------------
  console.log("\n\x1b[1mproteção do painel\x1b[0m");
  const semSessao = await fetch(`${BASE}/api/admin/leads/${ids[0]}/gerar-pdf`, { method: "POST" });
  checar(semSessao.status === 401, `rota de admin sem sessão recusada (${semSessao.status})`);

  const paginaAdmin = await fetch(`${BASE}/admin`, { redirect: "manual" });
  checar(
    paginaAdmin.status === 307 || paginaAdmin.status === 302,
    `/admin sem sessão redireciona para o login (${paginaAdmin.status})`,
  );

  console.log(`\n${ids.length} leads criados no banco.`);
  if (avisouLimite) {
    console.log(
      "\n\x1b[33m\x1b[1mResultado incompleto: o rate limit cortou parte da execução.\x1b[0m\n" +
        "Espere 1 minuto e rode de novo para um resultado limpo.\n",
    );
    process.exit(1);
  }
  if (falhas) {
    console.log(`\n\x1b[31m\x1b[1m${falhas} verificação(ões) falharam.\x1b[0m\n`);
    process.exit(1);
  }
  console.log("\n\x1b[32m\x1b[1mFluxo público aprovado.\x1b[0m\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
