// Renderizacao (SSR) dos componentes da secao de contrato: o que so aparece
// no HTML -- classes de layout do celular, rotulos, links, qual campo e
// textarea. Complementa os testes puros de estado.ts, campos.ts e reais.ts,
// que provam as DECISOES; aqui se prova que a tela as usa.
//
// Por que um processo filho: a suite roda com `--conditions=react-server`
// (as rotas precisam), e nessa condicao o `react` nao tem hooks e o
// `react-dom/server` se recusa a carregar. Rodando assim, este arquivo so
// relanca a si mesmo sem a condicao e confere que o filho passou; no filho,
// os testes de verdade rodam. Tudo FICTICIO: nomes, CPFs (so passam no
// digito verificador), e-mails @exemplo e enderecos inventados.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import * as React from "react";

const ARQUIVO = path.resolve("components/admin/contrato/ui.test.ts");
const SO_SERVIDOR = typeof (React as { useState?: unknown }).useState !== "function";

if (SO_SERVIDOR) {
  test("renderizacao da secao de contrato (processo filho, sem react-server)", () => {
    assert.ok(existsSync(ARQUIVO), `rode a partir da raiz do repositorio (nao achei ${ARQUIVO})`);
    assert.ok(!process.env.CONTRATO_UI_FILHO, "o filho tambem caiu na condicao react-server");
    // Sem o NODE_TEST_CONTEXT herdado: com ele, o `node --test` do filho se
    // acha parte deste runner e sai sem rodar nada (e "passa").
    const env: NodeJS.ProcessEnv = { ...process.env, CONTRATO_UI_FILHO: "1" };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", ARQUIVO], {
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    const saida = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, saida);
    // Prova de que o filho rodou os testes de verdade, e nao zero testes.
    const passaram = Number(/ℹ pass (\d+)/.exec(saida)?.[1] ?? 0);
    assert.ok(passaram >= 10, `o filho rodou ${passaram} testes:\n${saida}`);
  });
} else {
  // Suite assincrona: os componentes so sao importados aqui, fora da condicao
  // react-server (importados no topo, quebrariam o processo pai).
  describe("renderização (SSR) da seção de contrato", registrarTestes);
}

async function registrarTestes() {
  // O JSX dos componentes sai no modo classico (o tsconfig do Next e
  // "preserve"): eles precisam do React global.
  (globalThis as unknown as { React: typeof React }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { EditorClausulas } = await import("./EditorClausulas");
  const { ListaAvisos } = await import("./ListaAvisos");
  const { PainelAssinatura } = await import("./PainelAssinatura");
  const { FormPagamento } = await import("./FormPagamento");
  const { FormEvento } = await import("./FormEvento");
  const { FormQuemAssina } = await import("./FormQuemAssina");
  const { SecaoContrato } = await import("./SecaoContrato");
  const { VisualizadorPaginado } = await import("../PreviaProposta");
  const { ID, idClausula } = await import("./campos");
  const { PREFIXO_NAO_INCORPORADO } = await import("./estado");
  const { dadosContratoSchema } = await import("@/lib/contrato/tipos");
  const { adicionalDoCatalogo, novoAdicional, pacoteDoCatalogo } = await import("@/lib/contrato/catalogo");
  const { pagamentoDoPreset } = await import("@/lib/contrato/pagamento");
  const { montarContrato } = await import("@/lib/contrato/montar");
  type Tipos = typeof import("@/lib/contrato/tipos");
  type RegistroContrato = import("@/lib/contrato/tipos").RegistroContrato;
  type DadosContrato = ReturnType<Tipos["dadosContratoSchema"]["parse"]>;
  type Lead = import("@/lib/form/types").Lead;

  const h = React.createElement;
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);
  const roteador = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  const comRoteador = (el: React.ReactElement) =>
    html(h(AppRouterContext.Provider, { value: roteador as never }, el));
  const nada = () => {};
  const HOJE = "2026-09-30";

  /** O elemento `tag` que abre em `inicio`, inteiro (conta os aninhados). */
  function elementoInteiro(markup: string, inicio: number, tag: string): string {
    const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
    re.lastIndex = inicio;
    let nivel = 0;
    for (let m = re.exec(markup); m; m = re.exec(markup)) {
      nivel += m[0].startsWith("</") ? -1 : 1;
      if (nivel === 0) return markup.slice(inicio, m.index + m[0].length);
    }
    assert.fail(`<${tag}> sem fechamento`);
  }

  /** O trecho do HTML de uma clausula (section id=...), ate o fim dela. */
  function secaoDaClausula(markup: string, id: string): string {
    const i = markup.indexOf(`id="${idClausula(id)}"`);
    assert.ok(i >= 0, `sem a clausula ${id}`);
    return markup.slice(i, markup.indexOf("</section>", i));
  }

  function lead(categoria: Lead["categoria"], respostas: Lead["respostas"]): Lead {
    return {
      id: "00000000-0000-4000-8000-00000000f004",
      created_at: "2026-09-01T12:00:00Z",
      updated_at: "2026-09-01T12:00:00Z",
      categoria,
      status: "aguardando_revisao",
      respostas,
      passo_atual: null,
      nome_display: null,
      data_evento: null,
      email: null,
      whatsapp: null,
      pdf_url: null,
      pdf_gerado_em: null,
      enviado_em: null,
      lembrete_7_em: null,
      lembrete_30_em: null,
    };
  }

  const LEAD_CASAMENTO = lead("casamento", {
    nome: "Cerimonialista Fictícia",
    noivos: "Clara & Davi",
    data: "2027-08-14",
    horario: "17:00",
    contato_email: "clara@exemplo.com.br",
    contato_whatsapp: "19900000004",
  });

  function dadosCasamento(): DadosContrato {
    const p = pacoteDoCatalogo("casamento", "Pacote Principal");
    const noiva = adicionalDoCatalogo("casamento", "casamento.making_of_noiva");
    assert.ok(p && noiva);
    return dadosContratoSchema.parse({
      contratante: {
        tipo: "pf",
        pf: {
          nome: "Clara Fictícia Souza",
          genero: "feminino",
          cpf: "12345678909",
          email: "clara@exemplo.com.br",
          endereco: {
            logradouro: "Rua dos Ipês",
            numero: "45",
            bairro: "Vila Teste",
            cidade: "Campinas",
            uf: "SP",
          },
        },
      },
      anuente: {
        ativo: true,
        nome: "Davi Fictício Lima",
        genero: "masculino",
        cpf: "98765432100",
        email: "davi@exemplo.com.br",
        papel: "noivo",
      },
      evento: {
        data: "2027-08-14",
        horarioInicio: "17:00",
        homenageado: "Clara e Davi",
        locais: [{ rotulo: "Local da cerimônia e recepção", endereco: "Chácara Fictícia, Estrada do Teste, 10, Campinas/SP" }],
      },
      servico: {
        tabela: "2027",
        pacote: p.nome,
        valorPacote: 148500,
        escopo: p.escopo,
        adicionais: [novoAdicional(noiva, p.nome)],
      },
      pagamento: pagamentoDoPreset("30/70"),
    });
  }

  function registro(status: RegistroContrato["status"], extra: Partial<RegistroContrato> = {}): RegistroContrato {
    const dados = dadosCasamento();
    const { documento, avisos } = montarContrato(dados, {
      categoria: "casamento",
      templateId: "casamento",
      idadeHomenageado: null,
      hojeISO: HOJE,
    });
    const comPdf = status === "pdf_gerado" || status === "enviado" || status === "assinado";
    return {
      lead_id: LEAD_CASAMENTO.id,
      created_at: "2026-09-20T12:00:00Z",
      updated_at: "2026-09-20T12:00:00Z",
      status,
      dados,
      documento: status === "rascunho" ? null : documento,
      avisos,
      redigido_em: status === "rascunho" ? null : "2026-09-20T12:00:00Z",
      revisado_em: null,
      pdf_gerado_em: comPdf ? "2026-09-20T12:10:00Z" : null,
      pdf_sha256: null,
      assinatura_provedor: null,
      assinatura_status: null,
      assinatura_signatarios: null,
      assinatura_enviada_em: null,
      assinatura_atualizada_em: null,
      assinado_em: null,
      ...extra,
    };
  }

  const FLAGS = {
    hojeISO: HOJE,
    iaDisponivel: true,
    assinaturaConfigurada: true,
    assinaturaDryRun: false,
    statusLead: "aguardando_revisao" as const,
  };

  // ------------------------------------------------------------- UI-01 --

  test("titulo da clausula tem a linha inteira no celular; selo e botoes descem", () => {
    const r = registro("redigido");
    assert.ok(r.documento);
    const doc = {
      ...r.documento,
      clausulas: r.documento.clausulas.map((c, i) => (i === 5 ? { ...c, origem: "editada" as const } : c)),
    };
    const markup = html(
      h(EditorClausulas, { documento: doc, travado: false, ocupado: false, salvando: false, onSalvar: async () => true }),
    );
    const titulos = [...markup.matchAll(/<h5 class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
    assert.ok(titulos.length >= doc.clausulas.length);
    for (const cls of titulos) {
      assert.ok(cls.includes("basis-full"), `titulo sem basis-full: ${cls.join(" ")}`);
      assert.ok(cls.includes("sm:basis-auto") && cls.includes("sm:grow"), "do sm para cima volta a dividir a linha");
      // `flex-1` sem breakpoint (base 0) era o que espremia o titulo a 5px.
      assert.ok(!cls.includes("flex-1"), "flex-1 no celular espreme o titulo");
    }
    assert.match(secaoDaClausula(markup, doc.clausulas[5].id), /Editada/);
  });

  // ------------------------------------------------------------- UI-04 --

  test("o recado de salvar uma clausula aparece dentro dela, e nao no topo do texto", () => {
    const r = registro("redigido");
    assert.ok(r.documento);
    const alvo = r.documento.clausulas[7].id;
    const markup = html(
      h(EditorClausulas, {
        documento: r.documento,
        travado: false,
        ocupado: false,
        salvando: false,
        onSalvar: async () => true,
        recadoDaClausula: (id: string) => (id === alvo ? h("p", null, "Texto salvo.") : null),
      }),
    );
    assert.match(secaoDaClausula(markup, alvo), /Texto salvo\./);
    assert.equal(markup.split("Texto salvo.").length - 1, 1, "so na clausula salva");
  });

  test("progresso e recado da extracao ficam logo abaixo do botao Preencher com IA", () => {
    const d = dadosCasamento();
    const markup = html(
      h(FormQuemAssina, {
        categoria: "casamento",
        homenageado: "Clara e Davi",
        menor: false,
        contratante: d.contratante,
        onContratante: nada,
        anuente: d.anuente,
        onAnuente: nada,
        iaDisponivel: true,
        extraindo: false,
        ocupado: false,
        onExtrair: async () => true,
        observacoesExtracao: [],
        forcarValidacao: false,
        retornoExtracao: h("p", null, "RETORNO-DA-EXTRACAO"),
      }),
    );
    const botao = markup.indexOf("Preencher com IA");
    const retorno = markup.indexOf("RETORNO-DA-EXTRACAO");
    const depois = markup.indexOf("Quem contrata é");
    assert.ok(botao >= 0 && retorno > botao, "o retorno vem depois do botao");
    assert.ok(depois > retorno, "e antes do resto do formulario (endereco, anuente)");
  });

  // ------------------------------------------------------------- UI-03 --

  test("o que ficou fora do texto e 'Redação da IA', com link para a secao citada", () => {
    const fora = {
      origem: "ia" as const,
      gravidade: "atencao" as const,
      clausula: "condicoes_especiais",
      texto: `${PREFIXO_NAO_INCORPORADO}Pagamento em 3 vezes: ajuste as parcelas na seção Pagamento.`,
    };
    const revisao = {
      origem: "ia" as const,
      gravidade: "atencao" as const,
      clausula: "pagamento",
      texto: "A reserva da data depende do sinal integral.",
    };
    const markup = html(
      h(ListaAvisos, {
        avisos: [fora, revisao],
        tituloDaClausula: (id: string) => (id === "condicoes_especiais" ? "a Cláusula 15" : "a Cláusula 7"),
        onIrParaClausula: nada,
        onIrParaSecao: nada,
      }),
    );
    const itens = markup.split("<li").slice(1);
    const liFora = itens.find((i) => i.includes("fora do texto"));
    const liRevisao = itens.find((i) => i.includes("reserva da data"));
    assert.ok(liFora && liRevisao);
    assert.match(liFora, /Redação da IA/);
    assert.match(liFora, /ir para a seção Pagamento/);
    assert.ok(!/Cláusula 15/.test(liFora), "nao leva a clausula onde o pedido NAO entrou");
    assert.match(liRevisao, /Revisão da IA/);
    assert.match(liRevisao, /ver a Cláusula 7/);
  });

  test("os blocos do formulario tem o id para onde o link do aviso rola", () => {
    const markup = comRoteador(h(SecaoContrato, { lead: LEAD_CASAMENTO, registro: registro("rascunho"), ...FLAGS }));
    for (const id of [ID.blocoQuem, ID.blocoEvento, ID.blocoServico, ID.blocoPagamento]) {
      assert.ok(markup.includes(`id="${id}"`), `sem o bloco ${id}`);
    }
  });

  // ------------------------------------------------------------- UI-05 --

  function painel(reg: RegistroContrato, extra: Record<string, unknown> = {}) {
    return html(
      h(PainelAssinatura, {
        registro: reg,
        documento: reg.documento,
        urlArquivo: "/api/admin/leads/x/contrato/arquivo",
        statusLead: "aguardando_revisao",
        assinaturaConfigurada: true,
        assinaturaDryRun: false,
        bloqueioEnvio: null,
        acao: null,
        ocupado: false,
        onEnviar: async () => true,
        onConsultar: nada,
        onCancelar: nada,
        onMoverLead: nada,
        ...extra,
      }),
    );
  }

  test("depois de cancelar o envio o painel fica neutro; recusado e expirado ficam em ambar", () => {
    const cancelado = painel(registro("pdf_gerado", { assinatura_status: "cancelado" }));
    assert.match(cancelado, /Envio anterior cancelado\./);
    assert.ok(!/Corrija/.test(cancelado), "cancelar de proposito nao e erro a corrigir");
    assert.ok(!/amber/.test(cancelado), "sem ambar");

    const recusado = painel(registro("pdf_gerado", { assinatura_status: "recusado" }));
    assert.match(recusado, /recusado/);
    assert.match(recusado, /Corrija/);
    assert.match(recusado, /amber/);
    assert.match(painel(registro("pdf_gerado", { assinatura_status: "expirado" })), /expirou/);
  });

  test("um aviso so de dry run em cada estado", () => {
    const antes = painel(registro("pdf_gerado"), { assinaturaDryRun: true });
    assert.equal(antes.split("ASSINATURA_DRY_RUN").length - 1, 1);
    const depois = painel(
      registro("enviado", {
        assinatura_provedor: "dry-run",
        assinatura_status: "enviado",
        assinatura_enviada_em: "2026-09-21T10:00:00Z",
      }),
      { assinaturaDryRun: true },
    );
    assert.equal(depois.split("ASSINATURA_DRY_RUN").length - 1, 1);
  });

  // -------------------------------------------------------------- B2 --

  test("com bloqueio (dados nao salvos) o envio fica desabilitado e diz por que", () => {
    const markup = painel(registro("pdf_gerado"), { bloqueioEnvio: "Há alterações não salvas nos dados." });
    const botao = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Enviar para assinatura/.exec(markup)?.[0] ?? "";
    assert.match(botao, /\bdisabled=""/);
    assert.match(markup, /Há alterações não salvas nos dados\./);
  });

  // ------------------------------------------------------------ pagamento --

  const renderPagamento = (pagamento: ReturnType<typeof pagamentoDoPreset>, total = 247000) =>
    html(h(FormPagamento, { pagamento, onPagamento: nada, total, dataEvento: "2027-08-14", hojeISO: HOJE }));

  test("pagamento: quatro opcoes e nenhum editor de parcela nos modelos prontos", () => {
    const markup = renderPagamento(pagamentoDoPreset("30/70"));
    for (const rotulo of ["30% + 70%", "Metade-metade", "Já pago", "Personalizado"]) {
      assert.ok(markup.includes(rotulo), rotulo);
    }
    assert.ok(!markup.includes("15% + 15% + 70%") && !markup.includes("Tudo na assinatura"), "opcoes antigas fora do painel");
    // Resumo so de leitura: sem select de vencimento, sem campo de percentual.
    assert.ok(!/<select/.test(markup), "sem select");
    assert.ok(!/Adicionar parcela/.test(markup), "sem adicionar parcela");
    assert.ok(markup.includes("R$ 741,00") && markup.includes("R$ 1.729,00"), "valores calculados no resumo");
    assert.match(markup, /aria-pressed="true"[^>]*>30% \+ 70%/);
  });

  test("pagamento personalizado: um campo de texto e, com leitura da IA, as parcelas e a soma", () => {
    const vazio = renderPagamento(pagamentoDoPreset("personalizado"));
    assert.match(vazio, /<textarea[^>]*id="[^"]*-pg-texto"/);
    assert.ok(!vazio.includes("Como a IA entendeu"));

    const texto = "30% de entrada e o resto em 2 vezes";
    const lido = renderPagamento({
      ...pagamentoDoPreset("personalizado"),
      textoLivre: texto,
      interpretacao: {
        textoFonte: texto,
        pendencias: [],
        grupos: [
          { quantidade: 1, valorCentavos: null, percentual: 30, vencimento: "na assinatura deste contrato", sinal: true, determinavel: true },
          { quantidade: 2, valorCentavos: null, percentual: 35, vencimento: "em 10 de janeiro e 10 de fevereiro de 2027", sinal: false, determinavel: true },
        ],
      },
    });
    assert.ok(lido.includes("Como a IA entendeu"));
    assert.ok(lido.includes("Soma das parcelas: R$ 2.470,00 de R$ 2.470,00"));

    const mudado = renderPagamento({
      ...pagamentoDoPreset("personalizado"),
      textoLivre: `${texto}!`,
      interpretacao: { textoFonte: texto, pendencias: [], grupos: [] },
    });
    assert.ok(mudado.includes("O texto mudou depois da última leitura da IA"));
  });

  // ------------------------------------------------------ UI-08 e ensaio --

  test("local do making of e textarea, como os locais do evento", () => {
    const d = dadosCasamento();
    const markup = html(
      h(FormEvento, {
        categoria: "casamento",
        evento: d.evento,
        onEvento: nada,
        temMakingOf: true,
        temEnsaio: false,
        hojeISO: HOJE,
      }),
    );
    assert.match(markup, /<textarea[^>]*id="ct-ev-mo-local"/);
    assert.ok(!/<input[^>]*id="ct-ev-mo-local"/.test(markup));
    // Sem ensaio no escopo e sem nada preenchido: os campos do ensaio nem aparecem.
    assert.ok(!markup.includes(ID.evEnsaioData));
  });

  test("com ensaio no escopo aparecem data, horario e local do ensaio, 'A definir' por padrao", () => {
    const d = dadosCasamento();
    const markup = html(
      h(FormEvento, {
        categoria: "debutante",
        evento: d.evento,
        onEvento: nada,
        temMakingOf: true,
        temEnsaio: true,
        hojeISO: HOJE,
      }),
    );
    assert.match(markup, new RegExp(`<input[^>]*type="date"[^>]*id="${ID.evEnsaioData}"|<input[^>]*id="${ID.evEnsaioData}"[^>]*type="date"`));
    assert.match(markup, new RegExp(`<input[^>]*id="${ID.evEnsaioHorario}"[^>]*type="time"|<input[^>]*type="time"[^>]*id="${ID.evEnsaioHorario}"`));
    assert.match(markup, new RegExp(`<textarea[^>]*id="${ID.evEnsaioLocal}"[^>]*placeholder="A definir"|<textarea[^>]*placeholder="A definir"[^>]*id="${ID.evEnsaioLocal}"`));
    assert.match(markup, /Ensaio fotográfico/);

    const depois = html(
      h(FormEvento, {
        categoria: "debutante",
        evento: { ...d.evento, ensaioData: "2027-09-01" },
        onEvento: nada,
        temMakingOf: false,
        temEnsaio: true,
        hojeISO: HOJE,
      }),
    );
    assert.match(depois, /é depois do evento/);
  });

  test("debutante no Pacote Luxo: a secao mostra os campos do ensaio", () => {
    const luxo = pacoteDoCatalogo("debutante", "Pacote Luxo");
    assert.ok(luxo && luxo.escopo.minutosEnsaio > 0);
    const deb = lead("debutante", { debutante: "Beatriz Fictícia", data: "2027-05-15", horario: "20:00" });
    const base = dadosCasamento();
    const dados = dadosContratoSchema.parse({
      ...base,
      anuente: { ativo: false },
      evento: { ...base.evento, homenageado: "Beatriz Fictícia", data: "2027-05-15" },
      servico: { tabela: "2027", pacote: luxo.nome, valorPacote: 300000, escopo: luxo.escopo, adicionais: [] },
    });
    const reg: RegistroContrato = { ...registro("rascunho"), lead_id: deb.id, dados };
    const markup = comRoteador(h(SecaoContrato, { lead: deb, registro: reg, ...FLAGS }));
    assert.ok(markup.includes(`id="${ID.evEnsaioData}"`));
    assert.ok(markup.includes(`id="${ID.evEnsaioHorario}"`));
    assert.ok(markup.includes(`id="${ID.evEnsaioLocal}"`));
  });

  // ------------------------------------------------------------- UI-09 --

  test("com o PDF gerado o formulario fica recolhido em 'Ver e editar os dados do contrato'", () => {
    const markup = comRoteador(h(SecaoContrato, { lead: LEAD_CASAMENTO, registro: registro("pdf_gerado"), ...FLAGS }));
    const i = markup.indexOf("<details");
    assert.ok(i >= 0, "sem <details>");
    const detalhes = elementoInteiro(markup, i, "details");
    assert.match(detalhes, /^<details[^>]*><summary[^>]*>Ver e editar os dados do contrato<\/summary>/);
    assert.ok(!/^<details[^>]*\bopen\b/.test(detalhes), "fechado sem alteracao nem pendencia");
    for (const id of [ID.blocoQuem, ID.blocoEvento, ID.blocoServico, ID.blocoPagamento]) {
      assert.ok(detalhes.includes(`id="${id}"`), `o bloco ${id} esta dentro dele`);
    }
    // Os botoes de salvar e gerar continuam fora, a vista.
    assert.ok(markup.indexOf("Salvar rascunho") > i + detalhes.length);

    const semPdf = comRoteador(h(SecaoContrato, { lead: LEAD_CASAMENTO, registro: registro("redigido"), ...FLAGS }));
    assert.ok(!semPdf.includes("Ver e editar os dados do contrato"), "antes do PDF o formulario fica aberto");
  });

  test("na previa do celular ha 'Abrir PDF em tela cheia' para a mesma URL, em outra aba", () => {
    const url = "/api/admin/leads/x/contrato/arquivo?tipo=rascunho&v=1";
    const markup = html(h(VisualizadorPaginado, { url, documento: "contrato" }));
    const link = /<a [^>]*>(?:(?!<\/a>)[\s\S])*Abrir PDF em tela cheia/.exec(markup)?.[0] ?? "";
    assert.ok(link, "sem o link");
    assert.match(link, /href="\/api\/admin\/leads\/x\/contrato\/arquivo\?tipo=rascunho&amp;v=1"/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
  });
}
