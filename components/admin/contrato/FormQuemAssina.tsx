"use client";

// "Quem assina": a CONTRATANTE (pessoa fisica ou empresa), o vinculo com o
// homenageado quando o evento e de menor, e o anuente.
//
// Nada aqui vem pre-preenchido com o nome de quem PREENCHEU o formulario sem a
// Mel confirmar (a filha pode ter preenchido o proprio 15 anos): quem assina e
// decisao dela, e o formulario so ajuda a digitar.

import { useState, type ReactNode } from "react";
import { Building2, Loader2, Sparkles, User, UserPlus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Anuente, Contratante, Endereco, Genero } from "@/lib/contrato/tipos";
import { VINCULOS_MENOR } from "@/lib/contrato/regras";
import { primeiraMaiuscula } from "@/lib/contrato/texto";
import { mascararCep, validarCep } from "@/lib/contrato/documento";
import type { Categoria } from "@/lib/form/types";
import { cn } from "@/lib/utils";
import {
  Campo,
  CampoDocumento,
  CampoEmail,
  CampoTexto,
  CampoTratamento,
  CLASSE_ROTULO,
  CLASSE_SELECT,
  descricaoDe,
} from "@/components/admin/contrato/campos-ui";
import { CAMPOS_ENDERECO, ID, type CampoEndereco } from "@/components/admin/contrato/campos";

/** Limite do texto colado para a extracao (o mesmo da rota). */
const MAXIMO_TEXTO_COLADO = 6000;

export function FormQuemAssina({
  categoria,
  homenageado,
  menor,
  contratante,
  onContratante,
  anuente,
  onAnuente,
  iaDisponivel,
  extraindo,
  ocupado,
  onExtrair,
  observacoesExtracao,
  forcarValidacao,
  retornoExtracao,
}: {
  categoria: Categoria;
  homenageado: string;
  menor: boolean;
  contratante: Contratante;
  onContratante: (c: Contratante) => void;
  anuente: Anuente;
  onAnuente: (a: Anuente) => void;
  iaDisponivel: boolean;
  extraindo: boolean;
  /** Alguma acao da secao em andamento (trava unica). */
  ocupado: boolean;
  /** Devolve true quando a extracao deu certo (o texto colado pode ser limpo). */
  onExtrair: (texto: string) => Promise<boolean>;
  observacoesExtracao: string[];
  forcarValidacao: boolean;
  /**
   * O progresso e o recado da extracao ("Lendo os dados com IA… 12s",
   * "Preenchi 10 campos"). Ficam logo abaixo do botao que os disparou: no fim
   * do bloco, depois do endereco e do anuente, saiam da tela.
   */
  retornoExtracao?: ReactNode;
}) {
  const [colado, setColado] = useState("");
  const [mostrarNacionalidade, setMostrarNacionalidade] = useState(false);
  const [vinculoOutro, setVinculoOutro] = useState(false);

  const pf = contratante.pf;
  const pj = contratante.pj;
  const rep = pj.representante;
  const nomeHomenageado = homenageado.trim() || "a pessoa homenageada";

  const setPf = (patch: Partial<Contratante["pf"]>) =>
    onContratante({ ...contratante, pf: { ...pf, ...patch } });
  const setPj = (patch: Partial<Contratante["pj"]>) =>
    onContratante({ ...contratante, pj: { ...pj, ...patch } });
  const setRep = (patch: Partial<Contratante["pj"]["representante"]>) =>
    onContratante({ ...contratante, pj: { ...pj, representante: { ...rep, ...patch } } });
  const setAnuente = (patch: Partial<Anuente>) => onAnuente({ ...anuente, ...patch });

  // Vinculo: tres escolhas prontas e "outro" (digitado). O "outro" precisa de
  // estado proprio porque, recem-escolhido, o texto ainda esta vazio -- e
  // vazio tambem e "ainda nao escolhi".
  const vinculoPronto = (VINCULOS_MENOR as readonly string[]).includes(contratante.vinculo);
  const modoOutro = vinculoOutro || (!vinculoPronto && contratante.vinculo.trim() !== "");
  const valorSelectVinculo = modoOutro ? "outro" : contratante.vinculo;

  async function extrair() {
    const ok = await onExtrair(colado);
    if (ok) setColado("");
  }

  function adicionarAnuente() {
    // No aniversario o anuente quase sempre e o proprio aniversariante (16-17
    // assistido, ou o adulto que nao e quem contrata): ja deixa o papel e o nome.
    const aniversario = categoria === "aniversario";
    onAnuente({
      ...anuente,
      ativo: true,
      papel: anuente.papel || (aniversario ? "aniversariante" : ""),
      nome: anuente.nome || (aniversario ? homenageado.trim() : ""),
    });
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ colar e extrair */}
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <Label htmlFor="ct-colado" className={CLASSE_ROTULO}>
          Cole aqui os dados que o cliente mandou (nome completo, CPF, endereço, e-mail)
        </Label>
        <Textarea
          id="ct-colado"
          value={colado}
          onChange={(e) => setColado(e.target.value.slice(0, MAXIMO_TEXTO_COLADO))}
          placeholder="Ex.: a mensagem do WhatsApp com os dados para o contrato"
          aria-describedby="ct-colado-dica"
          className="min-h-20"
        />
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={extrair}
            disabled={!iaDisponivel || ocupado || colado.trim() === ""}
            title={
              !iaDisponivel
                ? "A IA não está configurada neste ambiente (falta ANTHROPIC_API_KEY)."
                : undefined
            }
          >
            {extraindo ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {extraindo ? "Lendo os dados…" : "Preencher com IA"}
          </Button>
          <p id="ct-colado-dica" className="text-xs text-muted-foreground">
            {iaDisponivel
              ? "A IA só preenche os campos que encontrar no texto. O tratamento (Sr. ou Sra.) é sempre você quem escolhe."
              : "A IA não está configurada neste ambiente: preencha os campos à mão."}
          </p>
          {retornoExtracao}
        </div>
        {observacoesExtracao.length > 0 && (
          <div role="status" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            <p className="font-medium">A IA pediu para você conferir:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {observacoesExtracao.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ PF / PJ */}
      <div className="space-y-2">
        <p className={CLASSE_ROTULO} id="ct-tipo-rotulo">
          Quem contrata é
        </p>
        <div
          role="group"
          aria-labelledby="ct-tipo-rotulo"
          className="grid grid-cols-2 gap-2 sm:inline-grid sm:w-auto"
        >
          <Button
            type="button"
            size="lg"
            variant={contratante.tipo === "pf" ? "default" : "outline"}
            aria-pressed={contratante.tipo === "pf"}
            onClick={() => onContratante({ ...contratante, tipo: "pf" })}
          >
            <User />
            Pessoa física
          </Button>
          <Button
            type="button"
            size="lg"
            variant={contratante.tipo === "pj" ? "default" : "outline"}
            aria-pressed={contratante.tipo === "pj"}
            onClick={() => onContratante({ ...contratante, tipo: "pj" })}
          >
            <Building2 />
            Empresa
          </Button>
        </div>
      </div>

      {contratante.tipo === "pf" ? (
        <div className="space-y-4">
          {menor && (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Evento de menor de idade: quem assina é o(a) responsável legal por {nomeHomenageado}, não a
              pessoa homenageada.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              id={ID.pfNome}
              rotulo="Nome completo de quem assina"
              valor={pf.nome}
              onValor={(v) => setPf({ nome: v })}
              autoComplete="off"
              className="sm:col-span-2"
            />
            <CampoTratamento
              id={ID.pfGenero}
              valor={pf.genero}
              onValor={(v: Genero | "") => setPf({ genero: v })}
            />
            <CampoDocumento
              id={ID.pfCpf}
              rotulo="CPF"
              tipo="cpf"
              valor={pf.cpf}
              onValor={(v) => setPf({ cpf: v })}
              forcarValidacao={forcarValidacao}
            />
            <CampoEmail
              id={ID.pfEmail}
              rotulo="E-mail"
              valor={pf.email}
              onValor={(v) => setPf({ email: v })}
              forcarValidacao={forcarValidacao}
              dica="Recebe o link de assinatura."
            />
            <CampoTexto
              id={ID.pfTelefone}
              rotulo="Telefone"
              tipo="tel"
              inputMode="tel"
              valor={pf.telefone}
              onValor={(v) => setPf({ telefone: v })}
              dica="Não vai no contrato; fica só para contato."
            />

            {mostrarNacionalidade || pf.nacionalidade.trim() ? (
              <CampoTexto
                id={ID.pfNacionalidade}
                rotulo="Nacionalidade"
                valor={pf.nacionalidade}
                onValor={(v) => setPf({ nacionalidade: v })}
                placeholder="Ex.: portuguesa"
                dica="Em branco = brasileira/brasileiro, conforme o tratamento."
                className="sm:col-span-2"
              />
            ) : (
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 underline underline-offset-2"
                  onClick={() => setMostrarNacionalidade(true)}
                >
                  Estrangeiro(a)? Informar a nacionalidade
                </Button>
              </div>
            )}
          </div>

          <FormEndereco
            titulo="Endereço de quem assina"
            endereco={pf.endereco}
            onEndereco={(e) => setPf({ endereco: e })}
            idDe={ID.pfEndereco}
            forcarValidacao={forcarValidacao}
          />

          {menor && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id={ID.vinculo} rotulo={`Vínculo com ${nomeHomenageado}`}>
                <select
                  id={ID.vinculo}
                  value={valorSelectVinculo}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "outro") {
                      setVinculoOutro(true);
                      onContratante({ ...contratante, vinculo: "" });
                    } else {
                      setVinculoOutro(false);
                      onContratante({ ...contratante, vinculo: v });
                    }
                  }}
                  className={CLASSE_SELECT}
                >
                  <option value="">Escolha…</option>
                  {VINCULOS_MENOR.map((v) => (
                    <option key={v} value={v}>
                      {primeiraMaiuscula(v)}
                    </option>
                  ))}
                  <option value="outro">Outro…</option>
                </select>
              </Campo>
              {modoOutro && (
                <CampoTexto
                  id={`${ID.vinculo}-outro`}
                  rotulo="Qual vínculo?"
                  valor={contratante.vinculo}
                  onValor={(v) => onContratante({ ...contratante, vinculo: v })}
                  placeholder="Ex.: avó e tutora legal"
                  dica="Entra no contrato como: “na qualidade de … de …”."
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              id={ID.pjRazao}
              rotulo="Razão social"
              valor={pj.razaoSocial}
              onValor={(v) => setPj({ razaoSocial: v })}
              className="sm:col-span-2"
            />
            <CampoDocumento
              id={ID.pjCnpj}
              rotulo="CNPJ"
              tipo="cnpj"
              valor={pj.cnpj}
              onValor={(v) => setPj({ cnpj: v })}
              forcarValidacao={forcarValidacao}
            />
          </div>

          <FormEndereco
            titulo="Endereço da sede"
            endereco={pj.endereco}
            onEndereco={(e) => setPj({ endereco: e })}
            idDe={ID.pjEndereco}
            forcarValidacao={forcarValidacao}
          />

          <fieldset className="min-w-0 space-y-3">
            <legend className="text-xs font-medium">Quem assina pela empresa</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                id={ID.repNome}
                rotulo="Nome completo"
                valor={rep.nome}
                onValor={(v) => setRep({ nome: v })}
                className="sm:col-span-2"
              />
              <CampoTratamento id={ID.repGenero} valor={rep.genero} onValor={(v) => setRep({ genero: v })} />
              <CampoDocumento
                id={ID.repCpf}
                rotulo="CPF"
                tipo="cpf"
                valor={rep.cpf}
                onValor={(v) => setRep({ cpf: v })}
                forcarValidacao={forcarValidacao}
              />
              <CampoTexto
                id={ID.repCargo}
                rotulo="Cargo"
                valor={rep.cargo}
                onValor={(v) => setRep({ cargo: v })}
                placeholder="Ex.: sócio-administrador"
              />
              <CampoEmail
                id={ID.repEmail}
                rotulo="E-mail"
                valor={rep.email}
                onValor={(v) => setRep({ email: v })}
                forcarValidacao={forcarValidacao}
                dica="Recebe o link de assinatura em nome da empresa."
              />
              <CampoTexto
                id={ID.repTelefone}
                rotulo="Telefone"
                tipo="tel"
                inputMode="tel"
                valor={rep.telefone}
                onValor={(v) => setRep({ telefone: v })}
              />
            </div>
          </fieldset>
        </div>
      )}

      {/* --------------------------------------------------------- anuente */}
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          {/* min-w: no celular o botao desce para a linha de baixo em vez de
              espremer a explicacao numa coluna de tres palavras. */}
          <div className="min-w-[12rem] flex-1 space-y-0.5">
            <p className="text-sm font-medium">Anuente</p>
            <p className="text-xs text-muted-foreground">
              O(a) outro(a) noivo(a), ou o(a) aniversariante, que também autoriza o uso da própria imagem.
              Assina só para isso.
            </p>
          </div>
          {anuente.ativo ? (
            <Button type="button" variant="ghost" size="lg" onClick={() => setAnuente({ ativo: false })}>
              <UserX />
              Remover anuente
            </Button>
          ) : (
            <Button type="button" variant="outline" size="lg" onClick={adicionarAnuente}>
              <UserPlus />
              Adicionar anuente
            </Button>
          )}
        </div>

        {anuente.ativo && (
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              id={ID.anNome}
              rotulo="Nome completo"
              valor={anuente.nome}
              onValor={(v) => setAnuente({ nome: v })}
              className="sm:col-span-2"
            />
            <CampoTratamento
              id={ID.anGenero}
              valor={anuente.genero}
              onValor={(v) => setAnuente({ genero: v })}
            />
            <CampoDocumento
              id={ID.anCpf}
              rotulo="CPF"
              tipo="cpf"
              valor={anuente.cpf}
              onValor={(v) => setAnuente({ cpf: v })}
              forcarValidacao={forcarValidacao}
            />
            <CampoEmail
              id={ID.anEmail}
              rotulo="E-mail"
              valor={anuente.email}
              onValor={(v) => setAnuente({ email: v })}
              forcarValidacao={forcarValidacao}
              dica="Também recebe o link de assinatura."
            />
            <Campo
              id={ID.anPapel}
              rotulo="Papel no evento"
              dica="Como aparece no contrato: “noivo no evento”."
            >
              <Input
                id={ID.anPapel}
                list="ct-papeis"
                value={anuente.papel}
                onChange={(e) => setAnuente({ papel: e.target.value })}
                autoComplete="off"
                maxLength={200}
                aria-describedby={descricaoDe(ID.anPapel, true)}
                className="h-9"
              />
              <datalist id="ct-papeis">
                <option value="noiva" />
                <option value="noivo" />
                <option value="aniversariante" />
                <option value="debutante" />
              </datalist>
            </Campo>
          </div>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- endereco --

/**
 * Endereco em partes. Seis colunas desde o celular: numero e UF sao curtos, e
 * cada um numa linha inteira empurraria o formulario para baixo a toa.
 */
function FormEndereco({
  titulo,
  endereco,
  onEndereco,
  idDe,
  forcarValidacao,
}: {
  titulo: string;
  endereco: Endereco;
  onEndereco: (e: Endereco) => void;
  idDe: (c: CampoEndereco) => string;
  forcarValidacao: boolean;
}) {
  const [cepTocado, setCepTocado] = useState(false);
  const set = (c: CampoEndereco, v: string) => onEndereco({ ...endereco, [c]: v });
  const erroCep =
    (cepTocado || forcarValidacao) && endereco.cep.trim() && !validarCep(endereco.cep)
      ? "CEP incompleto: são 8 números, ou deixe em branco."
      : null;
  const erroUf =
    forcarValidacao && endereco.uf.trim() && !/^[A-Za-z]{2}$/.test(endereco.uf.trim())
      ? "Use a sigla: SP, MG…"
      : null;

  const COLUNAS: Record<CampoEndereco, string> = {
    logradouro: "col-span-6 sm:col-span-4",
    numero: "col-span-2 sm:col-span-2",
    complemento: "col-span-4 sm:col-span-3",
    bairro: "col-span-6 sm:col-span-3",
    cidade: "col-span-4 sm:col-span-3",
    uf: "col-span-2 sm:col-span-1",
    cep: "col-span-6 sm:col-span-2",
  };
  const ROTULOS: Record<CampoEndereco, string> = {
    logradouro: "Rua, avenida…",
    numero: "Número",
    complemento: "Complemento",
    bairro: "Bairro",
    cidade: "Cidade",
    uf: "UF",
    cep: "CEP (opcional)",
  };

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-xs font-medium">{titulo}</legend>
      <div className="grid grid-cols-6 gap-3">
        {CAMPOS_ENDERECO.map((c) =>
          c === "cep" ? (
            <CampoTexto
              key={c}
              id={idDe(c)}
              rotulo={ROTULOS[c]}
              valor={mascararCep(endereco.cep)}
              onValor={(v) => set("cep", v.replace(/\D/g, "").slice(0, 8))}
              onBlur={() => setCepTocado(true)}
              inputMode="numeric"
              placeholder="00000-000"
              erro={erroCep}
              className={COLUNAS[c]}
            />
          ) : (
            <CampoTexto
              key={c}
              id={idDe(c)}
              rotulo={ROTULOS[c]}
              valor={endereco[c]}
              onValor={(v) => set(c, c === "uf" ? v.toUpperCase().slice(0, 2) : v)}
              placeholder={c === "numero" ? "ou s/n" : c === "complemento" ? "Apto., bloco…" : undefined}
              erro={c === "uf" ? erroUf : null}
              className={cn(COLUNAS[c])}
              maxLength={c === "uf" ? 2 : 2000}
            />
          ),
        )}
      </div>
    </fieldset>
  );
}
