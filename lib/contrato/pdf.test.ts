import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { ASSINANTE_CONTRATADA, PARTE_CONTRATADA } from "./contratada";
import { validarCnpj, validarCpf } from "./documento";
import { MarcacaoInvalidaError, ReferenciaInvalidaError } from "./marcacao";
import {
  GEOMETRIA_CONTRATO,
  palavrasDoTexto,
  quebrarEmLinhas,
  renderizarContrato,
  type ContratoRenderizado,
  type LinhaDiagramada,
  type Medidor,
  type Palavra,
} from "./pdf";
import { documentoContratoSchema, type Clausula, type DocumentoContrato } from "./tipos";

/**
 * O PDF do contrato e documento juridico: o que estes testes protegem e que
 * ele saia inteiro (nenhuma remissao quebrada, nenhum `**` ou `{{` impresso),
 * legivel (nada fora da margem, nem o e-mail de 80 caracteres sem espaco) e
 * assinavel (a posicao de cada assinatura cai onde a linha foi desenhada, na
 * ultima pagina).
 *
 * Todos os dados sao FICTICIOS, com CPF/CNPJ de digito verificador valido
 * gerado para o teste. Nenhum veio de contrato de cliente. A unica excecao e a
 * propria Mel (CONTRATADA), que e constante do sistema.
 *
 * Para OLHAR o PDF que estes testes geram:
 *   CONTRATO_AMOSTRA=/caminho/amostra.pdf node --conditions=react-server --import tsx --test lib/contrato/pdf.test.ts
 */

// ------------------------------------------------------------- fixtures --

const CPF_CONTRATANTE = "41875239600";
const CPF_ANUENTE = "53091728404";
const CPF_REPRESENTANTE = "27648105390";
const CNPJ_EMPRESA = "41827053000168";

/** 80 caracteres, nenhum espaco: o pior caso de quebra de linha que um dado real produz. */
const EMAIL_80 = "beatriz.fontes.carvalho.e.joao.henrique.albuquerque.casamento2027@exemplo.com.br";
const EMAIL_PJ = "contato.eventos.corporativos.lancamentos@aurora-eventos-ficticia.com.br";

// Por codepoint, nunca literal: o soft hyphen e invisivel no codigo, e emoji
// nao entra no fonte do repo.
const SOFT_HYPHEN = String.fromCodePoint(0xad);
const NBSP = String.fromCodePoint(0xa0);
const EMOJI = String.fromCodePoint(0x1f389);

const PALAVRAS_ENCHIMENTO =
  "a cobertura seguirá o roteiro combinado entre as partes, respeitando os horários do cerimonial e a dinâmica da recepção".split(
    " ",
  );

type OpcoesFicticio = {
  /** Contratante pessoa juridica (sem anuente: 2 assinantes). */
  pj?: boolean;
  /** Paragrafo extra de N palavras no objeto, para deslocar a paginacao. */
  enchimento?: number;
};

function clausula(id: string, titulo: string, paragrafos: string[]): Clausula {
  return { id, titulo, paragrafos, origem: "padrao", problemas: [] };
}

/**
 * Um contrato completo no formato que `montarContrato` produz: 17 clausulas,
 * remissoes por id, `**` nas frases limitativas. Casamento (PF + anuente, 3
 * assinantes) ou evento corporativo (PJ, 2 assinantes).
 */
function contratoFicticio(opcoes: OpcoesFicticio = {}): DocumentoContrato {
  const pj = opcoes.pj ?? false;
  const enchimento = opcoes.enchimento ?? 0;

  const partes: DocumentoContrato["partes"] = pj
    ? [
        {
          rotulo: "CONTRATANTE",
          texto: `Aurora Eventos Corporativos Ltda., pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 41.827.053/0001-68, com sede na Avenida das Amoreiras, 1200, Sala 305, Parque Itália, Campinas/SP, neste ato representada por Ricardo Menezes Prado, sócio-administrador, inscrito no CPF sob o nº 276.481.053-90, que declara possuir poderes para firmar o presente instrumento, com endereço eletrônico ${EMAIL_PJ}.`,
        },
        PARTE_CONTRATADA,
      ]
    : [
        {
          rotulo: "CONTRATANTE",
          texto: `Beatriz Fontes Carvalho, brasileira, inscrita no CPF sob o nº 418.752.396-00, residente e domiciliada na Rua das Paineiras, 145, Apto. 32, Jardim Flamboyant, Campinas/SP, CEP 13091-000, com endereço eletrônico ${EMAIL_80}, que declara ser maior de 18 (dezoito) anos e plenamente capaz para os atos da vida civil.`,
        },
        PARTE_CONTRATADA,
        {
          rotulo: "ANUENTE",
          texto:
            "João Henrique Albuquerque Neto, brasileiro, inscrito no CPF sob o nº 530.917.284-04, com endereço eletrônico joao.neto@exemplo.com.br, noivo no evento, que intervém neste instrumento exclusivamente para autorizar o uso de sua imagem e voz, nos termos da Cláusula {{ref:direitos}}.",
        },
      ];

  const objeto = [
    "O presente contrato tem por objeto a prestação de serviços de storymaker, no Pacote Principal, consistindo na cobertura do casamento de Beatriz e João, pelo período de até 5 (cinco) horas, abrangendo cerimônia e recepção, acrescido de até 2 (duas) horas de making of, através de registros em formato de stories ilimitados (Instagram), incluindo stories do making of e dos melhores momentos do evento, bem como a gravação e edição de 1 (um) Reels de até 1 (um) minuto e 30 (trinta) segundos, com o resumo do evento.",
    ...(enchimento > 0
      ? [
          Array.from({ length: enchimento }, (_, i) => PALAVRAS_ENCHIMENTO[i % PALAVRAS_ENCHIMENTO.length]).join(" ") +
            ".",
        ]
      : []),
    "Integram também o objeto deste contrato os serviços adicionais descritos na Cláusula {{ref:adicionais}}.",
  ];

  const direitos = pj
    ? [
        "{{n}}.1. Os direitos autorais sobre o material produzido pertencem à CONTRATADA, nos termos da Lei nº 9.610/98. A CONTRATADA concede à CONTRATANTE licença gratuita, não exclusiva e por prazo indeterminado para utilizar o material entregue em seus canais próprios, para fins institucionais e publicitários, indicando-se, sempre que possível, a autoria da CONTRATADA.",
        "{{n}}.2. **A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar o material produzido no evento no portfólio e na divulgação do trabalho da CONTRATADA em seu site e em seus perfis profissionais nas redes sociais, inclusive em anúncios pagos, podendo as publicações incluir marcações, menções ou colaborações com a CONTRATANTE e com outros fornecedores envolvidos no evento.**",
      ]
    : [
        "{{n}}.1. Os direitos autorais sobre o material produzido pertencem à CONTRATADA, nos termos da Lei nº 9.610/98. A CONTRATADA concede à CONTRATANTE licença gratuita, não exclusiva e por prazo indeterminado para guardar, publicar e compartilhar o material entregue, para fins pessoais e não comerciais, inclusive em suas redes sociais, indicando-se, sempre que possível, a autoria da CONTRATADA.",
        "{{n}}.2. **A CONTRATANTE autoriza a CONTRATADA, gratuitamente, a utilizar sua imagem e voz, e João Henrique Albuquerque Neto, na qualidade de anuente, autoriza igualmente o uso de sua imagem e voz, captadas no evento, no portfólio e na divulgação do trabalho da CONTRATADA em seu site e em seus perfis profissionais nas redes sociais, inclusive em anúncios pagos, podendo as publicações incluir marcações, menções ou colaborações com outros fornecedores envolvidos no evento.**",
      ];

  const foro = pj
    ? "As partes elegem o Foro da Comarca de Monte Mor/SP, domicílio da CONTRATADA, para dirimir judicialmente as controvérsias inerentes ao presente contrato, renunciando a qualquer outro, por mais privilegiado que seja. E, por estarem assim justos e contratados, assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito."
    : "As partes elegem o foro da comarca do domicílio da CONTRATANTE para dirimir judicialmente as controvérsias inerentes ao presente contrato. E, por estarem assim justos e contratados, assinam eletronicamente o presente instrumento, para que produza todos os efeitos de direito.";

  const clausulas: Clausula[] = [
    clausula("objeto", "DO OBJETO DO CONTRATO", objeto),
    clausula("local", "DO LOCAL, DATA E HORÁRIO DO EVENTO", [
      "Data do evento: 23 de janeiro de 2027;",
      "Início da cobertura do evento: 16h;",
      "Local da cerimônia: Paróquia Santa Clara de Assis (fictícia), Rua das Hortênsias, 300, Jardim Botânico, Campinas/SP;",
      "Local da recepção: Espaço Jardim das Oliveiras (fictício), Estrada Municipal do Pinhal, km 4, Joaquim Egídio, Campinas/SP;",
      "Local do making of: A DEFINIR, devendo ser informado pela CONTRATANTE com no mínimo 10 (dez) dias de antecedência;",
      "Início do making of: 13h30;",
      "Tempo de serviço: 8 (oito) horas (2h de making of + 6h de cobertura do evento).",
    ]),
    clausula("servicos", "DOS SERVIÇOS", [
      "A. Realizar stories ilimitados do making of e do evento, utilizando equipamento próprio, com publicação direta na conta do Instagram fornecida pela CONTRATANTE em até 5 (cinco) dias úteis após o evento.",
      "B. Gravar e editar 1 (um) Reels/Vídeo com o resumo do evento, com duração de até 1 (um) minuto e 30 (trinta) segundos.",
    ]),
    clausula("adicionais", "DOS SERVIÇOS ADICIONAIS", [
      "Fica acordada a inclusão dos seguintes serviços adicionais à cobertura principal:",
      "A. Making of da noiva, com duração de até 2 (duas) horas, no valor de R$ 380,00 (trezentos e oitenta reais).",
      "B. 1 (uma) hora adicional de cobertura, no valor de R$ 350,00 (trezentos e cinquenta reais).",
      "C. Reels ou trend adicional, de até 1 (um) minuto e 30 (trinta) segundos, no valor de R$ 300,00 (trezentos reais).",
      "Os serviços adicionais integram o presente contrato para todos os fins, aplicando-se a eles as mesmas condições técnicas, operacionais e prazos aqui estabelecidos.",
    ]),
    clausula("prazos", "DOS PRAZOS", [
      "A CONTRATADA compromete-se a entregar a cobertura completa dos stories no prazo de até 5 (cinco) dias úteis após o evento, bem como os Reels e todo o material bruto captado no prazo de até 7 (sete) dias úteis.",
    ]),
    clausula("instagram", "DO ACESSO À CONTA DO INSTAGRAM", [
      "A CONTRATANTE fornecerá à CONTRATADA, até o dia do evento, acesso à conta do Instagram em que os stories serão publicados, preferencialmente pelas ferramentas de acesso compartilhado da própria plataforma. A CONTRATADA e sua equipe utilizarão esse acesso exclusivamente para publicar o conteúdo do evento, sem ler ou responder mensagens diretas nem alterar configurações da conta, e deixarão de utilizá-lo ao término dos serviços, recomendando-se à CONTRATANTE a alteração da senha.",
      "**Na ausência desse acesso, a cobertura será entregue juntamente com o restante do material, por meio de link para download em nuvem.**",
    ]),
    clausula("pagamento", "DO PAGAMENTO", [
      "O valor total dos serviços prestados será de R$ 2.480,00 (dois mil quatrocentos e oitenta reais), já incluídos os serviços adicionais. O pagamento será realizado da seguinte forma:",
      "A. 15% (quinze por cento) do valor total, equivalente a R$ 372,00 (trezentos e setenta e dois reais), a título de sinal para garantir a reserva da data, a ser pago na assinatura deste contrato;",
      "B. 15% (quinze por cento) do valor total, equivalente a R$ 372,00 (trezentos e setenta e dois reais), a título de sinal para garantir a reserva da data, com vencimento em 30 de outubro de 2026;",
      "C. 70% (setenta por cento) do valor total, equivalente a R$ 1.736,00 (mil setecentos e trinta e seis reais), a ser pago até 10 (dez) dias antes da data do evento.",
      "O sinal corresponde à soma das parcelas acima identificadas como tal, no total de R$ 744,00 (setecentos e quarenta e quatro reais), e **a reserva da data somente será garantida após a confirmação do pagamento integral do sinal.**",
      "Todos os pagamentos deverão ser realizados via PIX, utilizando a chave PIX (CNPJ): 53.925.833/0001-20.",
    ]),
    clausula("entrega", "DA PLATAFORMA DE ENTREGA", [
      "Os registros serão entregues por meio de um link de compartilhamento de arquivos em nuvem, **não sendo a CONTRATADA obrigada a disponibilizá-los por outros meios.**",
    ]),
    clausula("armazenamento", "DO TEMPO DE ARMAZENAMENTO", [
      "**A CONTRATANTE terá acesso ao link com os registros por um período de 6 (seis) meses após o evento, cabendo a ela realizar o download dos arquivos dentro desse prazo. Após este prazo, os arquivos serão excluídos da nuvem.**",
      "Parágrafo único. Ficam preservados os conteúdos utilizados no portfólio e na divulgação do trabalho da CONTRATADA, nos termos da Cláusula {{ref:direitos}}.",
    ]),
    clausula("direitos", "DOS DIREITOS AUTORAIS E AUTORIZAÇÃO DE IMAGEM", direitos),
    clausula("alimentacao", "DA ALIMENTAÇÃO", [
      "A CONTRATANTE informará à equipe do local do evento que a CONTRATADA tem direito a se servir do buffet, bem como acesso à alimentação e bebidas não alcoólicas disponibilizadas durante o evento.",
    ]),
    clausula("alteracoes", "DAS ALTERAÇÕES DO MATERIAL", [
      "**A CONTRATANTE reconhece que o serviço de storymaker não inclui adaptações, revisões ou modificações do material, por preferência estética, após a finalização e entrega.** Não se incluem nesta regra as falhas técnicas ou de informação atribuíveis à CONTRATADA, como grafia incorreta de nomes, arquivo corrompido ou material incompleto em relação ao contratado, que serão corrigidas sem custo em até 5 (cinco) dias úteis contados da comunicação da CONTRATANTE.",
    ]),
    clausula("desistencia", "DA DESISTÊNCIA OU ADIAMENTO DO EVENTO", [
      "{{n}}.1. **Em caso de desistência ou cancelamento do evento pela CONTRATANTE, o sinal previsto na Cláusula {{ref:pagamento}} não será reembolsado.**",
      "{{n}}.2. **Se o evento for adiado e a nova data coincidir com outro compromisso da CONTRATADA, o serviço não será prestado e o sinal não será reembolsado.**",
      "{{n}}.3. Caso a CONTRATADA deixe de prestar os serviços por motivo a ela imputável, fora das hipóteses da Cláusula {{ref:equipe}}, restituirá à CONTRATANTE, em até 10 (dez) dias, a integralidade dos valores pagos, acrescida de quantia equivalente ao sinal, sem prejuízo dos demais direitos assegurados à CONTRATANTE pela legislação.",
    ]),
    clausula("equipe", "DA EQUIPE DE TRABALHO", [
      "Em caso de impossibilidade da CONTRATADA de comparecer ao evento por motivo de força maior ou caso fortuito, a CONTRATADA designará outro profissional de sua equipe para a realização do serviço contratado, comunicando a CONTRATANTE tão logo tenha conhecimento do impedimento. **A CONTRATANTE declara estar ciente de que o profissional designado atuará seguindo o mesmo padrão de trabalho, identidade visual e diretrizes previamente estabelecidas pela CONTRATADA, e de que tal substituição não caracterizará descumprimento contratual.**",
      "Parágrafo único. Não sendo possível a substituição, o contrato será resolvido e a CONTRATADA restituirá integralmente os valores pagos pela CONTRATANTE, em até 10 (dez) dias.",
    ]),
    {
      ...clausula("condicoes_especiais", "DAS CONDIÇÕES ESPECIAIS", [
        // Emoji, soft hyphen e espaco duro: o que chega colado do WhatsApp.
        `A CONTRATADA registrará também, sem custo adicional, o brinde ${EMOJI} dos padrinhos que antecede a cerimônia, desde que ocorra no mesmo endereço da recep${SOFT_HYPHEN}ção e dentro do${NBSP}período contratado.`,
        "Parágrafo único. As condições desta cláusula prevalecem sobre as demais disposições deste contrato apenas naquilo que expressamente modificarem, permanecendo inalteradas todas as demais cláusulas.",
      ]),
      origem: "ia",
    },
    clausula("assinatura_eletronica", "DA ASSINATURA ELETRÔNICA", [
      "As partes reconhecem como válida e eficaz a assinatura deste instrumento por meio eletrônico, pela plataforma iLovePDF, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, e declaram que a versão eletrônica, acompanhada do respectivo registro de assinaturas, constitui o original deste contrato.",
    ]),
    clausula("foro", "DO FORO", [foro]),
  ];

  const assinaturas: DocumentoContrato["assinaturas"] = pj
    ? [
        {
          papel: "contratante",
          rotulo: "CONTRATANTE",
          nome: "Aurora Eventos Corporativos Ltda.",
          documento: "CNPJ: 41.827.053/0001-68 — p. Ricardo Menezes Prado, CPF: 276.481.053-90",
          email: EMAIL_PJ,
        },
        ASSINANTE_CONTRATADA,
      ]
    : [
        {
          papel: "contratante",
          rotulo: "CONTRATANTE",
          nome: "Beatriz Fontes Carvalho",
          documento: "CPF: 418.752.396-00",
          email: EMAIL_80,
        },
        ASSINANTE_CONTRATADA,
        {
          papel: "anuente",
          rotulo: "ANUENTE",
          nome: "João Henrique Albuquerque Neto",
          documento: "CPF: 530.917.284-04",
          email: "joao.neto@exemplo.com.br",
        },
      ];

  // Passa pelo schema: o fixture tem de ser um documento que a rota aceitaria.
  return documentoContratoSchema.parse({
    versaoModelo: "2026-09-29",
    titulo: "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE STORYMAKER",
    partes,
    preambulo:
      "Pelo presente instrumento particular, as partes acima identificadas e qualificadas, doravante denominadas simplesmente CONTRATANTE e CONTRATADA, têm entre si justo e contratado o que segue, nos termos e condições abaixo:",
    clausulas,
    localData: "Campinas/SP, na data da última assinatura eletrônica registrada pela plataforma.",
    assinaturas,
  });
}

// ------------------------------------------------------- leitura do PDF --

type ItemTexto = { str: string; x: number; y: number; largura: number };
type PaginaLida = { numero: number; itens: ItemTexto[]; linhas: { y: number; texto: string }[]; texto: string };

const colapsar = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Le o texto de volta com o pdf.js (build legacy, o mesmo do painel), como
 * um leitor de PDF faria. E a prova de que o que foi desenhado e texto de
 * verdade, na ordem certa, e nao so pixels no lugar certo.
 */
async function lerPdf(bytes: Uint8Array): Promise<PaginaLida[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // getDocument transfere (e esvazia) o buffer que recebe: vai uma copia.
  const tarefa = pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const pdf = await tarefa.promise;
  try {
    const paginas: PaginaLida[] = [];
    for (let numero = 1; numero <= pdf.numPages; numero++) {
      const pagina = await pdf.getPage(numero);
      const { items } = await pagina.getTextContent();
      const itens: ItemTexto[] = items.flatMap((item) =>
        "str" in item && item.str.trim()
          ? [{ str: item.str, x: item.transform[4], y: item.transform[5], largura: item.width }]
          : [],
      );
      // Linhas visuais: itens com a mesma baseline, da esquerda para a direita.
      const porY = new Map<number, ItemTexto[]>();
      for (const item of itens) {
        const y = Math.round(item.y * 2) / 2;
        porY.set(y, [...(porY.get(y) ?? []), item]);
      }
      const linhas = [...porY.entries()]
        .sort(([a], [b]) => b - a)
        .map(([y, doY]) => ({
          y,
          texto: colapsar(
            doY
              .sort((a, b) => a.x - b.x)
              .map((i) => i.str)
              .join(" "),
          ),
        }));
      paginas.push({ numero, itens, linhas, texto: colapsar(linhas.map((l) => l.texto).join(" ")) });
    }
    return paginas;
  } finally {
    await tarefa.destroy();
  }
}

const G = GEOMETRIA_CONTRATO;
const MARGEM_DIREITA = G.larguraPagina - G.margemLateral;
const TOLERANCIA = 0.5;
const ehRodape = (linha: { texto: string }) => /^Página \d+ de \d+$/.test(linha.texto);

// Uma renderizacao de cada variante serve a varios testes.
let casamento: Promise<ContratoRenderizado> | null = null;
let corporativo: Promise<ContratoRenderizado> | null = null;
const renderCasamento = () => (casamento ??= renderizarContrato(contratoFicticio(), { agora: new Date("2026-09-29T15:00:00Z") }));
const renderCorporativo = () => (corporativo ??= renderizarContrato(contratoFicticio({ pj: true })));

// --------------------------------------------------- diagramacao (pura) --

/** Fonte monoespacada de mentira: 6 pt por caractere (7 no negrito), 3 pt por espaco. */
const MONO: Medidor = {
  tamanho: 12,
  largura: (texto, peso) => [...texto].reduce((soma, c) => soma + (c === " " ? 3 : peso === "negrito" ? 7 : 6), 0),
  glifos: (texto) => [...texto].length,
};

const textoDe = (p: Palavra) => p.fragmentos.map((f) => f.texto).join("");

test("os documentos do fixture são fictícios e têm dígito verificador válido", () => {
  for (const cpf of [CPF_CONTRATANTE, CPF_ANUENTE, CPF_REPRESENTANTE]) assert.ok(validarCpf(cpf), cpf);
  assert.ok(validarCnpj(CNPJ_EMPRESA));
  assert.equal(EMAIL_80.length, 80);
  assert.doesNotMatch(EMAIL_80, /\s/);
});

/** Largura final da linha depois de justificada: espacos esticados e letras afastadas. */
function larguraJustificada(linha: LinhaDiagramada): number {
  const vaos = linha.palavras.length - 1;
  const glifos = vaos + linha.palavras.reduce((s, p) => s + [...textoDe(p)].length, 0);
  return linha.larguraNatural + linha.extraPorEspaco * vaos + linha.espacamentoLetras * (glifos - 1);
}

test("quebra por palavra, justifica todas as linhas menos a última e nenhuma passa da largura", () => {
  const texto = "um dois tres quatro cinco seis sete oito nove dez onze doze treze catorze quinze";
  const palavras = palavrasDoTexto(texto, MONO);
  const linhas = quebrarEmLinhas(palavras, 100, MONO, true);

  assert.ok(linhas.length > 2);
  assert.equal(linhas.flatMap((l) => l.palavras.map(textoDe)).join(" "), texto);
  linhas.forEach((linha, i) => {
    assert.ok(linha.larguraNatural <= 100 + 1e-6, `linha ${i} estourou`);
    if (i === linhas.length - 1) {
      assert.equal(linha.extraPorEspaco, 0, "a última linha fica à esquerda");
      assert.equal(linha.espacamentoLetras, 0);
    } else if (linha.extraPorEspaco > 0) {
      assert.ok(Math.abs(larguraJustificada(linha) - 100) < 1e-6, `linha ${i} não encosta na margem`);
    }
  });
  assert.ok(linhas.slice(0, -1).some((l) => l.extraPorEspaco > 0), "nenhuma linha foi justificada");
});

test("a sobra da linha vai primeiro para os espaços (até 2x), depois para as letras (até 2,5% do corpo), depois de novo para os espaços (até 3x)", () => {
  // Linha de 4 palavras de 5 letras: 120 + 3 espacos de 3 = 129, 23 glifos.
  // A quinta palavra (120) nunca cabe junto.
  const texto = `aaaaa bbbbb ccccc ddddd ${"e".repeat(20)}`;
  const primeira = (largura: number) => {
    const [linha] = quebrarEmLinhas(palavrasDoTexto(texto, MONO), largura, MONO, true);
    assert.equal(linha.palavras.length, 4);
    return linha;
  };
  const LETRAS_MAX = 0.025 * MONO.tamanho;

  const pouca = primeira(132); // sobra 3: so os espacos, 1 pt cada
  assert.ok(Math.abs(pouca.extraPorEspaco - 1) < 1e-9);
  assert.equal(pouca.espacamentoLetras, 0);

  const media = primeira(140); // sobra 11: espacos no teto confortavel (+3 = 2x), o resto nas letras
  assert.ok(Math.abs(media.extraPorEspaco - 3) < 1e-9);
  assert.ok(media.espacamentoLetras > 0 && media.espacamentoLetras <= LETRAS_MAX);
  assert.ok(Math.abs(larguraJustificada(media) - 140) < 1e-9);

  const grande = primeira(150); // sobra 21: letras no teto, espacos alem de 2x mas dentro de 3x (+6)
  assert.ok(Math.abs(grande.espacamentoLetras - LETRAS_MAX) < 1e-9);
  assert.ok(grande.extraPorEspaco > 3 && grande.extraPorEspaco <= 6);
  assert.ok(Math.abs(larguraJustificada(grande) - 150) < 1e-9);

  const demais = primeira(160); // sobra 31: nem com os tres degraus -> a esquerda
  assert.equal(demais.extraPorEspaco, 0);
  assert.equal(demais.espacamentoLetras, 0);
});

test("linha que precisaria de espaço maior que 3x o normal sai alinhada à esquerda, sem buraco", () => {
  // "aa bb" ocupa 27 de 100; a palavra seguinte (96) nao cabe. Justificar
  // abriria um vao de 73 pt entre "aa" e "bb".
  const linhas = quebrarEmLinhas(palavrasDoTexto("aa bb cccccccccccccccc dd", MONO), 100, MONO, true);
  assert.equal(textoDe(linhas[0].palavras[1]), "bb");
  assert.equal(linhas[0].extraPorEspaco, 0);

  // Com folga pequena, justifica normalmente: 4 palavras de 5 caracteres =
  // 120 + 9 de espacos = 129 numa linha de 133 -> 4/3 pt a mais por vao.
  const justas = quebrarEmLinhas(palavrasDoTexto("aaaaa bbbbb ccccc ddddd eeeeeeeeeeeeeeeeeeee", MONO), 133, MONO, true);
  assert.equal(justas[0].palavras.length, 4);
  assert.ok(Math.abs(justas[0].extraPorEspaco - 4 / 3) < 1e-6);
});

test("R$ e o valor nunca se separam na quebra de linha, em nenhuma largura", () => {
  const texto = "no valor total de R$ 1.500,00 (mil e quinhentos reais), pago conforme o art. 10, § 2º, da lei";
  // A partir de 63, a largura de "R$ 1.500,00" nesta fonte de mentira: abaixo
  // disso nem a palavra colada cabe, e ela e partida como qualquer palavra longa.
  for (let largura = 63; largura <= 400; largura += 3) {
    const linhas = quebrarEmLinhas(palavrasDoTexto(texto, MONO), largura, MONO, true);
    for (const linha of linhas) {
      const ultima = textoDe(linha.palavras[linha.palavras.length - 1]);
      assert.ok(!["R$", "art.", "§"].includes(ultima), `largura ${largura}: linha terminou em "${ultima}"`);
    }
    const palavras = linhas.flatMap((l) => l.palavras.map(textoDe));
    assert.ok(palavras.includes("R$ 1.500,00"), `largura ${largura}: ${palavras.join(" | ")}`);
  }
});

test("a cola só vale antes de número: 'Cláusula 7' não se separa, 'a cláusula prevalece' quebra normalmente", () => {
  const palavras = palavrasDoTexto("conforme a Cláusula 7, esta cláusula prevalece; ver § 2º e art. 10", MONO).map(textoDe);
  assert.ok(palavras.includes("Cláusula 7,"));
  assert.ok(palavras.includes("cláusula") && palavras.includes("prevalece;"));
  assert.ok(palavras.includes("§ 2º") && palavras.includes("art. 10"));
});

/** O texto de volta a partir das linhas: espaco entre palavras, nada antes de um pedaco de palavra partida. */
function textoDasLinhas(linhas: readonly LinhaDiagramada[]): string[] {
  return linhas.map((l) => l.palavras.map((p, i) => (i > 0 && !p.continuacao ? " " : "") + textoDe(p)).join(""));
}

test("e-mail de 80 caracteres sem espaço é partido antes do @ ou do ponto, e cada linha cabe na largura", () => {
  const largura = 200;
  const texto = `com endereço eletrônico ${EMAIL_80}, que declara ser maior de idade`;
  const linhas = quebrarEmLinhas(palavrasDoTexto(texto, MONO), largura, MONO, true);
  const textos = textoDasLinhas(linhas);

  for (const linha of linhas) assert.ok(linha.larguraNatural <= largura + 1e-6, "linha passou da largura");
  // Religadas, as linhas sao o texto original: nenhum caractere perdido, nenhum hifen inventado.
  const religado = textos.reduce((acc, t, i) => acc + (i > 0 && !linhas[i].palavras[0].continuacao ? " " : "") + t, "");
  assert.equal(religado, texto);
  // Onde o e-mail foi partido, a linha seguinte comeca pelo separador: e ele que diz "continua".
  const continuacoes = linhas.filter((l) => l.palavras[0].continuacao);
  assert.ok(continuacoes.length >= 1);
  for (const l of continuacoes) assert.match(textoDe(l.palavras[0]), /^[@./_-]/);
});

test("pedaço sem separador que ainda não cabe na linha é partido por caractere", () => {
  const longa = "x".repeat(100); // 600 pt na fonte de mentira
  const linhas = quebrarEmLinhas(palavrasDoTexto(`antes ${longa} depois`, MONO), 200, MONO, true);
  for (const linha of linhas) assert.ok(linha.larguraNatural <= 200 + 1e-6);
  assert.equal(textoDasLinhas(linhas).join("").replace(/\s+/g, ""), `antes${longa}depois`);
});

test("negrito na mesma linha: o rótulo sai em negrito e a pontuação colada ao negrito fica na mesma palavra", () => {
  const palavras = palavrasDoTexto("**CONTRATANTE:** Beatriz, conforme a Cláusula **7**.", MONO);
  assert.deepEqual(palavras[0].fragmentos, [{ texto: "CONTRATANTE:", peso: "negrito" }]);
  assert.deepEqual(palavras[1].fragmentos, [{ texto: "Beatriz,", peso: "regular" }]);
  const ultima = palavras[palavras.length - 1];
  assert.deepEqual(ultima.fragmentos, [
    { texto: "Cláusula ", peso: "regular" },
    { texto: "7", peso: "negrito" },
    { texto: ".", peso: "regular" },
  ]);
});

test("emoji, soft hyphen e espaço duro não viram quadradinho nem partem a palavra", () => {
  const palavras = palavrasDoTexto(`o brinde ${EMOJI} da recep${SOFT_HYPHEN}ção${NBSP}principal`, MONO);
  assert.deepEqual(palavras.map(textoDe), ["o", "brinde", "da", "recepção", "principal"]);
});

// ------------------------------------------------------------ PDF real --

test("gera o contrato completo: reabre com o pdf-lib e o número de páginas bate", async () => {
  const r = await renderCasamento();
  if (process.env.CONTRATO_AMOSTRA) await writeFile(process.env.CONTRATO_AMOSTRA, r.bytes);

  const doc = await PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(), r.paginas);
  assert.ok(r.paginas >= 3 && r.paginas <= 8, `${r.paginas} páginas`);
  for (const pagina of doc.getPages()) {
    const { width, height } = pagina.getSize();
    assert.ok(Math.abs(width - 595.28) < 0.01 && Math.abs(height - 841.89) < 0.01, "a página é A4");
  }
});

test("a fonte da marca vai embutida no PDF (não cai no Helvetica) e o arquivo fica abaixo de 400 kB", async () => {
  const r = await renderCasamento();
  assert.equal(r.usouFallbackDeFonte, false);
  const bruto = Buffer.from(r.bytes).toString("latin1");
  assert.match(bruto, /\/FontFile2/);
  assert.match(bruto, /DMSans-Regular/);
  assert.match(bruto, /DMSans-Bold/);
  assert.doesNotMatch(bruto, /\/Helvetica/);
  assert.ok(r.bytes.length < 400_000, `${Math.round(r.bytes.length / 1024)} kB`);
});

test("metadados: título, autoria e idioma do documento", async () => {
  const doc = await PDFDocument.load((await renderCasamento()).bytes, { updateMetadata: false });
  assert.equal(doc.getTitle(), "Contrato de prestação de serviços de storymaker");
  assert.equal(doc.getAuthor(), "Mel Simão | Storymaker");
  assert.equal(doc.getCreator(), "Sistema Mel");
  assert.equal(doc.getProducer(), "Sistema Mel");
  assert.equal(doc.getCreationDate()?.toISOString(), "2026-09-29T15:00:00.000Z");
  assert.match(doc.getKeywords() ?? "", /modelo 2026-09-29/);
});

test("o texto lido de volta tem numeração, remissões resolvidas e nenhuma marcação sobrando", async () => {
  const r = await renderCasamento();
  const paginas = await lerPdf(r.bytes);
  assert.equal(paginas.length, r.paginas);
  const tudo = paginas.map((p) => p.texto).join(" ");

  assert.match(tudo, /^CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE STORYMAKER/);
  assert.ok(tudo.includes("CLÁUSULA 1 - DO OBJETO DO CONTRATO"));
  assert.ok(tudo.includes("CLÁUSULA 17 - DO FORO"));
  // "direitos" e a 10a clausula, "pagamento" a 7a, "equipe" a 14a, "adicionais" a 4a.
  assert.ok(tudo.includes("nos termos da Cláusula 10."), "remissão do anuente / armazenamento");
  assert.ok(tudo.includes("10.1. Os direitos autorais"));
  assert.ok(tudo.includes("13.1. Em caso de desistência"));
  assert.ok(tudo.includes("sinal previsto na Cláusula 7 não será reembolsado"));
  assert.ok(tudo.includes("fora das hipóteses da Cláusula 14,"));
  assert.ok(tudo.includes("descritos na Cláusula 4."));
  assert.ok(tudo.includes("R$ 2.480,00 (dois mil quatrocentos e oitenta reais)"));
  // O e-mail longo e partido entre linhas; sem os espacos da juncao das
  // linhas, ele tem de estar inteiro, sem caractere perdido nem hifen inventado.
  assert.ok(tudo.replace(/\s+/g, "").includes(`endereçoeletrônico${EMAIL_80},quedeclara`));

  for (const proibido of ["{{", "}}", "**", "undefined", "NaN", "null"]) {
    assert.ok(!tudo.includes(proibido), `"${proibido}" apareceu no PDF`);
  }
});

test("rodapé 'Página X de Y' em todas as páginas", async () => {
  const r = await renderCasamento();
  const paginas = await lerPdf(r.bytes);
  for (const pagina of paginas) {
    const rodape = pagina.linhas.filter(ehRodape);
    assert.deepEqual(
      rodape.map((l) => l.texto),
      [`Página ${pagina.numero} de ${r.paginas}`],
    );
    // E ele e a ultima coisa da pagina.
    assert.ok(ehRodape(pagina.linhas[pagina.linhas.length - 1]));
  }
});

test("nenhum texto sai das margens, nem o e-mail de 80 caracteres sem espaço", async () => {
  for (const r of [await renderCasamento(), await renderCorporativo()]) {
    for (const pagina of await lerPdf(r.bytes)) {
      for (const item of pagina.itens) {
        const onde = `página ${pagina.numero}, "${item.str}"`;
        assert.ok(item.x >= G.margemLateral - TOLERANCIA, `saiu pela esquerda: ${onde}`);
        assert.ok(item.x + item.largura <= MARGEM_DIREITA + TOLERANCIA, `saiu pela direita: ${onde}`);
        if (/^Página \d+ de \d+$/.test(item.str.trim())) continue;
        assert.ok(item.y >= G.margemBase - TOLERANCIA, `desceu até o rodapé: ${onde}`);
        assert.ok(item.y <= G.alturaPagina - G.margemTopo, `subiu acima da margem: ${onde}`);
      }
    }
  }
});

test("emoji e soft hyphen não derrubam a geração nem aparecem no PDF", async () => {
  const tudo = (await lerPdf((await renderCasamento()).bytes)).map((p) => p.texto).join(" ");
  assert.ok(tudo.includes("o brinde dos padrinhos"), "o emoji sumiu sem deixar espaço duplo");
  assert.ok(tudo.includes("endereço da recepção e dentro do período contratado"), "a palavra do soft hyphen saiu inteira");
  assert.ok(!tudo.includes(EMOJI));
  assert.ok(!tudo.includes(SOFT_HYPHEN));
});

test("item 'A.' fica pendurado: a letra na margem e o texto alinhado depois dela", async () => {
  const paginas = await lerPdf((await renderCasamento()).bytes);
  const marcadores = paginas.flatMap((p) => p.itens.filter((i) => /^[A-C]\.$/.test(i.str.trim())));
  assert.ok(marcadores.length >= 8, `achei ${marcadores.length} marcadores`);
  for (const m of marcadores) assert.ok(Math.abs(m.x - G.margemLateral) < TOLERANCIA, `"${m.str}" fora da margem`);
});

test("posições de assinatura: uma por assinante, na ordem, dentro da área útil e todas na última página", async () => {
  for (const [render, papeis] of [
    [renderCasamento, ["contratante", "contratada", "anuente"]],
    [renderCorporativo, ["contratante", "contratada"]],
  ] as const) {
    const r = await render();
    assert.deepEqual(
      r.posicoes.map((p) => p.papel),
      papeis,
    );
    for (const p of r.posicoes) {
      assert.equal(p.pagina, r.paginas, `${p.papel} fora da última página`);
      assert.equal(p.largura, 200);
      assert.equal(p.altura, 40);
      assert.ok(p.x >= G.margemLateral && p.x + p.largura <= MARGEM_DIREITA, `${p.papel}: x fora`);
      assert.ok(p.yTopo >= G.margemTopo && p.yTopo + p.altura <= G.alturaPagina - G.margemBase, `${p.papel}: y fora`);
    }
    // Nenhum campo sobre o outro.
    for (const [i, a] of r.posicoes.entries()) {
      for (const b of r.posicoes.slice(i + 1)) {
        const separados =
          a.x + a.largura <= b.x || b.x + b.largura <= a.x || a.yTopo + a.altura <= b.yTopo || b.yTopo + b.altura <= a.yTopo;
        assert.ok(separados, `${a.papel} e ${b.papel} se sobrepõem`);
      }
    }
  }
});

test("cada campo de assinatura fica logo acima do rótulo do seu assinante, sob a mesma coluna", async () => {
  const r = await renderCasamento();
  const paginas = await lerPdf(r.bytes);
  const ultima = paginas[paginas.length - 1];
  const rotulos: Record<string, string> = { contratante: "CONTRATANTE", contratada: "CONTRATADA", anuente: "ANUENTE" };

  for (const p of r.posicoes) {
    // Origem no topo -> origem na base, a mesma conversao do pdf.ts.
    const baseDoCampo = G.alturaPagina - (p.yTopo + p.altura);
    const rotulo = ultima.itens.find(
      (i) =>
        i.str.trim() === rotulos[p.papel] &&
        i.x >= p.x &&
        i.x + i.largura <= p.x + p.largura &&
        i.y < baseDoCampo &&
        baseDoCampo - i.y < 30,
    );
    assert.ok(rotulo, `rótulo de ${p.papel} não está logo abaixo do campo`);
  }
  // A CONTRATADA assina ao lado da CONTRATANTE; o ANUENTE, embaixo, à esquerda.
  const [contratante, contratada, anuente] = r.posicoes;
  assert.equal(contratante.yTopo, contratada.yTopo);
  assert.ok(contratada.x > contratante.x);
  assert.equal(anuente.x, contratante.x);
  assert.ok(anuente.yTopo > contratante.yTopo + contratante.altura);
});

test("CONTRATANTE PJ: o documento é partido no travessão, uma linha para o CNPJ e outra para o representante", async () => {
  const ultima = (await lerPdf((await renderCorporativo()).bytes)).at(-1)!;
  const linhas = ultima.linhas.map((l) => l.texto);
  assert.ok(linhas.some((l) => l.includes("CNPJ: 41.827.053/0001-68")));
  assert.ok(linhas.some((l) => l.startsWith("p. Ricardo Menezes Prado,")));
  // "CPF:" nunca fica no fim de uma linha longe do numero.
  assert.ok(linhas.some((l) => l.includes("CPF: 276.481.053-90")));
  assert.ok(!linhas.some((l) => l.includes("—")), "sobrou um travessão solto");
});

test("paginação em qualquer ponto de quebra: título nunca sozinho no pé, e o foro, o 'local e data' e as assinaturas sempre juntos", async () => {
  // Um paragrafo de enchimento no objeto empurra o resto do contrato de
  // pouco em pouco (~1 linha a cada 13 palavras): ao longo da varredura, cada
  // titulo de clausula passa por cada altura da pagina.
  for (let enchimento = 0; enchimento <= 13 * 42; enchimento += 13) {
    const r = await renderizarContrato(contratoFicticio({ enchimento }));
    const paginas = await lerPdf(r.bytes);
    const onde = `enchimento ${enchimento}`;

    for (const pagina of paginas.slice(0, -1)) {
      const corpo = pagina.linhas.filter((l) => !ehRodape(l));
      const ultimaLinha = corpo[corpo.length - 1];
      assert.doesNotMatch(ultimaLinha.texto, /^CLÁUSULA \d+ -/, `${onde}: título sozinho no pé da página ${pagina.numero}`);
    }

    const ultima = paginas[paginas.length - 1];
    assert.ok(ultima.texto.includes("CLÁUSULA 17 - DO FORO"), `${onde}: o foro ficou longe das assinaturas`);
    assert.ok(ultima.texto.includes("Campinas/SP, na data da última assinatura eletrônica"), `${onde}: local e data`);
    for (const nome of ["Beatriz Fontes Carvalho", "Mellayne Simão Sabino", "João Henrique Albuquerque Neto"]) {
      assert.ok(ultima.texto.includes(nome), `${onde}: ${nome} fora da última página`);
    }
    for (const p of r.posicoes) assert.equal(p.pagina, r.paginas, `${onde}: ${p.papel}`);
  }
});

test("remissão para cláusula que não existe recusa a geração, em vez de imprimir 'Cláusula {{ref:x}}'", async () => {
  const doc = contratoFicticio();
  const semDireitos = { ...doc, clausulas: doc.clausulas.filter((c) => c.id !== "direitos") };
  await assert.rejects(renderizarContrato(semDireitos), (e: unknown) => {
    assert.ok(e instanceof ReferenciaInvalidaError);
    assert.equal(e.id, "direitos");
    return true;
  });
});

test("** sem par ou {{ sobrando recusam a geração, dizendo em que cláusula está o problema", async () => {
  const doc = contratoFicticio();
  const comNegritoAberto = structuredClone(doc);
  comNegritoAberto.clausulas[7].paragrafos[0] += " **sem fechar";
  await assert.rejects(renderizarContrato(comNegritoAberto), (e: unknown) => {
    assert.ok(e instanceof MarcacaoInvalidaError);
    assert.match(e.message, /^Cláusula 8:/);
    return true;
  });

  const comChave = structuredClone(doc);
  comChave.clausulas[1].paragrafos[0] = "Data do evento: {{data}};";
  await assert.rejects(renderizarContrato(comChave), MarcacaoInvalidaError);

  const numeroForaDeClausula = structuredClone(doc);
  numeroForaDeClausula.preambulo += " Ver {{n}}.";
  await assert.rejects(renderizarContrato(numeroForaDeClausula), MarcacaoInvalidaError);
});
