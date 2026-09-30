// Montagem do contrato: dos DADOS que a Mel confirmou no painel ao DOCUMENTO
// pronto para ler, editar e renderizar.
//
// Tudo aqui e deterministico e testado (decisao 2 do SPEC): quais clausulas
// entram e em que ordem, o escopo efetivo (pacote + adicionais), o total, as
// parcelas, e os avisos que o proprio sistema sabe dar. A IA so entra com a
// clausula de condicoes especiais, que chega pronta em `condicoesEspeciais` e
// e conferida aqui por `validarTextoIa` antes de virar clausula.
//
// Os paragrafos saem com `{{n}}`/`{{ref:id}}` NAO resolvidos: a numeracao e
// calculada na leitura (validar.ts) e na renderizacao, porque a Mel pode
// remover ou acrescentar clausulas no editor depois daqui.
//
// Faltou dado? `montarContrato` lanca `CamposFaltandoContratoError` com a
// lista, e a rota devolve 422 -- mesma filosofia do `CamposFaltandoError` da
// proposta (gotcha 5b do CLAUDE.md): contrato com buraco onde deveria estar o
// CPF e pior que contrato nenhum.
//
// Puro e sem "server-only": o painel usa `faltantes`, `totalContrato` e
// `escopoEfetivo` ao vivo, enquanto a Mel preenche.

import type { Categoria, TemplateId } from "@/lib/form/types";
import { anoDoEvento, resolverTabelaPreco } from "@/lib/pdf/precos";
import {
  documentoContratoSchema,
  type Adicional,
  type Aviso,
  type Clausula,
  type DadosContrato,
  type DocumentoContrato,
  type EscopoEfetivo,
  type Servico,
} from "@/lib/contrato/tipos";
import {
  adicionalDoCatalogo,
  adicionalPorId,
  precoPacote,
  valorCatalogoAdicional,
} from "@/lib/contrato/catalogo";
import { formatarReais } from "@/lib/contrato/extenso";
import { somenteDigitos, validarCep, validarCnpj, validarCpf, validarEmail } from "@/lib/contrato/documento";
import { calcularParcelas, dataISOValida, diaDoCalendario, validarPagamento, valorSinal } from "@/lib/contrato/pagamento";
import { ehEventoDeMenor, MAIORIDADE } from "@/lib/contrato/regras";
import { normalizarComparacao } from "@/lib/contrato/texto";
import {
  adicionalIndicaSegundaPessoa,
  assinaturasDoContrato,
  clausulaAdicionais,
  clausulaAlimentacao,
  clausulaAlteracoes,
  clausulaArmazenamento,
  clausulaAssinaturaEletronica,
  clausulaCondicoesEspeciais,
  clausulaCondicoesTecnicas,
  clausulaDesistencia,
  clausulaDireitos,
  clausulaEntrega,
  clausulaEquipe,
  clausulaForo,
  clausulaInstagram,
  clausulaLocal,
  clausulaObjeto,
  clausulaPagamento,
  clausulaPrazos,
  clausulaServicos,
  LOCAL_DATA,
  partesDoContrato,
  preambuloDoContrato,
  quantidadeMakingOfs,
  TITULO_CONTRATO,
  VERSAO_MODELO,
  type AdicionalRedacao,
  type BaseRedacao,
  type UnidadeAdicional,
} from "@/lib/contrato/clausulas";
import { validarTextoIa } from "@/lib/contrato/validar";

/**
 * O que a montagem precisa saber do LEAD, alem dos dados do contrato.
 * `ContextoLead` (regras.ts) com `templateId` resolvido satisfaz este tipo.
 */
export type ContextoMontagem = {
  categoria: Categoria;
  /** A arte (para o catalogo). Aniversario sem idade nao tem arte: quem chama pede a idade, nunca chuta. */
  templateId: TemplateId;
  idadeHomenageado: number | null;
  /** "AAAA-MM-DD" em America/Sao_Paulo, calculado no servidor (`hojeEmSaoPaulo`). */
  hojeISO: string;
  /** A entrega que o lead pediu no formulario ("Em tempo real"). So alimenta um aviso. */
  entregaSolicitada?: string;
};

/**
 * Dados insuficientes para montar. `campos` e a lista humana que o painel
 * mostra (422). A mensagem do erro so diz QUANTOS: a lista pode citar o nome
 * do homenageado ou uma descricao digitada, e mensagem de erro costuma parar
 * em log.
 */
export class CamposFaltandoContratoError extends Error {
  constructor(readonly campos: string[]) {
    super(`Faltam ${campos.length} dado(s) para montar o contrato.`);
    this.name = "CamposFaltandoContratoError";
  }
}

// ---------------------------------------------------------- escopo e total --

/**
 * Unidade de cobranca do adicional: por hora, por unidade ou valor fechado.
 *
 * Primeiro o catalogo da arte do contrato; depois o item pelo id em qualquer
 * arte (a unidade e do ITEM vendido: o storymaker por hora do infantil segue
 * por hora se a arte do lead mudou); por fim, pelo tipo.
 */
export function unidadeDoAdicional(a: Pick<Adicional, "id" | "tipo">, templateId?: TemplateId): UnidadeAdicional {
  const doCatalogo = (templateId ? adicionalDoCatalogo(templateId, a.id) : null) ?? adicionalPorId(a.id);
  if (doCatalogo) return doCatalogo.unidade;
  if (a.tipo === "hora_adicional") return "hora";
  if (a.tipo === "reels" || a.tipo === "trend") return "unidade";
  return null;
}

/**
 * O escopo com os adicionais somados -- o que de fato vai ser entregue.
 *
 * - hora adicional: soma `quantidade × 60` minutos a cobertura;
 * - making of: soma a duracao (× quantidade) ao making of;
 * - storymaker adicional POR EVENTO: a equipe passa a ter pelo menos 2
 *   pessoas, a cobertura inteira;
 * - storymaker adicional POR HORA: `quantidade × 60` minutos de auxiliar
 *   (`minutosAuxiliar`). So vira equipe de 2 se as horas cobrirem a
 *   cobertura inteira; antes disso, o texto diz "por até N horas";
 * - entrega em tempo real: a cobertura vira tempo real.
 *
 * Reels e trend adicionais NAO entram aqui: aparecem na clausula dos
 * adicionais, e o objeto continua descrevendo o pacote.
 *
 * Caso de borda assumido: equipe de 2 no pacote MAIS storymaker por hora. O
 * texto descreve a equipe de tempo integral, e o auxiliar por hora aparece na
 * clausula dos adicionais, a que o objeto remete.
 *
 * `templateId` e opcional (o painel chama sem): serve so para achar a
 * unidade do adicional, que tambem se acha pelo id.
 *
 * Nao altera `servico.escopo` (o que a Mel confirmou para o pacote): devolve
 * um objeto novo.
 */
export function escopoEfetivo(servico: Servico, templateId?: TemplateId): EscopoEfetivo {
  const e: EscopoEfetivo = {
    ...servico.escopo,
    reels: [...servico.escopo.reels],
    extras: [...servico.escopo.extras],
    minutosAuxiliar: 0,
  };
  let auxiliarNoEventoInteiro = false;
  let minutosAuxiliarPorHora = 0;
  for (const a of servico.adicionais) {
    switch (a.tipo) {
      case "hora_adicional":
        e.minutosCobertura += a.quantidade * 60;
        break;
      case "making_of":
        e.minutosMakingOf += a.minutos * a.quantidade;
        break;
      case "storymaker":
        if (unidadeDoAdicional(a, templateId) === "hora") minutosAuxiliarPorHora += a.quantidade * 60;
        else auxiliarNoEventoInteiro = true;
        break;
      case "tempo_real":
        e.tempoReal = true;
        break;
      default:
        break;
    }
  }
  // Depois do laco: a hora adicional pode vir depois do storymaker na lista,
  // e "cobre a cobertura inteira" e contra a cobertura ja somada.
  if (auxiliarNoEventoInteiro || (minutosAuxiliarPorHora > 0 && minutosAuxiliarPorHora >= e.minutosCobertura)) {
    e.storymakers = Math.max(2, e.storymakers);
  }
  e.minutosAuxiliar = e.storymakers >= 2 ? e.minutosCobertura : minutosAuxiliarPorHora;
  return e;
}

/** Centavos: pacote + Σ(quantidade × unitario) − desconto. Nunca negativo. */
export function totalContrato(servico: Servico): number {
  const adicionais = servico.adicionais.reduce((s, a) => s + a.quantidade * a.valorUnitario, 0);
  return Math.max(0, servico.valorPacote + adicionais - servico.desconto);
}

/**
 * Quanto o mesmo servico custaria pela tabela escolhida: pacote da tabela mais
 * os adicionais pelo preco da arte. `null` quando o pacote nao tem preco de
 * tabela (Personalizado, nome desconhecido).
 *
 * Adicional sem preco na arte ("sob consulta": locomocao, outro servico)
 * entra pelo valor que a Mel digitou -- nao ha referencia para comparar, e
 * ele nao pode fazer o total parecer "acima da tabela".
 */
export function totalDeTabela(servico: Servico, templateId: TemplateId): number | null {
  const pacote = precoPacote(templateId, servico.tabela, servico.pacote);
  if (pacote === null) return null;
  let total = pacote;
  for (const a of servico.adicionais) {
    const item = adicionalDoCatalogo(templateId, a.id);
    const unitario = item ? valorCatalogoAdicional(item, servico.pacote) : null;
    total += a.quantidade * (unitario ?? a.valorUnitario);
  }
  return total;
}

// --------------------------------------------------------------- menoridade --

type Menoridade = { menor: boolean; menorDe16: boolean; idade: number | null };

function menoridade(ctx: ContextoMontagem): Menoridade {
  const idade = ctx.idadeHomenageado ?? (ctx.categoria === "debutante" ? 15 : null);
  const menor = ehEventoDeMenor(ctx.categoria, idade);
  // Idade desconhecida conta como menor de 16: representacao cobre o caso
  // mais protegido; o aviso pede a idade.
  return { menor, menorDe16: menor && (idade === null || idade < 16), idade };
}

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "d"]);

function tokensDoNome(nome: string): string[] {
  return normalizarComparacao(nome)
    .split(" ")
    .filter((t) => t && !PARTICULAS.has(t));
}

/**
 * Dois nomes digitados em lugares diferentes sao da mesma pessoa? "Carla" e
 * "Carla Mendes Souza" sim; "Carla Souza" e "Paula Souza" nao. O primeiro
 * nome tem de bater e o nome mais curto tem de estar contido no mais longo.
 */
export function mesmaPessoa(a: string, b: string): boolean {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta[0] !== tb[0]) return false;
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return curto.every((t) => longo.includes(t));
}

/**
 * O anuente e a propria pessoa homenageada (pelo papel ou pelo nome)?
 *
 * O papel conta so quando COMECA pelo papel do homenageado ("aniversariante",
 * "a debutante"): "pai do aniversariante" e o responsavel legal, e confundi-lo
 * com o menor tirava do contrato a autorizacao que ele da pela crianca.
 */
export function anuenteEhHomenageado(dados: DadosContrato): boolean {
  const a = dados.anuente;
  if (!a.ativo) return false;
  if (/^(o |a )?(aniversariante|debutante|homenageado|homenageada)\b/.test(normalizarComparacao(a.papel))) return true;
  return mesmaPessoa(a.nome, dados.evento.homenageado);
}

// ------------------------------------------------------------------ fatos --

/** Os fatos calculados que as clausulas leem. Exportado para os testes e para a previa. */
export function baseDeRedacao(dados: DadosContrato, ctx: ContextoMontagem): BaseRedacao {
  const { menor, menorDe16 } = menoridade(ctx);
  const servico = dados.servico;
  const total = totalContrato(servico);
  const adicionais: AdicionalRedacao[] = servico.adicionais.map((a) => ({
    ...a,
    unidade: unidadeDoAdicional(a, ctx.templateId),
  }));
  return {
    dados,
    categoria: ctx.categoria,
    menor,
    menorDe16,
    anuenteEhHomenageado: anuenteEhHomenageado(dados),
    escopoPacote: servico.escopo,
    escopo: escopoEfetivo(servico, ctx.templateId),
    adicionais,
    total,
    parcelas: dados.pagamento.modo === "parcelas" ? calcularParcelas(total, dados.pagamento.parcelas) : [],
    sinal: valorSinal(total, dados.pagamento),
  };
}

// -------------------------------------------------------------- faltantes --

const RE_HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;
const RE_UF = /^[A-Za-z]{2}$/;

function vazio(s: string | null | undefined): boolean {
  return (s ?? "").trim() === "";
}

function faltantesDoEndereco(
  e: DadosContrato["contratante"]["pf"]["endereco"],
  de: string,
): string[] {
  const f: string[] = [];
  if (vazio(e.logradouro)) f.push(`${de}: logradouro (rua, avenida...)`);
  if (vazio(e.numero)) f.push(`${de}: número (ou "s/n")`);
  if (vazio(e.bairro)) f.push(`${de}: bairro`);
  if (vazio(e.cidade)) f.push(`${de}: cidade`);
  if (vazio(e.uf)) f.push(`${de}: UF`);
  else if (!RE_UF.test(e.uf.trim())) f.push(`${de}: UF (a sigla, com 2 letras)`);
  // O CEP e opcional (nenhum contrato antigo trazia), mas preenchido pela
  // metade saia impresso cru na qualificacao ("CEP 131015"): ou inteiro, ou
  // em branco.
  if (!vazio(e.cep) && !validarCep(e.cep)) {
    f.push(
      somenteDigitos(e.cep).length < 8
        ? `${de}: CEP incompleto (são 8 números, ou deixe em branco)`
        : `${de}: CEP inválido (são 8 números, ou deixe em branco)`,
    );
  }
  return f;
}

function faltaCpf(cpf: string, de: string): string | null {
  if (vazio(cpf)) return `CPF ${de}`;
  return validarCpf(cpf) ? null : `CPF ${de} (o número não é válido)`;
}

function faltaEmail(email: string, de: string): string | null {
  if (vazio(email)) return `E-mail ${de}`;
  return validarEmail(email) ? null : `E-mail ${de} (o endereço não é válido)`;
}

function rotuloHomenageado(categoria: Categoria): string {
  switch (categoria) {
    case "casamento":
      return "Nome dos noivos";
    case "debutante":
      return "Nome da debutante";
    case "aniversario":
      return "Nome do(a) aniversariante";
    case "corporativo":
      return "Nome da empresa do evento";
  }
}

/**
 * O que falta para o contrato poder ser montado, em frases que a Mel resolve
 * na tela ("CPF de quem assina", "Data do evento (a data já passou)"). Lista
 * vazia = pode montar.
 */
export function faltantes(dados: DadosContrato, ctx: ContextoMontagem): string[] {
  const f: string[] = [];
  const push = (s: string | null) => {
    if (s) f.push(s);
  };
  const { menor } = menoridade(ctx);
  const c = dados.contratante;

  // --- quem assina
  if (c.tipo === "pj") {
    const pj = c.pj;
    const rep = pj.representante;
    if (vazio(pj.razaoSocial)) f.push("Razão social da empresa");
    if (vazio(pj.cnpj)) f.push("CNPJ da empresa");
    else if (!validarCnpj(pj.cnpj)) f.push("CNPJ da empresa (o número não é válido)");
    f.push(...faltantesDoEndereco(pj.endereco, "Endereço da sede da empresa"));
    if (vazio(rep.nome)) f.push("Nome de quem assina pela empresa");
    if (rep.genero === "") f.push("Tratamento de quem assina pela empresa (Sr. ou Sra.)");
    push(faltaCpf(rep.cpf, "de quem assina pela empresa"));
    if (vazio(rep.cargo)) f.push("Cargo de quem assina pela empresa");
    push(faltaEmail(rep.email, "de quem assina pela empresa"));
  } else {
    const pf = c.pf;
    if (vazio(pf.nome)) f.push("Nome completo de quem assina");
    if (pf.genero === "") f.push("Tratamento de quem assina (Sr. ou Sra.)");
    push(faltaCpf(pf.cpf, "de quem assina"));
    push(faltaEmail(pf.email, "de quem assina"));
    f.push(...faltantesDoEndereco(pf.endereco, "Endereço de quem assina"));
    if (menor && vazio(c.vinculo)) {
      const h = dados.evento.homenageado.trim();
      f.push(`Vínculo de quem assina com ${h || "a pessoa homenageada"} (mãe, pai, responsável legal)`);
    }
  }

  // --- anuente
  const a = dados.anuente;
  if (a.ativo) {
    if (vazio(a.nome)) f.push("Anuente: nome completo");
    if (a.genero === "") f.push("Anuente: tratamento (Sr. ou Sra.)");
    push(faltaCpf(a.cpf, "do anuente"));
    push(faltaEmail(a.email, "do anuente"));
    if (vazio(a.papel)) f.push("Anuente: papel no evento (noivo, noiva, aniversariante)");
  }

  // --- evento
  const ev = dados.evento;
  if (vazio(ev.data)) f.push("Data do evento");
  else if (!dataISOValida(ev.data)) f.push("Data do evento (a data não é válida)");
  else {
    const dia = diaDoCalendario(ev.data);
    const hoje = diaDoCalendario(ctx.hojeISO);
    if (dia !== null && hoje !== null && dia < hoje) f.push("Data do evento (a data já passou)");
  }
  if (vazio(ev.horarioInicio)) f.push("Início da cobertura do evento");
  else if (!RE_HORA.test(ev.horarioInicio.trim())) f.push("Início da cobertura do evento (horário inválido)");
  if (vazio(ev.homenageado)) f.push(rotuloHomenageado(ctx.categoria));

  const locais = ev.locais.filter((l) => !vazio(l.rotulo) || !vazio(l.endereco));
  if (locais.length === 0) f.push("Local do evento");
  for (const l of locais) {
    if (vazio(l.rotulo)) f.push(`Nome da linha do local “${l.endereco.trim()}” (Local do evento, Local da cerimônia...)`);
    else if (vazio(l.endereco)) f.push(`Endereço: ${l.rotulo.trim()}`);
  }
  if (!vazio(ev.makingOfHorario) && !RE_HORA.test(ev.makingOfHorario.trim())) {
    f.push("Início do making of (horário inválido)");
  }

  // Ensaio: so confere com ensaio no escopo -- sem ele, os campos nem vao
  // para o contrato. Vazio e "A DEFINIR" (valido); preenchido, tem de ser
  // uma data real e nao depois do evento: o ensaio e anterior a festa.
  const s = dados.servico;
  if (escopoEfetivo(s, ctx.templateId).minutosEnsaio > 0) {
    if (!vazio(ev.ensaioData)) {
      const ensaio = diaDoCalendario(ev.ensaioData);
      const evento = diaDoCalendario(ev.data);
      if (ensaio === null) f.push("Data do ensaio fotográfico (a data não é válida)");
      else if (evento !== null && ensaio > evento) {
        f.push("Data do ensaio fotográfico (é depois do evento; o ensaio acontece antes)");
      }
    }
    if (!vazio(ev.ensaioHorario) && !RE_HORA.test(ev.ensaioHorario.trim())) {
      f.push("Início do ensaio fotográfico (horário inválido)");
    }
  }

  // --- servico
  const e = s.escopo;
  const total = totalContrato(s);
  if (vazio(s.pacote)) f.push("Pacote");
  if (s.valorPacote <= 0 && !(s.adicionais.length > 0 && total > 0)) f.push("Valor do pacote");
  if (e.minutosCobertura <= 0) f.push("Horas de cobertura do pacote");
  // Mesmo com adicionais: sem stories, Reels nem extras, o objeto e os
  // servicos ficariam sem nada a descrever -- "cobertura" de que?
  if (!e.stories && e.reels.length === 0 && e.extras.every(vazio)) {
    f.push("O que o pacote entrega (stories, Reels ou extras)");
  }
  if (e.reels.length > 0 && e.segundosReels <= 0) f.push("Duração dos Reels");
  if (e.stories && !e.tempoReal && e.diasStories <= 0) f.push("Prazo de entrega dos stories (dias úteis)");
  if (e.diasMaterial <= 0) f.push("Prazo de entrega do material bruto (dias úteis)");
  if (e.reels.length > 0 && e.diasReels <= 0) f.push("Prazo de entrega dos Reels (dias úteis)");

  s.adicionais.forEach((ad, i) => {
    const nome = ad.descricao.trim() ? `“${ad.descricao.trim()}”` : `nº ${i + 1}`;
    if (vazio(ad.descricao)) f.push(`Descrição do adicional nº ${i + 1}`);
    if (ad.valorUnitario <= 0) f.push(`Valor do adicional ${nome}`);
    if (ad.tipo === "making_of" && ad.minutos <= 0) f.push(`Duração do adicional ${nome}`);
  });

  // --- pagamento
  f.push(...validarPagamento(dados.pagamento, total, ev.data, ctx.hojeISO));
  if (total <= 0) f.push("Valor total do contrato (está zerado)");

  return f;
}

// ------------------------------------------------------------------ avisos --

function aviso(gravidade: Aviso["gravidade"], texto: string, clausula?: string): Aviso {
  return clausula ? { origem: "sistema", gravidade, clausula, texto } : { origem: "sistema", gravidade, texto };
}

/**
 * O que o sistema sabe apontar sem IA: autorizacao de imagem que nao cobre
 * quem aparece, preco acima da tabela, tabela de outro ano, tempo real
 * pedido e nao contratado. Nenhum bloqueia: sao para a Mel decidir.
 */
export function avisosDeterministicos(dados: DadosContrato, ctx: ContextoMontagem): Aviso[] {
  const avisos: Aviso[] = [];
  const { menor, menorDe16, idade } = menoridade(ctx);
  const pf = dados.contratante.tipo === "pf";
  const anuente = dados.anuente.ativo;
  const doHomenageado = anuenteEhHomenageado(dados);
  const s = dados.servico;
  const e = escopoEfetivo(s, ctx.templateId);

  // --- quem autoriza a propria imagem
  if (ctx.categoria === "casamento" && pf && !anuente) {
    avisos.push(
      aviso(
        "sugestao",
        "Só quem assina autoriza o uso da própria imagem. Para cobrir o(a) outro(a) noivo(a), inclua-o(a) como anuente.",
        "direitos",
      ),
    );
  }

  // Empresa contratando evento de pessoa (buffet, cerimonial, a empresa do pai
  // pagando o 15 anos): pessoa juridica nao autoriza a imagem de ninguem, e o
  // contrato saia sem autorizacao de imagem dos homenageados -- inclusive de
  // crianca -- e sem aviso. Nao bloqueia: a Mel pode decidir nao publicar.
  if (!pf && ctx.categoria !== "corporativo") {
    const h = dados.evento.homenageado.trim() || "a pessoa homenageada";
    if (menor) {
      // O anuente que nao e o homenageado e o responsavel legal: a clausula
      // dos direitos o faz autorizar tambem a imagem do menor.
      if (!(anuente && !doHomenageado)) {
        avisos.push(
          aviso(
            "atencao",
            `Quem assina é uma empresa, e o evento é de menor de idade: a empresa não autoriza o uso da imagem de ${h}. Inclua o responsável legal do(a) menor como anuente; é ele(a) quem autoriza o uso da imagem do(a) menor.`,
            "direitos",
          ),
        );
      }
    } else if (!anuente) {
      avisos.push(
        aviso(
          "atencao",
          "Quem assina é uma empresa: ela não autoriza o uso da imagem dos homenageados. Inclua o(s) homenageado(s) como anuente(s); sem isso, o material não tem autorização de imagem para o portfólio nem para anúncios.",
          "direitos",
        ),
      );
    } else if (ctx.categoria === "casamento") {
      avisos.push(
        aviso(
          "atencao",
          "Quem assina é uma empresa, que não autoriza o uso da imagem dos noivos, e o anuente autoriza só a própria imagem: a do(a) outro(a) noivo(a) continua sem autorização.",
          "direitos",
        ),
      );
    }
  }

  if (ctx.categoria === "aniversario") {
    if (idade === null) {
      avisos.push(
        aviso(
          "atencao",
          pf
            ? "A idade do(a) aniversariante não foi informada: o contrato foi montado como evento de menor, com a autorização de imagem dada pela CONTRATANTE como representante legal. Confira a idade."
            : "A idade do(a) aniversariante não foi informada: o contrato foi montado como evento de menor de idade. Confira a idade.",
          "direitos",
        ),
      );
    } else if (pf && menor && !menorDe16 && !(anuente && doHomenageado)) {
      avisos.push(
        aviso(
          "atencao",
          "Aniversariante com 16 ou 17 anos: para a autorização de imagem valer, inclua o(a) aniversariante como anuente (assistido pela CONTRATANTE).",
          "direitos",
        ),
      );
    } else if (idade >= MAIORIDADE && pf && !anuente && !mesmaPessoa(dados.contratante.pf.nome, dados.evento.homenageado)) {
      avisos.push(
        aviso(
          "sugestao",
          "Quem assina não é o(a) aniversariante, e só quem assina autoriza o uso da própria imagem. Para cobrir o(a) aniversariante, inclua-o(a) como anuente.",
          "direitos",
        ),
      );
    }
  }

  // So pessoa fisica: com empresa, a CONTRATANTE nao e representante legal de
  // ninguem, e o aviso de empresa acima ja pede o responsavel como anuente.
  if (pf && menorDe16 && anuente && doHomenageado) {
    avisos.push(
      aviso(
        "atencao",
        "O anuente parece ser a própria pessoa homenageada, que tem menos de 16 anos: menor dessa idade não assina. A autorização da imagem dele(a) já é dada pela CONTRATANTE como representante legal; remova o anuente.",
        "direitos",
      ),
    );
  }

  // --- preco e tabela
  const total = totalContrato(s);
  const deTabela = totalDeTabela(s, ctx.templateId);
  if (deTabela !== null && total > deTabela) {
    avisos.push(
      aviso(
        "atencao",
        `O total ficou acima da tabela ${s.tabela} (${formatarReais(deTabela)}). Confira se é o valor da proposta aceita.`,
        "pagamento",
      ),
    );
  }

  // O contrato imprime o valor cheio de cada adicional e so o TOTAL com
  // desconto, sem o valor do pacote. Desconto maior que o pacote faz os
  // adicionais somarem mais que o total "já incluídos os serviços adicionais",
  // e numa devolucao parcial cada lado usaria um numero.
  const somaAdicionais = s.adicionais.reduce((soma, a) => soma + a.quantidade * a.valorUnitario, 0);
  if (s.adicionais.length > 0 && (s.desconto > s.valorPacote || somaAdicionais > total)) {
    avisos.push(
      aviso(
        "atencao",
        `O desconto (${formatarReais(s.desconto)}) passou do valor do pacote (${formatarReais(s.valorPacote)}), e os adicionais listados no contrato somam ${formatarReais(somaAdicionais)}, mais que o total de ${formatarReais(total)}. O contrato não mostra o desconto, então o texto se contradiz: ajuste os valores dos adicionais ou o desconto.`,
        "pagamento",
      ),
    );
  }

  const tabelaDoAno = resolverTabelaPreco(dados.evento.data);
  const ano = anoDoEvento(dados.evento.data);
  if (tabelaDoAno !== null && ano !== null && tabelaDoAno !== s.tabela) {
    avisos.push(
      aviso(
        "sugestao",
        `O evento é em ${ano}, mas o contrato usa a tabela ${s.tabela}. Tudo bem se a proposta aceita foi dessa tabela.`,
        "pagamento",
      ),
    );
  }

  // --- entrega e equipe
  if ((ctx.entregaSolicitada ?? "").trim() === "Em tempo real" && !e.tempoReal) {
    avisos.push(
      aviso(
        "atencao",
        "No formulário, o cliente pediu entrega em tempo real, mas o contrato não inclui a cobertura em tempo real. Confira o pacote, o adicional ou os detalhes do pacote.",
        "servicos",
      ),
    );
  }

  // No corporativo o tempo real e o padrao da arte, feito por uma pessoa so:
  // sugerir auxiliar em todo contrato corporativo seria ruido.
  if (e.tempoReal && e.storymakers === 1 && e.minutosAuxiliar === 0 && ctx.categoria !== "corporativo") {
    avisos.push(
      aviso(
        "sugestao",
        "A cobertura em tempo real costuma ter storymaker auxiliar, e o contrato prevê só a CONTRATADA na equipe.",
        "objeto",
      ),
    );
  }

  // Na debutante e no infantil o storymaker adicional so existe para a
  // cobertura em tempo real (a arte diz "Somente se tiver necessidade da
  // cobertura em tempo real"), e a descricao do catalogo leva isso para o
  // contrato. Sem tempo real no escopo, o texto diria "para a cobertura em
  // tempo real" ao lado de uma clausula de prazos que entrega os stories dias
  // depois do evento -- contradicao que o cliente le.
  const storymakerDeTempoReal = s.adicionais.some(
    (a) => a.tipo === "storymaker" && normalizarComparacao(a.descricao).includes("tempo real"),
  );
  if (storymakerDeTempoReal && !e.tempoReal) {
    avisos.push(
      aviso(
        "atencao",
        "O storymaker adicional está descrito como “para a cobertura em tempo real”, mas o contrato não prevê cobertura em tempo real. Marque “Cobertura em tempo real” nos detalhes do pacote ou ajuste a descrição do adicional.",
        "adicionais",
      ),
    );
  }

  // Dois making ofs e um adicional que poe uma segunda pessoa na equipe: o
  // paragrafo "impossibilitando a realização simultânea" saiu (desmentiria o
  // adicional), mas o contrato nao sabe quem cobre cada making of.
  if (
    quantidadeMakingOfs({ escopoPacote: s.escopo, adicionais: s.adicionais }) >= 2 &&
    e.storymakers === 1 &&
    s.adicionais.some(adicionalIndicaSegundaPessoa)
  ) {
    avisos.push(
      aviso(
        "atencao",
        "Há dois making ofs e um adicional com storymaker auxiliar, então o contrato não diz que os making ofs serão alternados. Confira a logística: se forem simultâneos, deixe claro no adicional quem cobre cada um; se forem alternados, escreva isso nas observações.",
        "adicionais",
      ),
    );
  }

  if (e.minutosMakingOf > 0 && (vazio(dados.evento.makingOfLocal) || vazio(dados.evento.makingOfHorario))) {
    avisos.push(
      aviso(
        "sugestao",
        "O local ou o horário do making of ficou “A DEFINIR”: o contrato dá à CONTRATANTE até 10 (dez) dias antes do evento para informar.",
        "local",
      ),
    );
  }

  const ev = dados.evento;
  if (e.minutosEnsaio > 0 && (vazio(ev.ensaioData) || vazio(ev.ensaioLocal) || vazio(ev.ensaioHorario))) {
    avisos.push(
      aviso(
        "sugestao",
        "A data, o local ou o horário do ensaio fotográfico ficou “A DEFINIR”: o contrato diz que ele será antes do evento, de comum acordo e sujeito à sua agenda, com a CONTRATANTE agendando com 10 (dez) dias de antecedência.",
        "local",
      ),
    );
  }

  return avisos;
}

// ----------------------------------------------------------------- montagem --

/**
 * Monta o contrato.
 *
 * `condicoesEspeciais`: paragrafos da clausula "Das condições especiais" ja
 * com os nomes de volta (`desanonimizar`). Vazio ou `null` = sem a clausula.
 * Os paragrafos sao conferidos por `validarTextoIa` contra o restante do
 * contrato e contra `dados.observacoes`; o que a validacao achar vai para
 * `problemas` da clausula, e clausula da IA com problema bloqueia o PDF ate a
 * Mel editar.
 *
 * Lanca `CamposFaltandoContratoError` quando `faltantes` nao esta vazio.
 */
export function montarContrato(
  dados: DadosContrato,
  ctx: ContextoMontagem,
  condicoesEspeciais?: readonly string[] | null,
): { documento: DocumentoContrato; avisos: Aviso[] } {
  const campos = faltantes(dados, ctx);
  if (campos.length > 0) throw new CamposFaltandoContratoError(campos);

  const b = baseDeRedacao(dados, ctx);

  const clausulas: Clausula[] = [
    clausulaObjeto(b),
    clausulaLocal(b),
    clausulaServicos(b),
    clausulaAdicionais(b),
    b.escopo.tempoReal ? clausulaCondicoesTecnicas(b) : clausulaPrazos(b),
    clausulaInstagram(b),
    clausulaPagamento(b),
    clausulaEntrega(),
    clausulaArmazenamento(),
    clausulaDireitos(b),
    clausulaAlimentacao(b),
    clausulaAlteracoes(),
    clausulaDesistencia(),
    clausulaEquipe(),
    // condicoes especiais entram aqui (abaixo), antes da assinatura eletronica
    clausulaAssinaturaEletronica(),
    clausulaForo(b),
  ].filter((c): c is Clausula => c !== null);

  const documento: DocumentoContrato = {
    versaoModelo: VERSAO_MODELO,
    titulo: TITULO_CONTRATO,
    partes: partesDoContrato(b),
    preambulo: preambuloDoContrato(b),
    clausulas,
    localData: LOCAL_DATA,
    assinaturas: assinaturasDoContrato(b),
  };

  const especiais = clausulaCondicoesEspeciais(condicoesEspeciais);
  if (especiais) {
    // Validada contra o contrato SEM ela: um numero que so a IA escreveu nao
    // pode "se provar" aparecendo na propria clausula.
    const paragrafosIa = especiais.paragrafos.slice(0, -1);
    especiais.problemas = validarTextoIa(paragrafosIa, dados, documento, dados.observacoes);
    // Limites do schema: acima deles a clausula ja esta com problema (no
    // maximo 8 paragrafos e 1.500 caracteres cada) e bloqueada.
    especiais.paragrafos = [...paragrafosIa.slice(0, 38).map((p) => p.slice(0, 6000)), especiais.paragrafos.at(-1)!];
    const antes = clausulas.findIndex((c) => c.id === "assinatura_eletronica");
    clausulas.splice(antes, 0, especiais);
  }

  return {
    documento: documentoContratoSchema.parse(documento),
    avisos: avisosDeterministicos(dados, ctx),
  };
}
