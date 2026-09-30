/**
 * Verificacao offline do contrato: monta e renderiza, sem Supabase, sem IA e
 * sem rede, um contrato por ARTE x PACOTE mais os casos que mudam o texto
 * (pessoa juridica, anuente, tempo real, 15/15/70, quitado, making of a
 * definir, adicionais variados, condicoes especiais, tabela antiga).
 *
 *   npm run contrato:verificar
 *
 * Os PDFs (e o texto corrido de cada um) ficam em .contrato-verificacao/ para
 * leitura humana. Tudo FICTICIO: nomes, enderecos e e-mails inventados; CPFs e
 * CNPJs gerados so para passar no digito verificador. Nunca copiar dado de
 * contrato real para ca -- esta pasta e o texto impresso no terminal saem do
 * computador em print, em PR, em conversa.
 *
 * O que falha o script (e por que cada item esta aqui):
 * - `faltantes` nao vazio num cenario completo: a montagem recusaria na tela;
 * - `validarDocumento` com problema, ou clausula da IA com problema: o PDF
 *   seria bloqueado;
 * - numeracao com buraco, id repetido, remissao para clausula inexistente, ou
 *   "CLÁUSULA N" do PDF fora de sequencia: foi assim que um contrato antigo
 *   saiu com duas clausulas 13;
 * - "{{", "undefined", "NaN", "null", espaco duplo: sobra de template ou
 *   conta que deu errado, impressa num documento juridico;
 * - PDF que nao reabre, com mais de 8 paginas ou acima de 300 kB;
 * - campo de assinatura fora da pagina, fora da ultima pagina, ou faltando
 *   para alguem que assina: a plataforma poria a assinatura no lugar errado;
 * - dado pessoal visivel no que iria para a IA (decisao travada 3).
 *
 * A flag --conditions=react-server (ver package.json) faz o "server-only"
 * resolver para um modulo vazio, permitindo importar o pdf.ts fora do Next.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { TEMPLATES, type Categoria, type TemplateId } from "@/lib/form/types";
import { precoPacote, catalogoDaArte, adicionalDoCatalogo, novoAdicional, ADICIONAL_LIVRE, ADICIONAL_LOCOMOCAO, PACOTE_PERSONALIZADO } from "@/lib/contrato/catalogo";
import { TABELAS_PRECO, type TabelaPreco } from "@/lib/pdf/precos";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import { formatarReais } from "@/lib/contrato/extenso";
import { faltantes, montarContrato, totalContrato, type ContextoMontagem } from "@/lib/contrato/montar";
import { textoCorrido, textoResolvido, validarDocumento } from "@/lib/contrato/validar";
import { anonimizar, anonimizarTexto, dadosPessoaisNoTexto, resumoParaIa } from "@/lib/contrato/anonimizar";
import { GEOMETRIA_CONTRATO, renderizarContrato } from "@/lib/contrato/pdf";
import { dadosContratoSchema, type Adicional, type DadosContrato, type DocumentoContrato } from "@/lib/contrato/tipos";

// ---------------------------------------------------------------- fixtures --

/** "Hoje" fixo: o script e deterministico (mesmos PDFs, byte a byte, a cada execucao). */
const HOJE = "2026-09-29";
const AGORA = new Date("2026-09-29T12:00:00-03:00");
const DATA_EVENTO = "2027-03-20";

const LIMITE_PAGINAS = 8;
const LIMITE_BYTES = 300 * 1024;

// Ficticios, gerados para o digito verificador bater. Nao sao de ninguem.
const CPF_CONTRATANTE = "41827365080";
const CPF_ANUENTE = "60291538460";
const CPF_REPRESENTANTE = "73504612916";
const CPF_ANIVERSARIANTE = "28159473079";
const CNPJ_EMPRESA = "47291538000166";

const HOMENAGEADO: Record<TemplateId, string> = {
  casamento: "Helena e Rafael",
  debutante: "Luíza Vasconcelos",
  aniversario_infantil: "Theo",
  aniversario_adulto: "Beatriz",
  corporativo: "Vértice Soluções em Eventos",
};

const IDADE: Record<TemplateId, number | null> = {
  casamento: null,
  debutante: 15,
  aniversario_infantil: 6,
  aniversario_adulto: 30,
  corporativo: null,
};

const LOCAL_FESTA = "Espaço Jardim Imperial, Estrada da Rhodia, 3200, Barão Geraldo, Campinas/SP";

function categoriaDe(t: TemplateId): Categoria {
  return t === "aniversario_infantil" || t === "aniversario_adulto" ? "aniversario" : t;
}

/** Contrato completo e valido para a arte e o pacote. */
function dadosBase(t: TemplateId, pacote: string): DadosContrato {
  const doCatalogo = catalogoDaArte(t).pacotes.find((p) => p.nome === pacote);
  if (!doCatalogo) throw new Error(`pacote "${pacote}" não existe em ${t}`);
  const menor = t === "debutante" || t === "aniversario_infantil";

  return dadosContratoSchema.parse({
    contratante: {
      tipo: t === "corporativo" ? "pj" : "pf",
      pf: {
        nome: "Helena Duarte Vasconcelos",
        genero: "feminino",
        cpf: CPF_CONTRATANTE,
        email: "helena.vasconcelos@exemplo.com.br",
        telefone: "19991234567",
        endereco: {
          logradouro: "Rua dos Ipês",
          numero: "245",
          complemento: "Casa 2",
          bairro: "Jardim das Flores",
          cidade: "Campinas",
          uf: "SP",
          cep: "13087000",
        },
      },
      pj: {
        razaoSocial: "Vértice Soluções em Eventos Ltda.",
        cnpj: CNPJ_EMPRESA,
        endereco: {
          logradouro: "Avenida Norte-Sul",
          numero: "1500",
          complemento: "Sala 42",
          bairro: "Cambuí",
          cidade: "Campinas",
          uf: "SP",
          cep: "13025000",
        },
        representante: {
          nome: "Marcos Antunes Ribeiro",
          genero: "masculino",
          cpf: CPF_REPRESENTANTE,
          cargo: "sócio-administrador",
          email: "marcos.ribeiro@verticeeventos.com.br",
          telefone: "1932105678",
        },
      },
      vinculo: menor ? "mãe" : "",
    },
    anuente: { ativo: false },
    evento: {
      data: DATA_EVENTO,
      horarioInicio: "19:30",
      homenageado: HOMENAGEADO[t],
      tipoEvento: t === "corporativo" ? "Convenção anual de vendas" : "",
      locais: [{ rotulo: "Local do evento", endereco: LOCAL_FESTA }],
      makingOfLocal: "",
      makingOfHorario: "",
      alimentacao: true,
    },
    servico: {
      tabela: TABELA_CENARIO,
      pacote,
      // Personalizado nao tem preco de tabela: a Mel digita.
      valorPacote: precoPacote(t, TABELA_CENARIO, pacote) ?? 1_200_00,
      escopo: doCatalogo.escopo,
      adicionais: [],
      desconto: 0,
    },
    pagamento: pagamentoDoPreset("30/70"),
    observacoes: "",
  });
}

/**
 * Tabela dos cenarios. Constante, e nao "2027" solto: os adicionais passaram a
 * ter preco por tabela, entao o pacote e o adicional de um mesmo cenario tem de
 * sair da MESMA tabela -- senao o script compara um total contra outro ano.
 */
const TABELA_CENARIO: TabelaPreco = "2027";

function adicional(
  t: TemplateId,
  id: string,
  pacote: string,
  ajuste: Partial<Adicional> = {},
  tabela: TabelaPreco = TABELA_CENARIO,
): Adicional {
  const item = adicionalDoCatalogo(t, id);
  if (!item) throw new Error(`adicional "${id}" não existe em ${t}`);
  return { ...novoAdicional(item, pacote, tabela), ...ajuste };
}

type Cenario = {
  nome: string;
  templateId: TemplateId;
  dados: DadosContrato;
  idade?: number | null;
  /** Paragrafos de "Das condições especiais" como a rota os entregaria (ja sem marcadores). */
  condicoesEspeciais?: string[];
  /** Papeis que precisam assinar (e ter campo no PDF). */
  assinantes?: number;
  /** Trechos que o texto resolvido PRECISA ter: e o que prova que o cenario exercita a regra dele. */
  deveConter?: string[];
  /** Trechos que o texto resolvido NAO pode ter. */
  naoDeveConter?: string[];
  /** Comeco do texto de avisos que a montagem PRECISA dar. */
  avisos?: string[];
};

/** Um cenario a partir da base, com os ajustes aplicados sobre uma copia. */
function cenario(
  nome: string,
  t: TemplateId,
  pacote: string,
  ajustar: (d: DadosContrato) => void = () => {},
  extra: Omit<Cenario, "nome" | "templateId" | "dados"> = {},
): Cenario {
  const dados = structuredClone(dadosBase(t, pacote));
  ajustar(dados);
  return { nome, templateId: t, dados: dadosContratoSchema.parse(dados), ...extra };
}

const ANUENTE_NOIVO = {
  ativo: true,
  nome: "Rafael Moreira Tavares",
  genero: "masculino" as const,
  cpf: CPF_ANUENTE,
  email: "rafael.tavares@exemplo.com.br",
  papel: "noivo",
};

function cenarios(): Cenario[] {
  const lista: Cenario[] = [];

  // Arte x pacote (inclusive o personalizado de cada arte). O corporativo ja
  // nasce pessoa juridica; as outras, pessoa fisica.
  for (const t of TEMPLATES) {
    for (const { nome } of catalogoDaArte(t).pacotes) {
      lista.push(cenario(`${t} · ${nome}`, t, nome));
    }
  }

  lista.push(
    cenario(
      "casamento · anuente + making of da noiva",
      "casamento",
      "Pacote Principal",
      (d) => {
        d.anuente = { ...ANUENTE_NOIVO };
        d.servico.adicionais = [adicional("casamento", "casamento.making_of_noiva", "Pacote Principal")];
        d.evento.makingOfLocal = "Hotel Vila Rica, Rua Barão de Jaguara, 900, Centro, Campinas/SP";
        d.evento.makingOfHorario = "14:00";
        d.evento.locais = [
          { rotulo: "Local da cerimônia", endereco: "Paróquia Santa Rita, Rua Coronel Quirino, 1200, Cambuí, Campinas/SP" },
          { rotulo: "Local da recepção", endereco: LOCAL_FESTA },
        ];
      },
      { assinantes: 3 },
    ),
  );

  lista.push(
    cenario("casamento · 2 making ofs com 1 storymaker", "casamento", "Pacote Principal", (d) => {
      d.servico.adicionais = [
        adicional("casamento", "casamento.making_of_noiva", "Pacote Principal"),
        adicional("casamento", "casamento.making_of_noivo", "Pacote Principal"),
      ];
    }),
  );

  lista.push(
    cenario("casamento · adicionais variados + desconto", "casamento", "Pacote Principal", (d) => {
      const pacote = "Pacote Principal";
      const livre = novoAdicional(ADICIONAL_LIVRE, pacote, TABELA_CENARIO);
      d.servico.adicionais = [
        adicional("casamento", "casamento.hora_adicional", pacote, { quantidade: 2 }),
        adicional("casamento", "casamento.reels", pacote),
        adicional("casamento", "casamento.polaroid", pacote),
        { ...novoAdicional(ADICIONAL_LOCOMOCAO, pacote, TABELA_CENARIO), valorUnitario: 150_00 },
        {
          ...livre,
          descricao: "Vídeo de até 20 (vinte) minutos com os melhores momentos do evento, com captação e edição",
          valorUnitario: 380_00,
        },
      ];
      d.servico.desconto = 100_00;
      d.evento.alimentacao = false;
    }),
  );

  lista.push(
    cenario(
      "casamento · tempo real + condições especiais",
      "casamento",
      "Pacote Real Time",
      (d) => {
        d.observacoes =
          "Na cerimônia a storymaker auxiliar chega antes para filmar o local, faz a cerimônia e depois fica editando e postando enquanto eu sigo com a festa.";
      },
      {
        condicoesEspeciais: [
          "O storymaker auxiliar chegará ao local antes do início da cerimônia para captar imagens do espaço, registrará a cerimônia e, após o seu término, editará e publicará esse conteúdo.",
          "Enquanto o storymaker auxiliar edita e publica o conteúdo da cerimônia, a CONTRATADA seguirá com a cobertura do restante do evento, registrando os principais momentos conforme o fluxo da festa.",
        ],
      },
    ),
  );

  lista.push(
    cenario("aniversário adulto · tempo real + 15/15/70", "aniversario_adulto", "Pacote Premium", (d) => {
      d.servico.adicionais = [adicional("aniversario_adulto", "aniversario_adulto.tempo_real", "Pacote Premium")];
      d.pagamento = pagamentoDoPreset("15/15/70");
      d.pagamento.parcelas[1].vencimento = { tipo: "data", data: "2026-12-15" };
    }),
  );

  lista.push(
    cenario(
      "aniversário 16 anos · aniversariante anuente",
      "aniversario_adulto",
      "Pacote Pocket",
      (d) => {
        d.evento.homenageado = "Beatriz Duarte";
        d.contratante.vinculo = "mãe";
        d.anuente = {
          ativo: true,
          nome: "Beatriz Duarte Vasconcelos",
          genero: "feminino",
          cpf: CPF_ANIVERSARIANTE,
          email: "bia.duarte@exemplo.com.br",
          papel: "aniversariante",
        };
      },
      { idade: 16, assinantes: 3 },
    ),
  );

  lista.push(
    cenario("debutante · já pago (quitado)", "debutante", "Pacote Premium", (d) => {
      d.pagamento = pagamentoDoPreset("quitado");
      d.pagamento.quitadoEm = "2026-09-15";
    }),
  );

  lista.push(
    cenario("casamento · metade-metade", "casamento", "Pacote Principal", (d) => {
      d.pagamento = pagamentoDoPreset("50/50");
    }, {
      deveConter: [
        "A. 50% (cinquenta por cento) do valor total",
        "a título de sinal para garantir a reserva da data, a ser pago na assinatura deste contrato;",
        "B. 50% (cinquenta por cento) do valor total",
      ],
    }),
  );

  // Pagamento "Personalizado": a interpretacao e a que a IA devolveria para o
  // texto (sem chamar a IA -- este script e offline). O que se prova aqui e a
  // parte do codigo: valores e extenso calculados, resto de centavos na
  // ultima parcela, sinal so onde a Mel disse, desistencia sem sinal.
  lista.push(
    cenario("casamento · personalizado: entrada + 3 vezes", "casamento", "Pacote Principal", (d) => {
      const texto = "30% de entrada na assinatura e o restante em 3 vezes, todo dia 10, de janeiro a março de 2027";
      d.pagamento = {
        ...pagamentoDoPreset("personalizado"),
        textoLivre: texto,
        interpretacao: {
          textoFonte: texto,
          pendencias: [],
          grupos: [
            { quantidade: 1, valorCentavos: null, percentual: 30, vencimento: "na assinatura deste contrato", sinal: true, determinavel: true },
            { quantidade: 3, valorCentavos: null, percentual: 23.3333, vencimento: "mensalmente, todo dia 10, de janeiro a março de 2027", sinal: false, determinavel: true },
          ],
        },
      };
    }, {
      deveConter: [
        "A. R$ 447,00 (quatrocentos e quarenta e sete reais), a título de sinal para garantir a reserva da data, na assinatura deste contrato;",
        "B. 3 (três) parcelas, sendo 2 (duas) de R$ 347,67",
        "e a última de R$ 347,66",
        "mensalmente, todo dia 10, de janeiro a março de 2027.",
        "o sinal previsto na Cláusula",
      ],
    }),
  );

  lista.push(
    cenario("aniversário · personalizado sem sinal (na entrega)", "aniversario_adulto", "Pacote Premium", (d) => {
      const texto = "vai pagar tudo depois que eu entregar";
      d.pagamento = {
        ...pagamentoDoPreset("personalizado"),
        textoLivre: texto,
        interpretacao: {
          textoFonte: texto,
          pendencias: [],
          grupos: [
            {
              quantidade: 1,
              valorCentavos: totalContrato(d.servico),
              percentual: null,
              vencimento: "na entrega do material do evento",
              sinal: false,
              determinavel: true,
            },
          ],
        },
      };
    }, {
      deveConter: ["na entrega do material do evento.", "Adiado o evento a pedido da CONTRATANTE"],
      naoDeveConter: ["o sinal previsto", "além do sinal", "equivalente ao sinal", "reserva da data somente"],
      avisos: ["Nenhuma parcela é sinal"],
    }),
  );

  lista.push(
    // Na debutante o storymaker adicional so existe para a cobertura em tempo
    // real (e o que a arte diz), entao o cenario liga o tempo real junto: sem
    // ele o contrato diria "para a cobertura em tempo real" ao lado de uma
    // clausula de prazos, e a montagem avisa exatamente isso.
    cenario("debutante · making of a definir + storymaker", "debutante", "Pacote Luxo", (d) => {
      d.evento.makingOfLocal = "";
      d.evento.makingOfHorario = "";
      d.servico.escopo.tempoReal = true;
      d.servico.adicionais = [adicional("debutante", "debutante.storymaker", "Pacote Luxo")];
      d.pagamento = pagamentoDoPreset("integral");
    }),
  );

  lista.push(
    cenario("corporativo · PJ sem tipo de evento", "corporativo", "Pacote Luxo", (d) => {
      d.evento.tipoEvento = "";
      d.servico.adicionais = [adicional("corporativo", "corporativo.trend", "Pacote Luxo", { quantidade: 3 })];
    }),
  );

  // A tabela 2028 reajustou TAMBEM os opcionais -- as anteriores nao. Este
  // cenario e o unico lugar em que um contrato sai montado e renderizado com os
  // valores novos de adicional, e por isso usa o tempo real do aniversario
  // adulto: e o item cujo preco depende do pacote E da tabela, e o unico cujo
  // valor tambem aparece no texto do bullet da arte.
  lista.push(
    cenario("adulto · tabela 2028 com tempo real", "aniversario_adulto", "Pacote Luxo", (d) => {
      d.evento.data = "2028-05-20";
      d.servico.tabela = "2028";
      d.servico.valorPacote = precoPacote("aniversario_adulto", "2028", "Pacote Luxo") ?? 0;
      d.servico.escopo.tempoReal = true;
      d.servico.adicionais = [
        adicional("aniversario_adulto", "aniversario_adulto.tempo_real", "Pacote Luxo", {}, "2028"),
        adicional("aniversario_adulto", "aniversario_adulto.hora_adicional", "Pacote Luxo", { quantidade: 2 }, "2028"),
      ];
    }),
  );

  lista.push(
    cenario("infantil · tabela 2026", "aniversario_infantil", "Pacote Básico", (d) => {
      d.evento.data = "2026-12-12";
      d.servico.tabela = "2026";
      d.servico.valorPacote = precoPacote("aniversario_infantil", "2026", "Pacote Básico") ?? 0;
    }),
  );

  // Auxiliar por hora, por menos horas que a cobertura: o contrato promete o
  // auxiliar por 2 horas, e nao "equipe composta" o evento inteiro.
  lista.push(
    cenario(
      "infantil · storymaker por 2 horas",
      "aniversario_infantil",
      "Pacote Premium",
      (d) => {
        d.servico.escopo.tempoReal = true;
        d.servico.adicionais = [
          adicional("aniversario_infantil", "aniversario_infantil.storymaker", "Pacote Premium", { quantidade: 2 }),
        ];
      },
      {
        deveConter: [
          "A cobertura contará, por até 2 (duas) horas, com 1 (um) storymaker auxiliar.",
          "Contar, por até 2 (duas) horas, com 1 (um) storymaker auxiliar",
          "que atuará por até 2 (duas) horas, têm direito a se servir do buffet",
        ],
        naoDeveConter: ["equipe composta", "durante a cobertura, seguindo"],
      },
    ),
  );

  // Ensaio do Pacote Luxo: em outro dia, antes do evento, e fora do "Tempo de serviço" do dia da festa.
  lista.push(
    cenario("debutante · Luxo com ensaio a definir", "debutante", "Pacote Luxo", () => {}, {
      deveConter: [
        "Ensaio fotográfico: A DEFINIR, com duração de até 2 (duas) horas, em data, horário e local de comum acordo entre as partes, anterior à data do evento e sujeitos à disponibilidade da CONTRATADA, devendo ser agendado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência",
        "Tempo de serviço no dia do evento: 7 (sete) horas (2h de making of + 5h de cobertura do evento).",
      ],
      naoDeveConter: ["de ensaio +"],
      avisos: ["A data, o local ou o horário do ensaio fotográfico ficou “A DEFINIR”"],
    }),
  );

  lista.push(
    cenario(
      "debutante · Luxo com ensaio marcado",
      "debutante",
      "Pacote Luxo",
      (d) => {
        d.evento.ensaioData = "2027-02-27";
        d.evento.ensaioLocal = "Parque das Águas, Avenida José Bonifácio, s/n, Jardim Flamboyant, Campinas/SP";
        d.evento.ensaioHorario = "16:30";
        d.evento.makingOfLocal = "Salão Bela Vista, Rua das Hortênsias, 88, Cambuí, Campinas/SP";
        d.evento.makingOfHorario = "15:00";
      },
      {
        deveConter: [
          "Ensaio fotográfico: 27 de fevereiro de 2027, com duração de até 2 (duas) horas;",
          "Local do ensaio fotográfico: Parque das Águas, Avenida José Bonifácio, s/n, Jardim Flamboyant, Campinas/SP;",
          "Início do ensaio fotográfico: 16h30;",
        ],
        naoDeveConter: ["A DEFINIR"],
      },
    ),
  );

  // Empresa (cerimonial) contratando o casamento: o preambulo nomeia as tres
  // partes, o anuente autoriza a propria imagem num item proprio, e a Mel e
  // avisada de que o outro noivo continua sem autorizacao.
  lista.push(
    cenario(
      "casamento · PJ com o noivo como anuente",
      "casamento",
      "Pacote Principal",
      (d) => {
        d.contratante.tipo = "pj";
        d.contratante.pj.razaoSocial = "Cerimonial Aurora Eventos Ltda.";
        d.anuente = { ...ANUENTE_NOIVO };
      },
      {
        assinantes: 3,
        deveConter: [
          "doravante denominadas simplesmente CONTRATANTE, CONTRATADA e ANUENTE, esta última interveniente apenas para os fins da Cláusula 9,",
          "Rafael Moreira Tavares, na qualidade de anuente, autoriza a CONTRATADA, nas mesmas condições do item anterior, a utilizar sua imagem e voz.",
          "E, por estarem assim justas e contratadas, as partes assinam eletronicamente",
        ],
        avisos: ["Quem assina é uma empresa, que não autoriza o uso da imagem dos noivos"],
      },
    ),
  );

  // Desconto maior que o pacote: os adicionais impressos somam mais que o total.
  lista.push(
    cenario(
      "casamento · desconto maior que o pacote",
      "casamento",
      "Pacote Principal",
      (d) => {
        d.servico.adicionais = [
          adicional("casamento", "casamento.making_of_noiva", "Pacote Principal"),
          adicional("casamento", "casamento.polaroid", "Pacote Principal"),
        ];
        d.servico.desconto = 2_000_00;
      },
      { avisos: ["O desconto (R$ 2.000,00) passou do valor do pacote (R$ 1.490,00)"] },
    ),
  );

  return lista;
}

// ---------------------------------------------------------- leitura do PDF --

/** Texto de cada pagina, pelo pdf.js (build legacy, o mesmo da previa do painel). */
async function textoDasPaginas(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // getDocument transfere (e esvazia) o buffer que recebe: vai uma copia.
  const tarefa = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false });
  const pdf = await tarefa.promise;
  try {
    const paginas: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const { items } = await (await pdf.getPage(n)).getTextContent();
      paginas.push(
        items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ")
          .replace(/\s+/g, " "),
      );
    }
    return paginas;
  } finally {
    await tarefa.destroy();
  }
}

// ------------------------------------------------------------- conferencia --

// "{" e "}" sozinhos entram junto com a chave dupla: o catalogo passou a usar
// marcador de chave SIMPLES ("{tempo_real}") no texto dos bullets da arte, e o
// texto de contrato nao usa chave nenhuma -- entao proibir custa zero e pega o
// marcador que escapou.
const PROIBIDOS = ["{{", "}}", "{", "}", "undefined", "NaN", "null", "R$ NaN"];

/** Tudo que o texto RESOLVIDO precisa cumprir. Devolve os problemas. */
function conferirTexto(doc: DocumentoContrato): string[] {
  const p: string[] = [];
  const r = textoResolvido(doc);
  const n = r.clausulas.length;

  r.clausulas.forEach((c, i) => {
    if (c.numero !== i + 1) p.push(`cláusula ${c.id} numerada ${c.numero}, esperava ${i + 1}`);
  });
  const ids = doc.clausulas.map((c) => c.id);
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repetidos.length) p.push(`cláusula repetida: ${[...new Set(repetidos)].join(", ")}`);

  const trechos = [
    r.titulo,
    r.preambulo,
    r.localData,
    ...r.partes.map((x) => x.texto),
    ...r.clausulas.flatMap((c) => [c.cabecalho, ...c.paragrafos]),
    ...r.assinaturas.flatMap((a) => [a.rotulo, a.nome, a.documento]),
  ];
  for (const t of trechos) {
    for (const proibido of PROIBIDOS) {
      if (t.includes(proibido)) p.push(`texto com "${proibido}": …${trecho(t, proibido)}…`);
    }
    if (/ {2}/.test(t)) p.push(`espaço duplo: …${trecho(t, "  ")}…`);
  }

  for (const m of textoCorrido(doc).matchAll(/Cláusula (\d+)/g)) {
    const k = Number(m[1]);
    if (k < 1 || k > n) p.push(`remissão para a Cláusula ${k}, mas o contrato tem ${n}`);
  }
  return p;
}

function trecho(t: string, alvo: string): string {
  const i = t.indexOf(alvo);
  return t.slice(Math.max(0, i - 30), i + alvo.length + 30);
}

/** Tudo que o PDF renderizado precisa cumprir. */
async function conferirPdf(
  doc: DocumentoContrato,
  r: Awaited<ReturnType<typeof renderizarContrato>>,
  assinantes: number,
): Promise<string[]> {
  const p: string[] = [];
  const G = GEOMETRIA_CONTRATO;

  const relido = await PDFDocument.load(r.bytes);
  const paginas = relido.getPageCount();
  if (paginas !== r.paginas) p.push(`o PDF tem ${paginas} páginas, a renderização disse ${r.paginas}`);
  if (paginas > LIMITE_PAGINAS) p.push(`${paginas} páginas (máximo ${LIMITE_PAGINAS})`);
  if (r.bytes.length > LIMITE_BYTES) p.push(`${Math.round(r.bytes.length / 1024)} kB (máximo 300 kB)`);
  if (r.usouFallbackDeFonte) p.push("saiu com a fonte reserva (Helvetica): assets/fonts não foi achado");

  // Uma posicao por quem assina, todas na ultima pagina e dentro dela.
  if (doc.assinaturas.length !== assinantes) {
    p.push(`${doc.assinaturas.length} assinantes no documento, esperava ${assinantes}`);
  }
  for (const a of doc.assinaturas) {
    const pos = r.posicoes.filter((x) => x.papel === a.papel);
    if (pos.length !== 1) {
      p.push(`${pos.length} campo(s) de assinatura para ${a.rotulo}`);
      continue;
    }
    const { pagina, x, yTopo, largura, altura } = pos[0];
    if (pagina !== paginas) p.push(`assinatura de ${a.rotulo} na página ${pagina}, e não na última (${paginas})`);
    const dentro =
      x >= 0 && yTopo >= 0 && x + largura <= G.larguraPagina && yTopo + altura <= G.alturaPagina - G.margemBase + 1;
    if (!dentro) p.push(`assinatura de ${a.rotulo} fora da área da página (x ${x}, y ${yTopo})`);
  }

  // O texto que um leitor de PDF extrai: nada de marcacao, e as clausulas em
  // sequencia, sem pular nem repetir numero.
  const texto = await textoDasPaginas(r.bytes);
  const tudo = texto.join(" ");
  for (const proibido of PROIBIDOS) {
    if (tudo.includes(proibido)) p.push(`o PDF tem "${proibido}"`);
  }
  const numeros = [...tudo.matchAll(/CLÁUSULA (\d+) - /g)].map((m) => Number(m[1]));
  const esperado = doc.clausulas.map((_, i) => i + 1);
  if (JSON.stringify(numeros) !== JSON.stringify(esperado)) {
    p.push(`cabeçalhos no PDF: ${numeros.join(", ")} (esperava 1 a ${esperado.length}, em ordem)`);
  }
  texto.forEach((t, i) => {
    if (!t.includes(`Página ${i + 1} de ${paginas}`)) p.push(`página ${i + 1} sem o rodapé "Página ${i + 1} de ${paginas}"`);
  });
  return p;
}

/** Decisao travada 3: o que iria para a IA nao pode ter dado pessoal de ninguem. */
function conferirAnonimizacao(doc: DocumentoContrato, dados: DadosContrato, ctx: ContextoMontagem): string[] {
  const paraIa = [anonimizar(doc, dados), resumoParaIa(dados, ctx), anonimizarTexto(dados.observacoes, dados)].join("\n");
  const p = dadosPessoaisNoTexto(paraIa, dados).map((c) => `o texto anonimizado ainda tem ${c}`);
  const cpfs = [dados.contratante.pf.cpf, dados.contratante.pj.representante.cpf, dados.anuente.cpf].filter(Boolean);
  const digitos = paraIa.replace(/\D/g, "");
  for (const cpf of cpfs) if (digitos.includes(cpf)) p.push("o texto anonimizado ainda tem os dígitos de um CPF");
  return p;
}

// -------------------------------------------------------------------- main --

function slug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const saida = path.join(process.cwd(), ".contrato-verificacao");
  await fs.mkdir(saida, { recursive: true });

  const lista = cenarios();
  let falhas = 0;
  const cobertos = new Set<string>();
  const tabelasCobertas = new Set<TabelaPreco>();

  console.log(
    `\n  ${"cenário".padEnd(48)} ${"cláus.".padStart(6)} ${"pág".padStart(3)} ${"kB".padStart(4)} ${"ms".padStart(5)}  total`,
  );

  for (const c of lista) {
    const t = c.templateId;
    const ctx: ContextoMontagem = {
      categoria: categoriaDe(t),
      templateId: t,
      idadeHomenageado: c.idade !== undefined ? c.idade : IDADE[t],
      hojeISO: HOJE,
    };
    const problemas: string[] = [];
    const t0 = performance.now();

    const falta = faltantes(c.dados, ctx);
    if (falta.length) {
      console.error(`✗ ${c.nome}: cenário completo com faltantes: ${falta.join("; ")}`);
      falhas++;
      continue;
    }

    const { documento, avisos } = montarContrato(c.dados, ctx, c.condicoesEspeciais ?? null);
    problemas.push(...validarDocumento(documento));
    const corrido = textoCorrido(documento);
    for (const t of c.deveConter ?? []) if (!corrido.includes(t)) problemas.push(`o texto não tem: “${t}”`);
    for (const t of c.naoDeveConter ?? []) if (corrido.includes(t)) problemas.push(`o texto tem: …${trecho(corrido, t)}…`);
    for (const inicio of c.avisos ?? []) {
      if (!avisos.some((a) => a.texto.startsWith(inicio))) problemas.push(`faltou o aviso: “${inicio}…”`);
    }
    for (const cl of documento.clausulas) {
      if (cl.origem === "ia") problemas.push(...cl.problemas.map((x) => `condições especiais: ${x}`));
    }
    if (c.condicoesEspeciais && !documento.clausulas.some((cl) => cl.id === "condicoes_especiais")) {
      problemas.push("a cláusula de condições especiais não entrou no contrato");
    }
    problemas.push(...conferirTexto(documento));
    problemas.push(...conferirAnonimizacao(documento, c.dados, ctx));

    let linha = "";
    try {
      const r = await renderizarContrato(documento, { agora: AGORA });
      const ms = Math.round(performance.now() - t0);
      problemas.push(...(await conferirPdf(documento, r, c.assinantes ?? 2)));

      const arquivo = slug(c.nome);
      await fs.writeFile(path.join(saida, `${arquivo}.pdf`), r.bytes);
      await fs.writeFile(path.join(saida, `${arquivo}.txt`), `${textoCorrido(documento, { comNegrito: true })}\n`);

      linha =
        `${String(documento.clausulas.length).padStart(6)} ${String(r.paginas).padStart(3)} ` +
        `${String(Math.round(r.bytes.length / 1024)).padStart(4)} ${String(ms).padStart(5)}  ` +
        formatarReais(totalContrato(c.dados.servico));
    } catch (e) {
      problemas.push(`não renderizou: ${(e as Error).message}`);
    }

    cobertos.add(`${t}|${c.dados.servico.pacote}`);
    tabelasCobertas.add(c.dados.servico.tabela);

    if (problemas.length) {
      falhas++;
      console.error(`✗ ${c.nome.padEnd(48)} ${linha}`);
      for (const x of problemas) console.error(`      - ${x}`);
    } else {
      console.log(`✓ ${c.nome.padEnd(48)} ${linha}`);
    }
  }

  // Trava contra regressao: pacote novo no catalogo sem cenario nao passa em
  // silencio (mesma ideia do cruzamento arte x tabela do pdf:verificar).
  const semCenario = TEMPLATES.flatMap((t) => catalogoDaArte(t).pacotes.map((p) => `${t}|${p.nome}`)).filter(
    (k) => !cobertos.has(k),
  );
  if (semCenario.length) {
    console.error(`\n✗ pacotes sem cenário: ${semCenario.map((k) => k.replace("|", " · ")).join(", ")}`);
    falhas++;
  }
  if (!TEMPLATES.every((t) => cobertos.has(`${t}|${PACOTE_PERSONALIZADO}`))) {
    console.error("\n✗ falta o pacote Personalizado em alguma arte");
    falhas++;
  }

  // O contrato e o unico lugar do sistema em que preco vira NUMERO, e desde a
  // tabela 2028 os adicionais tambem mudam por tabela. Sem esta trava, uma
  // tabela nova entrava sem nenhum contrato montado com os valores dela -- e o
  // script ficava verde, ao contrario do pdf:verificar, que cruza arte x tabela.
  const semTabela = TABELAS_PRECO.filter((tp) => !tabelasCobertas.has(tp));
  if (semTabela.length) {
    console.error(
      `\n✗ tabela(s) de preço sem nenhum cenário: ${semTabela.join(", ")}` +
        `\n  Acrescente um cenário com essa tabela — de preferência um com adicional,` +
        `\n  que é o que o reajuste de opcional pode quebrar em silêncio.`,
    );
    falhas++;
  }

  console.log(`\n${lista.length} cenários. PDFs e textos em ${path.relative(process.cwd(), saida)}/`);
  if (falhas) {
    console.error(`\n${falhas} cenário(s) com problema.`);
    process.exit(1);
  }
  console.log("\nContratos aprovados.\n");
}

// Sem top-level await: o projeto nao e "type": "module", entao o tsx transpila
// este arquivo para CJS, onde TLA nao existe.
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
