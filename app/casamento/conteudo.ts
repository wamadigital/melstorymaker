// O que a LP `/casamento` afirma sobre o serviço, montado a partir das MESMAS
// fontes que a proposta e o contrato usam. Roda só no servidor (a página é
// server component): para as ilhas do navegador descem apenas strings.
//
// Por que não escrever os pacotes à mão na página: o texto dos pacotes já
// existe palavra por palavra em `itensArte` (é o que o lead lê na proposta), e
// os prazos já existem como número no `escopo` (é o que o contrato garante).
// Uma terceira cópia na LP divergiria no primeiro ajuste.
import { pacoteDoCatalogo, catalogoDaArte } from "@/lib/contrato/catalogo";
import { pagamentoDoPreset } from "@/lib/contrato/pagamento";
import type { Escopo } from "@/lib/contrato/tipos";

/**
 * O título da página. Mora aqui porque a imagem de compartilhamento
 * (`scripts/lp-og.tsx`) desenha a mesma frase: escrito em dois lugares, o
 * link no WhatsApp prometeria uma coisa e a página abriria com outra.
 */
export const TITULO_LP = "Seu casamento em vídeos para guardar e rever.";

/**
 * "Mais de 100 celebrações registradas", afirmado pelo owner em 03/10/2026
 * (todas as categorias, não só casamento). É o único número da LP que não sai
 * do contrato, do catálogo ou dos Reels: mudou, muda aqui.
 */
export const CELEBRACOES_MAIS_DE = 100;

export type PacoteLp = {
  nome: string;
  /** O selo da arte do Principal ("o + contratado pelos noivos"), encurtado a pedido do owner (03/10/2026). */
  selo: string | null;
  /** A frase que diferencia os dois: QUANDO os stories vão ao ar. */
  destaque: string;
  itens: string[];
  /** Prazos de entrega, com os números do contrato. */
  prazo: string;
};

const PACOTES_LP = [
  { nome: "Pacote Principal", selo: "O mais contratado" },
  { nome: "Pacote Real Time", selo: null },
] as const;

const dias = (n: number) => `${n} ${n === 1 ? "dia útil" : "dias úteis"}`;

/**
 * Quando os stories vão ao ar. No Real Time é durante a festa (a cláusula de
 * condições técnicas garante até 48 h se a internet do local falhar, e o FAQ
 * diz isso); no Principal, o prazo de stories do contrato.
 */
export function destaqueDoEscopo(e: Escopo): string {
  return e.tempoReal ? "Stories publicados durante a festa" : `Stories publicados em até ${dias(e.diasStories)}`;
}

/**
 * Os prazos pelo CONTRATO, e não pela arte.
 *
 * A arte diz "Edição e entrega da cobertura em até 5 dias úteis" para tudo,
 * mas o escopo do contrato dá 5 dias para os stories e 7 para o Reels e o
 * material completo. Numa página de anúncio a oferta vincula (CDC art. 30):
 * prometer 5 aqui seria prometer o que o contrato não dá.
 */
export function prazoDoEscopo(e: Escopo): string {
  const stories = e.tempoReal
    ? `Stories no mesmo dia (sem internet no local, em até ${condicoesDaLp().horasSemInternet} horas)`
    : `Stories em até ${dias(e.diasStories)}`;
  const resto =
    e.diasReels === e.diasMaterial
      ? `Reels e todo o material no Drive em até ${dias(e.diasReels)}`
      : `Reels em até ${dias(e.diasReels)} e todo o material no Drive em até ${dias(e.diasMaterial)}`;
  return `${stories}. ${resto}.`;
}

/**
 * Bullets da arte que entram na LP: todos menos o de prazo ("Edição e entrega
 * ..."), que sai de `prazoDoEscopo`. Sem o ponto final do desenho da arte.
 */
function itensSemPrazo(itensArte: readonly string[]): string[] {
  return itensArte
    .filter((item) => !/^Edição e entrega/i.test(item))
    .map((item) => item.replace(/\.$/, ""));
}

export function pacotesDaLp(): PacoteLp[] {
  return PACOTES_LP.map(({ nome, selo }) => {
    const pacote = pacoteDoCatalogo("casamento", nome);
    if (!pacote) throw new Error(`Pacote "${nome}" sumiu do catálogo de casamento.`);
    return {
      nome: pacote.nome,
      selo,
      destaque: destaqueDoEscopo(pacote.escopo),
      itens: itensSemPrazo(pacote.itensArte),
      prazo: prazoDoEscopo(pacote.escopo),
    };
  });
}

/**
 * Os adicionais do casamento, só o NOME (sem preço, regra 6). Making of usa a
 * forma do contrato ("Making of da noiva"), que lê melhor que o "Making Of
 * Noiva" da arte; o resto usa o nome da arte.
 */
export function adicionaisDaLp(): string[] {
  // Só os da arte do casamento: o catálogo também devolve a locomoção e o
  // "Outro serviço", que valem para toda arte e não são opção para o lead.
  return catalogoDaArte("casamento")
    .adicionais.filter((a) => a.id.startsWith("casamento."))
    .map((a) => (a.tipo === "making_of" ? a.descricaoContrato : a.nome));
}

/**
 * Os números das garantias e do FAQ, num lugar só.
 *
 * Reserva e prazo do saldo saem do modelo de pagamento padrão do contrato
 * ("30/70", o das artes). Os outros são cópia de cláusulas que guardam o
 * número dentro do texto (`clausulas.ts`); o `conteudo.test.ts` confere cada
 * um contra esse texto, para que mudar a cláusula sem mudar a LP quebre o
 * teste -- a oferta da página vincula (CDC art. 30).
 */
export function condicoesDaLp() {
  const { parcelas } = pagamentoDoPreset("30/70");
  const sinal = parcelas.find((p) => p.sinal);
  const saldo = parcelas.find((p) => !p.sinal);
  if (!sinal || !saldo || saldo.vencimento.tipo !== "dias_antes") {
    throw new Error("O modelo 30/70 mudou de forma: revise as condições da LP.");
  }
  return {
    reservaPct: sinal.percentual,
    diasAntesSaldo: saldo.vencimento.dias,
    /** Real Time sem internet no local (cláusula de condições técnicas). */
    horasSemInternet: 48,
    /** Link do material no ar (cláusula de armazenamento). */
    mesesDrive: 6,
    /** Correção de erro da Mel, sem custo (cláusula das alterações). */
    diasCorrecao: 5,
    /** Devolução quando ninguém da equipe pode ir (cláusula da equipe). */
    diasDevolucao: 10,
  };
}

/** Os prazos que o FAQ cita, dos mesmos escopos dos pacotes. */
export function prazosDoFaq() {
  const principal = pacoteDoCatalogo("casamento", "Pacote Principal")!.escopo;
  const realTime = pacoteDoCatalogo("casamento", "Pacote Real Time")!.escopo;
  return {
    /**
     * O Reels de resumo e o material no Drive, numa frase só para os dois
     * pacotes: o MAIOR dos prazos, porque "em até N" com o menor seria falso
     * para quem contratou o outro.
     */
    entregaDrive: dias(Math.max(principal.diasReels, realTime.diasReels, principal.diasMaterial, realTime.diasMaterial)),
    horasCobertura: Math.round(principal.minutosCobertura / 60),
  };
}

/**
 * "(19) 99280-8396" a partir do `MEL_WHATSAPP` (só dígitos, com DDI). O mesmo
 * número que o link usa: o rodapé nunca mostra um telefone e liga para outro.
 */
export function telefoneLegivel(digitos: string): string {
  const nacional = digitos.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const m = /^(\d{2})(\d{4,5})(\d{4})$/.exec(nacional);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : digitos;
}
