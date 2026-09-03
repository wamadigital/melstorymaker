import arvoreJson from "./arvore.json";
import {
  IDADE_MAXIMA_INFANTIL,
  type Arvore,
  type Categoria,
  type Opcao,
  type OpcaoBruta,
  type Passo,
  type Respostas,
  type TemplateId,
} from "./types";

export const arvore = arvoreJson as unknown as Arvore;

/**
 * O arvore.json mistura duas formas de opcao: a pergunta de categoria usa
 * objetos {valor, rotulo} e as perguntas dentro de `fluxos` usam strings puras.
 * Renderizar sem normalizar quebra as telas de making_of e entrega.
 */
export function normalizarOpcoes(opcoes: OpcaoBruta[] | undefined): Opcao[] {
  if (!opcoes) return [];
  return opcoes.map((o) => (typeof o === "string" ? { valor: o, rotulo: o } : o));
}

/** A escolha de categoria como um Passo, para o renderizador tratar tudo igual. */
export function passoCategoria(): Passo {
  return {
    id: "categoria",
    tipo: "escolha_unica",
    pergunta: arvore.categoria.pergunta,
    opcoes: arvore.categoria.opcoes,
    obrigatorio: true,
  };
}

function condicaoAtendida(passo: Passo, respostas: Respostas): boolean {
  if (!passo.exibir_se) return true;
  return Object.entries(passo.exibir_se).every(([chave, valor]) => respostas[chave] === valor);
}

/**
 * A fila completa de passos da categoria, na ordem das telas e sem filtrar
 * ramificacao: contato.abertura, fluxo da categoria, contato.fechamento.
 *
 * A ordem sai inteira do arvore.json -- nenhum id aparece hardcoded aqui. Por
 * isso `contato` e um par de listas e nao uma lista so: e o JSON que diz que o
 * WhatsApp abre o formulario e o e-mail fecha.
 */
function sequencia(categoria: Categoria): Passo[] {
  return [
    ...arvore.contato.abertura,
    ...(arvore.fluxos[categoria] ?? []),
    ...arvore.contato.fechamento,
  ];
}

/**
 * Passos de pergunta na ordem das telas, com `exibir_se` resolvido.
 * Boas-vindas, escolha de categoria e confirmacao sao telas proprias, fora
 * desta lista.
 *
 * Recalcular a cada resposta e obrigatorio: responder making_of = "Nao" remove
 * um passo do total e o denominador do progresso muda junto.
 */
export function passosVisiveis(categoria: Categoria, respostas: Respostas): Passo[] {
  return sequencia(categoria).filter((p) => condicaoAtendida(p, respostas));
}

/** Todos os ids que a categoria pode ter, incluindo os escondidos por ramificacao. */
export function idsValidos(categoria: Categoria): Set<string> {
  return new Set(sequencia(categoria).map((p) => p.id));
}

export function passoPorId(categoria: Categoria, id: string): Passo | undefined {
  return sequencia(categoria).find((p) => p.id === id);
}

export function proximoPasso(
  categoria: Categoria,
  respostas: Respostas,
  idAtual: string,
): Passo | undefined {
  const passos = passosVisiveis(categoria, respostas);
  const i = passos.findIndex((p) => p.id === idAtual);
  return i === -1 ? passos[0] : passos[i + 1];
}

export function passoAnterior(
  categoria: Categoria,
  respostas: Respostas,
  idAtual: string,
): Passo | undefined {
  const passos = passosVisiveis(categoria, respostas);
  const i = passos.findIndex((p) => p.id === idAtual);
  return i <= 0 ? undefined : passos[i - 1];
}

/** Posicao 1-based e total, para a barra de progresso. */
export function progresso(
  categoria: Categoria,
  respostas: Respostas,
  idAtual: string,
): { atual: number; total: number } {
  const passos = passosVisiveis(categoria, respostas);
  const i = passos.findIndex((p) => p.id === idAtual);
  return { atual: i === -1 ? 1 : i + 1, total: passos.length };
}

/**
 * Remove respostas de passos que deixaram de ser visiveis. Sem isso, trocar
 * making_of de "Sim" para "Nao" deixa um local_making_of fantasma no jsonb, que
 * reaparece no painel da Mel e pode ir parar no PDF.
 */
export function limparRespostasOrfas(categoria: Categoria, respostas: Respostas): Respostas {
  const visiveis = new Set(passosVisiveis(categoria, respostas).map((p) => p.id));
  const limpo: Respostas = {};
  for (const [chave, valor] of Object.entries(respostas)) {
    if (visiveis.has(chave)) limpo[chave] = valor;
  }
  return limpo;
}

/**
 * Qual arte o PDF usa, ou `null` quando nao da para decidir.
 *
 * NAO e a mesma coisa que a categoria: `aniversario` e uma categoria so no
 * banco, mas resolve entre duas artes conforme a idade. Separar os conceitos e
 * o que permite acrescentar arte sem tocar no enum do Postgres.
 *
 * Devolve `null` -- em vez de escolher uma arte padrao -- quando a idade falta
 * ou nao e numero. Chutar aqui produziria uma proposta com a arte errada, que
 * e pior do que nao produzir proposta nenhuma: a Mel so descobriria depois de
 * enviar. Quem chama decide o que fazer com o null; na geracao, e erro.
 */
export function resolverTemplateId(categoria: Categoria, respostas: Respostas): TemplateId | null {
  if (categoria !== "aniversario") return categoria;

  const bruto = (respostas.idade ?? "").trim();
  if (!/^\d+$/.test(bruto)) return null;

  return Number.parseInt(bruto, 10) <= IDADE_MAXIMA_INFANTIL
    ? "aniversario_infantil"
    : "aniversario_adulto";
}

/**
 * Data minima para o input, em ISO local. `new Date().toISOString()` daria a
 * data em UTC e, depois das 21h no horario de Brasilia, ja seria "amanha".
 */
export function dataMinima(passo: Passo, hoje = new Date()): string | undefined {
  // `min` tambem carrega numero (tipo "numero"); aqui so interessa string.
  if (typeof passo.min === "number") return undefined;
  if (passo.min !== "hoje") return passo.min;
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
