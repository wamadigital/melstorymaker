"use client";

// "Servico": tabela de preco, pacote, o escopo do pacote, adicionais e o total.
//
// O catalogo so PRE-PREENCHE (decisao 9 do SPEC): escolher o pacote traz o
// escopo e o preco da tabela, e a Mel confirma ou muda. O total e calculado ao
// vivo com a mesma funcao que escreve o valor no contrato (`totalContrato`),
// para o numero na tela ser o numero do PDF.

import { ChevronDown, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ADICIONAL_LIVRE,
  catalogoDaArte,
  PACOTE_PERSONALIZADO,
  pacoteDoCatalogo,
  precoPacote,
  adicionalDoCatalogo,
  novoAdicional,
  valorCatalogoAdicional,
  itensArteDaTabela,
  type AdicionalCatalogo,
} from "@/lib/contrato/catalogo";
import { duracaoCurta, formatarReais, valorComExtenso } from "@/lib/contrato/extenso";
import { totalContrato, totalDeTabela } from "@/lib/contrato/montar";
import type { Adicional, Escopo, Servico } from "@/lib/contrato/tipos";
import type { TemplateId } from "@/lib/form/types";
import {
  anoDoEvento,
  resolverTabelaPreco,
  TABELAS_EM_VIGENCIA,
  TABELAS_PRECO,
  type TabelaPreco,
} from "@/lib/pdf/precos";
import { cn } from "@/lib/utils";
import {
  Campo,
  CampoDuracao,
  CampoReais,
  CampoSelect,
  CampoTexto,
  CLASSE_ROTULO,
  EntradaNumero,
  Marcador,
  Recado,
} from "@/components/admin/contrato/campos-ui";
import { ID } from "@/components/admin/contrato/campos";
import { temQuantidade, unidadeDoAdicional } from "@/components/admin/contrato/estado";

/** Limites do schema (tipos.ts): passar deles e 400 no servidor. */
const MAXIMO_ADICIONAIS = 20;
const MAXIMO_REELS = 10;
const MAXIMO_EXTRAS = 10;

const OPCOES_EQUIPE = [
  { valor: "1", rotulo: "Só a Mel" },
  { valor: "2", rotulo: "A Mel + 1 storymaker auxiliar" },
  { valor: "3", rotulo: "A Mel + 2 storymakers auxiliares" },
  { valor: "4", rotulo: "A Mel + 3 storymakers auxiliares" },
];

function rotuloPrecoCatalogo(item: AdicionalCatalogo, pacote: string, tabela: TabelaPreco): string {
  const valor = valorCatalogoAdicional(item, pacote, tabela);
  if (valor === null) return item.valorPorPacote ? "depende do pacote" : "valor a combinar";
  const reais = formatarReais(valor);
  if (item.unidade === "hora") return `${reais} por hora`;
  if (item.unidade === "unidade") return `${reais} cada`;
  return reais;
}

export function FormServico({
  templateId,
  servico,
  onServico,
  dataEvento,
}: {
  templateId: TemplateId | null;
  servico: Servico;
  onServico: (s: Servico) => void;
  dataEvento: string;
}) {
  const set = (patch: Partial<Servico>) => onServico({ ...servico, ...patch });
  const setEscopo = (patch: Partial<Escopo>) => set({ escopo: { ...servico.escopo, ...patch } });
  const setAdicional = (i: number, patch: Partial<Adicional>) =>
    set({ adicionais: servico.adicionais.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  const catalogo = templateId ? catalogoDaArte(templateId) : null;
  const pacoteAtual = templateId && servico.pacote ? pacoteDoCatalogo(templateId, servico.pacote) : null;
  const precoTabela =
    templateId && servico.pacote ? precoPacote(templateId, servico.tabela, servico.pacote) : null;

  const somaAdicionais = servico.adicionais.reduce((s, a) => s + a.quantidade * a.valorUnitario, 0);
  const bruto = servico.valorPacote + somaAdicionais;
  const total = totalContrato(servico);
  const deTabela = templateId ? totalDeTabela(servico, templateId) : null;

  // Os bullets vem da TABELA escolhida: no aniversario adulto o texto cita o
  // preco da entrega em tempo real, que mudou na tabela 2028.
  const itensDaArte =
    templateId && servico.pacote ? itensArteDaTabela(templateId, servico.pacote, servico.tabela) : [];

  const tabelaDoEvento = resolverTabelaPreco(dataEvento);
  const anoEvento = anoDoEvento(dataEvento);

  // Uma tabela nasce no codigo ANTES de a arte dela existir: os valores sao
  // aprovados primeiro, a arte vem depois. Nesse intervalo ela aparece aqui
  // para escolher, mas a PROPOSTA continua saindo pela tabela do ano do evento.
  // Sem este aviso, contrato e proposta poderiam sair de anos diferentes sem
  // ninguem perceber -- o risco que o cabecalho do catalogo diz querer evitar.
  const tabelaSemArte = !TABELAS_EM_VIGENCIA.includes(servico.tabela);
  const dicaTabela = tabelaSemArte
    ? `A tabela ${servico.tabela} ainda não tem arte de proposta: o orçamento que o lead recebe sai pela tabela ${tabelaDoEvento ?? "do ano do evento"}. Use só se combinou o preço novo com o cliente.`
    : anoEvento !== null && tabelaDoEvento
      ? tabelaDoEvento === servico.tabela
        ? `O evento é em ${anoEvento}: tabela ${tabelaDoEvento}.`
        : `O evento é em ${anoEvento} (tabela ${tabelaDoEvento}). Use outra só se a proposta aceita foi dessa tabela.`
      : "Sem a data do evento, confira a tabela à mão.";

  // ------------------------------------------------------------- acoes
  function escolherPacote(nome: string) {
    if (!templateId) return;
    const doCatalogo = nome ? pacoteDoCatalogo(templateId, nome) : null;
    const preco = nome ? precoPacote(templateId, servico.tabela, nome) : null;
    onServico({
      ...servico,
      pacote: nome,
      // Trocar de pacote traz o escopo e o preco dele. O Personalizado nao tem
      // preco de tabela: fica o valor que ja estava, para a Mel ajustar.
      escopo: doCatalogo ? doCatalogo.escopo : servico.escopo,
      valorPacote: preco ?? (nome === PACOTE_PERSONALIZADO ? servico.valorPacote : 0),
      // O preco da "entrega em tempo real" do aniversario adulto depende do
      // pacote: acompanha a troca.
      adicionais: servico.adicionais.map((a) => {
        const item = adicionalDoCatalogo(templateId, a.id);
        if (!item?.valorPorPacote) return a;
        return {
          ...a,
          valorUnitario: valorCatalogoAdicional(item, nome, servico.tabela) ?? a.valorUnitario,
        };
      }),
    });
  }

  function escolherTabela(t: string) {
    const tabela = (TABELAS_PRECO as readonly string[]).includes(t) ? (t as TabelaPreco) : servico.tabela;
    // Valor que a Mel NAO mexeu (igual ao da tabela antiga) acompanha a tabela
    // nova; valor negociado fica como esta.
    const antigo = templateId ? precoPacote(templateId, servico.tabela, servico.pacote) : null;
    const novo = templateId ? precoPacote(templateId, tabela, servico.pacote) : null;
    const acompanha =
      novo !== null && (antigo === null || servico.valorPacote === antigo || servico.valorPacote === 0);

    // Os ADICIONAIS seguem a MESMA regra. Ate a tabela 2027 isto nao era
    // preciso -- opcional custava o mesmo nas duas --, mas a 2028 reajustou os
    // opcionais tambem. Sem isto, trocar a tabela deixaria o contrato com
    // pacote de um ano e opcionais de outro: sem erro, sem aviso, e invisivel
    // para o compilador, porque a assinatura de `set` nao muda.
    const adicionais = servico.adicionais.map((a) => {
      const item = templateId ? adicionalDoCatalogo(templateId, a.id) : null;
      if (!item) return a;
      const deAgora = valorCatalogoAdicional(item, servico.pacote, tabela);
      // Item sem preco na arte (locomocao, livre, polaroid do adulto) e sempre
      // valor da Mel: nao ha tabela de onde puxar.
      if (deAgora === null) return a;
      const deAntes = valorCatalogoAdicional(item, servico.pacote, servico.tabela);
      const naoMexeu = deAntes === null || a.valorUnitario === deAntes || a.valorUnitario === 0;
      return naoMexeu ? { ...a, valorUnitario: deAgora } : a;
    });

    set({ tabela, valorPacote: acompanha ? novo : servico.valorPacote, adicionais });
  }

  function incluir(item: AdicionalCatalogo) {
    if (servico.adicionais.length >= MAXIMO_ADICIONAIS) return;
    set({
      adicionais: [
        ...servico.adicionais,
        novoAdicional(item, servico.pacote, servico.tabela, servico.adicionais),
      ],
    });
  }

  const idsIncluidos = new Set(servico.adicionais.map((a) => a.id));
  const disponiveis = (catalogo?.adicionais ?? []).filter((a) => a.tipo !== "outro");

  return (
    <div className="space-y-5">
      {!templateId && (
        <Recado tom="atencao">
          Falta a idade do(a) aniversariante nas respostas do formulário: é ela que define a arte e os
          pacotes. Preencha a idade em “Respostas”, salve, e o catálogo aparece aqui.
        </Recado>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoSelect
          id={ID.svTabela}
          rotulo="Tabela de preço"
          valor={servico.tabela}
          onValor={escolherTabela}
          opcoes={TABELAS_PRECO.map((t) => ({ valor: t, rotulo: `Tabela ${t}` }))}
          dica={dicaTabela}
        />
        <CampoSelect
          id={ID.svPacote}
          rotulo="Pacote"
          valor={servico.pacote}
          onValor={escolherPacote}
          vazio={templateId ? "Escolha o pacote…" : "Informe a idade primeiro"}
          opcoes={(catalogo?.pacotes ?? []).map((p) => ({
            valor: p.nome,
            rotulo: p.nome === PACOTE_PERSONALIZADO ? "Personalizado (sob medida)" : p.nome,
          }))}
        />
        <CampoReais
          id={ID.svValor}
          rotulo="Valor do pacote"
          centavos={servico.valorPacote}
          onCentavos={(c) => set({ valorPacote: c })}
          dica={
            precoTabela !== null
              ? precoTabela === servico.valorPacote
                ? `Preço da tabela ${servico.tabela}.`
                : `Na tabela ${servico.tabela}: ${formatarReais(precoTabela)}.`
              : servico.pacote === PACOTE_PERSONALIZADO
                ? "Pacote sob medida: digite o valor combinado."
                : undefined
          }
        />
      </div>

      {pacoteAtual && itensDaArte.length > 0 && (
        <div className="rounded-lg bg-muted p-3 text-xs">
          <p className="font-medium">Como o {pacoteAtual.nome} está na arte</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {itensDaArte.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------- detalhes do pacote */}
      <details id={ID.svDetalhes} className="group rounded-lg border">
        <summary className="flex items-start gap-2 px-3 py-2.5 text-sm font-medium">
          <ChevronDown className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180" />
          <span className="min-w-0 flex-1">
            Detalhes do pacote
            <span className="block text-xs font-normal text-muted-foreground">
              {duracaoCurta(servico.escopo.minutosCobertura)} de cobertura · {servico.escopo.reels.length}{" "}
              Reels
              {servico.escopo.tempoReal ? " · tempo real" : ""} · prazos e equipe
            </span>
          </span>
        </summary>
        <DetalhesDoPacote escopo={servico.escopo} setEscopo={setEscopo} />
      </details>

      {/* --------------------------------------------------------- adicionais */}
      <div className="space-y-3">
        <p className="text-xs font-medium">Adicionais</p>
        {servico.adicionais.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhum adicional incluído.</p>
        )}
        {servico.adicionais.map((a, i) => (
          <AdicionalIncluido
            key={`${a.id}-${i}`}
            indice={i}
            adicional={a}
            templateId={templateId}
            pacote={servico.pacote}
            tabela={servico.tabela}
            onMudar={(patch) => setAdicional(i, patch)}
            onRemover={() => set({ adicionais: servico.adicionais.filter((_, j) => j !== i) })}
          />
        ))}

        {catalogo && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className={CLASSE_ROTULO}>Incluir do catálogo desta arte</p>
            <ul className="divide-y">
              {disponiveis.map((item) => {
                const incluido = idsIncluidos.has(item.id);
                return (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{item.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {rotuloPrecoCatalogo(item, servico.pacote, servico.tabela)}
                        {item.observacaoArte ? ` · ${item.observacaoArte}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => incluir(item)}
                      disabled={incluido || servico.adicionais.length >= MAXIMO_ADICIONAIS}
                      aria-label={incluido ? `${item.nome}: já incluído` : `Incluir ${item.nome}`}
                    >
                      {incluido ? "Incluído" : <Plus />}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => incluir(ADICIONAL_LIVRE)}
              disabled={servico.adicionais.length >= MAXIMO_ADICIONAIS}
            >
              <Plus />
              Adicional personalizado
            </Button>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------- total */}
      <div className="space-y-3 rounded-lg bg-muted p-3">
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Pacote</dt>
            <dd className="tabular-nums">{formatarReais(servico.valorPacote)}</dd>
          </div>
          {servico.adicionais.length > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Adicionais</dt>
              <dd className="tabular-nums">{formatarReais(somaAdicionais)}</dd>
            </div>
          )}
          {servico.desconto > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Desconto</dt>
              <dd className="tabular-nums">-{formatarReais(Math.min(servico.desconto, bruto))}</dd>
            </div>
          )}
        </dl>

        <CampoReais
          id={ID.svFinal}
          rotulo="Valor final combinado (opcional)"
          centavos={servico.desconto > 0 ? Math.max(0, bruto - servico.desconto) : 0}
          onCentavos={(c) => set({ desconto: c > 0 && c < bruto ? bruto - c : 0 })}
          dica="Para fechar por um valor abaixo da soma. O contrato mostra só o total; a diferença fica registrada como desconto. Para cobrar mais, ajuste o valor do pacote."
          className="sm:max-w-xs"
        />

        <div className="border-t pt-3">
          <p className="text-xs text-muted-foreground">Total do contrato</p>
          <p className="text-lg font-semibold tabular-nums">{formatarReais(total)}</p>
          {total > 0 && <p className="text-xs text-muted-foreground">{valorComExtenso(total)}</p>}
          {deTabela !== null && (
            <p className={cn("mt-1 text-xs", total > deTabela ? "text-amber-800" : "text-muted-foreground")}>
              Pela tabela {servico.tabela}: {formatarReais(deTabela)}.
              {total > deTabela
                ? " O total está acima da tabela: confira se é o valor da proposta aceita."
                : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------ detalhes do pacote --

function DetalhesDoPacote({
  escopo,
  setEscopo,
}: {
  escopo: Escopo;
  setEscopo: (p: Partial<Escopo>) => void;
}) {
  return (
    <div className="space-y-4 border-t p-3">
      <p className="text-xs text-muted-foreground">
        Vêm do pacote escolhido. Mude só se o combinado com o cliente for diferente da arte: é daqui que saem
        o objeto, os serviços e os prazos do contrato.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <CampoDuracao
          id={ID.svCobertura}
          rotulo="Cobertura do evento"
          minutos={escopo.minutosCobertura}
          onMinutos={(m) => setEscopo({ minutosCobertura: m })}
          maxMinutos={24 * 60}
        />
        <CampoDuracao
          id="ct-sv-making-of"
          rotulo="Making of (do pacote)"
          minutos={escopo.minutosMakingOf}
          onMinutos={(m) => setEscopo({ minutosMakingOf: m })}
          maxMinutos={12 * 60}
        />
        <CampoDuracao
          id="ct-sv-ensaio"
          rotulo="Ensaio fotográfico"
          minutos={escopo.minutosEnsaio}
          onMinutos={(m) => setEscopo({ minutosEnsaio: m })}
          maxMinutos={12 * 60}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          id="ct-sv-abrangencia"
          rotulo="Abrangência (opcional)"
          valor={escopo.abrangencia}
          onValor={(v) => setEscopo({ abrangencia: v })}
          placeholder="Ex.: cerimônia e recepção"
          dica="Entra depois da duração: “…abrangendo cerimônia e recepção”."
        />
        <CampoSelect
          id="ct-sv-equipe"
          rotulo="Equipe"
          valor={String(escopo.storymakers)}
          onValor={(v) => setEscopo({ storymakers: Math.min(4, Math.max(1, Number(v) || 1)) })}
          opcoes={OPCOES_EQUIPE}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Marcador
          id={ID.svStories}
          rotulo="Stories ilimitados"
          marcado={escopo.stories}
          onMarcado={(v) => setEscopo({ stories: v })}
        />
        <Marcador
          id="ct-sv-tempo-real"
          rotulo="Cobertura em tempo real (publicação durante o evento)"
          marcado={escopo.tempoReal}
          onMarcado={(v) => setEscopo({ tempoReal: v })}
          dica="Troca a cláusula dos prazos pela das condições técnicas (internet no local)."
        />
      </div>

      <ListaDeTextos
        idBase="ct-sv-reels"
        titulo="Reels"
        itens={escopo.reels}
        onItens={(reels) => setEscopo({ reels })}
        maximo={MAXIMO_REELS}
        rotuloItem={(i) => `Reels ${i + 1}: do que é`}
        placeholder="Ex.: resumo do evento"
        rotuloAdicionar="Adicionar Reels"
        novo="resumo do evento"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          id={ID.svSegundosReels}
          rotulo="Duração de cada Reels (segundos)"
          dica="90 = 1 minuto e 30 segundos."
        >
          <EntradaNumero
            id={ID.svSegundosReels}
            valor={escopo.segundosReels}
            onValor={(n) => setEscopo({ segundosReels: n })}
            min={0}
            max={600}
            sufixo="s"
            ariaDescribedBy={`${ID.svSegundosReels}-dica`}
          />
        </Campo>
      </div>

      <ListaDeTextos
        idBase="ct-sv-extras"
        titulo="Outras entregas (extras)"
        itens={escopo.extras}
        onItens={(extras) => setEscopo({ extras })}
        maximo={MAXIMO_EXTRAS}
        rotuloItem={(i) => `Extra ${i + 1}`}
        placeholder="Ex.: 10 (dez) fotos Polaroid, como bônus"
        rotuloAdicionar="Adicionar extra"
        novo=""
      />

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-xs font-medium">Prazos de entrega (dias úteis após o evento)</legend>
        <div className="grid grid-cols-3 gap-3">
          <Campo id={ID.svDiasStories} rotulo="Stories">
            <EntradaNumero
              id={ID.svDiasStories}
              valor={escopo.diasStories}
              onValor={(n) => setEscopo({ diasStories: n })}
              min={0}
              max={90}
            />
          </Campo>
          <Campo id={ID.svDiasMaterial} rotulo="Material bruto">
            <EntradaNumero
              id={ID.svDiasMaterial}
              valor={escopo.diasMaterial}
              onValor={(n) => setEscopo({ diasMaterial: n })}
              min={0}
              max={90}
            />
          </Campo>
          <Campo id={ID.svDiasReels} rotulo="Reels">
            <EntradaNumero
              id={ID.svDiasReels}
              valor={escopo.diasReels}
              onValor={(n) => setEscopo({ diasReels: n })}
              min={0}
              max={90}
            />
          </Campo>
        </div>
        {escopo.tempoReal && (
          <p className="text-xs text-muted-foreground">
            Com tempo real, os stories saem durante o evento; o prazo dos stories não entra no contrato.
          </p>
        )}
      </fieldset>
    </div>
  );
}

function ListaDeTextos({
  idBase,
  titulo,
  itens,
  onItens,
  maximo,
  rotuloItem,
  placeholder,
  rotuloAdicionar,
  novo,
}: {
  idBase: string;
  titulo: string;
  itens: string[];
  onItens: (itens: string[]) => void;
  maximo: number;
  rotuloItem: (i: number) => string;
  placeholder: string;
  rotuloAdicionar: string;
  novo: string;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-xs font-medium">{titulo}</legend>
      {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum.</p>}
      {itens.map((item, i) => (
        <div key={i} className="flex items-end gap-2">
          <Campo id={`${idBase}-${i}`} rotulo={rotuloItem(i)} className="flex-1">
            <Input
              id={`${idBase}-${i}`}
              value={item}
              onChange={(e) => onItens(itens.map((x, j) => (j === i ? e.target.value.slice(0, 2000) : x)))}
              placeholder={placeholder}
              autoComplete="off"
              className="h-9"
            />
          </Campo>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={`Remover: ${rotuloItem(i)}`}
            onClick={() => onItens(itens.filter((_, j) => j !== i))}
          >
            <Minus />
          </Button>
        </div>
      ))}
      {itens.length < maximo && (
        <Button type="button" variant="outline" size="lg" onClick={() => onItens([...itens, novo])}>
          <Plus />
          {rotuloAdicionar}
        </Button>
      )}
    </fieldset>
  );
}

// ------------------------------------------------------ adicional incluido --

function AdicionalIncluido({
  indice,
  adicional,
  templateId,
  pacote,
  tabela,
  onMudar,
  onRemover,
}: {
  indice: number;
  adicional: Adicional;
  templateId: TemplateId | null;
  pacote: string;
  tabela: TabelaPreco;
  onMudar: (patch: Partial<Adicional>) => void;
  onRemover: () => void;
}) {
  const item = templateId ? adicionalDoCatalogo(templateId, adicional.id) : null;
  const nome = item && item.tipo !== "outro" ? item.nome : "Adicional personalizado";
  const unidade = unidadeDoAdicional(templateId, adicional);
  const comQuantidade = temQuantidade(templateId, adicional);
  const deCatalogo = item ? valorCatalogoAdicional(item, pacote, tabela) : null;
  const subtotal = adicional.quantidade * adicional.valorUnitario;
  const rotuloValor =
    unidade === "hora" ? "Valor por hora" : unidade === "unidade" ? "Valor por unidade" : "Valor";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 pt-2 text-sm font-medium">{nome}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={`Remover ${nome}`}
          onClick={onRemover}
        >
          <Trash2 />
        </Button>
      </div>

      <CampoTexto
        id={ID.adDescricao(indice)}
        rotulo="Como aparece no contrato"
        valor={adicional.descricao}
        onValor={(v) => onMudar({ descricao: v })}
        placeholder={
          adicional.tipo === "outro" ? "Ex.: Vídeo de até 20 minutos com os melhores momentos" : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {comQuantidade && (
          <Campo id={`ct-ad-${indice}-quantidade`} rotulo={unidade === "hora" ? "Horas" : "Quantidade"}>
            <EntradaNumero
              id={`ct-ad-${indice}-quantidade`}
              valor={adicional.quantidade}
              onValor={(n) => onMudar({ quantidade: Math.max(1, n) })}
              min={1}
              max={50}
            />
          </Campo>
        )}
        {adicional.tipo === "making_of" && (
          <CampoDuracao
            id={ID.adMinutos(indice)}
            rotulo="Duração"
            minutos={adicional.minutos}
            onMinutos={(m) => onMudar({ minutos: m })}
            maxMinutos={12 * 60}
            className="col-span-2"
          />
        )}
        <CampoReais
          id={ID.adValor(indice)}
          rotulo={rotuloValor}
          centavos={adicional.valorUnitario}
          onCentavos={(c) => onMudar({ valorUnitario: c })}
          dica={
            deCatalogo !== null && deCatalogo !== adicional.valorUnitario
              ? `Na arte: ${formatarReais(deCatalogo)}.`
              : deCatalogo === null
                ? "Sem preço na arte: digite o combinado."
                : undefined
          }
          className="col-span-2"
        />
      </div>

      {comQuantidade && adicional.quantidade > 1 && (
        <p className="text-xs text-muted-foreground">Subtotal: {formatarReais(subtotal)}</p>
      )}
    </div>
  );
}
