"use client";

// Pecas de formulario da secao de contrato. Seguem o desenho do DetalheLead
// (Label pequeno e cinza, Input h-9, <select> nativo) para a secao nova nao
// parecer outro sistema dentro do mesmo painel.
//
// Cada campo recebe um `id` estavel (ver campos.ts): e ele que liga o Label ao
// input e e para ele que a lista de pendencias do 422 rola a tela.

import { useState, type ReactNode } from "react";
import { AlertTriangle, CircleCheck, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  limparCnpj,
  limparCpf,
  mascararCnpj,
  mascararCpf,
  normalizarEmail,
  validarCnpj,
  validarCpf,
  validarEmail,
} from "@/lib/contrato/documento";
import type { Genero } from "@/lib/contrato/tipos";
import { cn } from "@/lib/utils";
import {
  centavosDoColado,
  centavosDoTexto,
  limitar,
  numeroDoTexto,
  textoDeCentavos,
  textoDeNumero,
  textoNumericoAceito,
} from "@/components/admin/contrato/reais";

// Classes LITERAIS (o scanner do Tailwind nao le string montada).
export const CLASSE_SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";
export const CLASSE_ROTULO = "text-xs text-muted-foreground";
/** `<a>` com cara de botao outline, igual aos links do DetalheLead. */
export const CLASSE_LINK_BOTAO =
  "inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted";

/** aria-describedby de um campo: a dica e o erro, quando existem. */
export function descricaoDe(id: string, dica?: ReactNode, erro?: string | null): string | undefined {
  const ids = [dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

// ------------------------------------------------------------------ moldura --

export function Campo({
  id,
  rotulo,
  dica,
  erro,
  className,
  children,
}: {
  id: string;
  rotulo: ReactNode;
  dica?: ReactNode;
  erro?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className={CLASSE_ROTULO}>
        {rotulo}
      </Label>
      {children}
      {erro && (
        <p id={`${id}-erro`} className="text-xs text-destructive">
          {erro}
        </p>
      )}
      {dica && !erro && (
        <p id={`${id}-dica`} className="text-xs text-muted-foreground">
          {dica}
        </p>
      )}
    </div>
  );
}

/** Sub-bloco do cartao do contrato: separado por `border-t`, como pede o desenho. */
export function Bloco({
  id,
  titulo,
  descricao,
  acoes,
  children,
}: {
  id?: string;
  titulo: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    // scroll-mt: quem chega por link (aviso, pendencia) nao para colado no topo.
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="min-w-0 scroll-mt-6 space-y-4 border-t pt-5 outline-none"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {acoes}
      </div>
      {children}
    </div>
  );
}

export type TomRecado = "ok" | "atencao" | "erro" | "info";

/** Recado dentro da secao, com as mesmas cores dos avisos do DetalheLead. */
export function Recado({
  tom,
  children,
  className,
}: {
  tom: TomRecado;
  children: ReactNode;
  className?: string;
}) {
  const Icone = tom === "ok" ? CircleCheck : tom === "info" ? Info : AlertTriangle;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm",
        tom === "erro" && "border-destructive/30 bg-destructive/5 text-destructive",
        tom === "atencao" && "border-amber-300 bg-amber-50 text-amber-900",
        tom === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900",
        tom === "info" && "border-border bg-muted text-foreground",
        className,
      )}
    >
      <Icone className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1 wrap-anywhere">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ texto --

export function CampoTexto({
  id,
  rotulo,
  valor,
  onValor,
  dica,
  erro,
  className,
  placeholder,
  tipo = "text",
  onBlur,
  autoComplete = "off",
  inputMode,
  maxLength = 2000,
}: {
  id: string;
  rotulo: ReactNode;
  valor: string;
  onValor: (v: string) => void;
  dica?: ReactNode;
  erro?: string | null;
  className?: string;
  placeholder?: string;
  tipo?: "text" | "date" | "time" | "tel" | "email";
  onBlur?: () => void;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
}) {
  return (
    <Campo id={id} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <Input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricaoDe(id, dica, erro)}
        className="h-9"
      />
    </Campo>
  );
}

/** E-mail: normaliza (minusculas, sem espaco nas pontas) e confere no blur. */
export function CampoEmail({
  id,
  rotulo,
  valor,
  onValor,
  forcarValidacao,
  dica,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  valor: string;
  onValor: (v: string) => void;
  forcarValidacao?: boolean;
  dica?: ReactNode;
  className?: string;
}) {
  const [tocado, setTocado] = useState(false);
  const erro =
    (tocado || forcarValidacao) && valor.trim() && !validarEmail(valor)
      ? "Este e-mail não parece válido. Confira: é para ele que vai o link de assinatura."
      : null;
  return (
    <CampoTexto
      id={id}
      rotulo={rotulo}
      valor={valor}
      onValor={onValor}
      tipo="email"
      inputMode="email"
      dica={dica}
      erro={erro}
      className={className}
      onBlur={() => {
        setTocado(true);
        const normal = normalizarEmail(valor);
        if (normal !== valor) onValor(normal);
      }}
    />
  );
}

/**
 * CPF ou CNPJ com mascara. Guarda so o que o sistema guarda (CPF: digitos;
 * CNPJ: digitos e letras maiusculas, porque desde julho de 2026 existe CNPJ
 * alfanumerico) e confere o digito verificador quando a Mel sai do campo.
 */
export function CampoDocumento({
  id,
  rotulo,
  tipo,
  valor,
  onValor,
  forcarValidacao,
  dica,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  tipo: "cpf" | "cnpj";
  valor: string;
  onValor: (v: string) => void;
  forcarValidacao?: boolean;
  dica?: ReactNode;
  className?: string;
}) {
  const [tocado, setTocado] = useState(false);
  const cpf = tipo === "cpf";
  const valido = cpf ? validarCpf(valor) : validarCnpj(valor);
  const erro =
    (tocado || forcarValidacao) && valor.trim() && !valido
      ? cpf
        ? "Este CPF não é válido. Confira os números."
        : "Este CNPJ não é válido. Confira os caracteres."
      : null;

  return (
    <Campo id={id} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <Input
        id={id}
        value={cpf ? mascararCpf(valor) : mascararCnpj(valor)}
        onChange={(e) =>
          onValor(cpf ? limparCpf(e.target.value).slice(0, 11) : limparCnpj(e.target.value).slice(0, 14))
        }
        onBlur={() => setTocado(true)}
        inputMode={cpf ? "numeric" : "text"}
        autoCapitalize="characters"
        autoComplete="off"
        placeholder={cpf ? "000.000.000-00" : "00.000.000/0000-00"}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricaoDe(id, dica, erro)}
        className="h-9 tabular-nums"
      />
    </Campo>
  );
}

export function CampoSelect({
  id,
  rotulo,
  valor,
  onValor,
  opcoes,
  vazio,
  dica,
  erro,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  valor: string;
  onValor: (v: string) => void;
  opcoes: readonly { valor: string; rotulo: string }[];
  /** Texto da opcao vazia ("Escolha..."). Sem ele, nao ha opcao vazia. */
  vazio?: string;
  dica?: ReactNode;
  erro?: string | null;
  className?: string;
}) {
  return (
    <Campo id={id} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <select
        id={id}
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricaoDe(id, dica, erro)}
        className={CLASSE_SELECT}
      >
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </Campo>
  );
}

const OPCOES_TRATAMENTO = [
  { valor: "feminino", rotulo: "Sra. (feminino)" },
  { valor: "masculino", rotulo: "Sr. (masculino)" },
] as const;

/**
 * Tratamento = genero gramatical do contrato ("inscrita/inscrito"). Escolha
 * EXPLICITA da Mel: nunca se deduz do nome (4 dos 17 contratos antigos erraram
 * a concordancia justamente por isso).
 */
export function CampoTratamento({
  id,
  valor,
  onValor,
  className,
  rotulo = "Tratamento",
}: {
  id: string;
  valor: Genero | "";
  onValor: (v: Genero | "") => void;
  className?: string;
  rotulo?: ReactNode;
}) {
  return (
    <CampoSelect
      id={id}
      rotulo={rotulo}
      valor={valor}
      onValor={(v) => onValor(v === "feminino" || v === "masculino" ? v : "")}
      opcoes={OPCOES_TRATAMENTO}
      vazio="Escolha…"
      dica="Define a concordância: “inscrita” ou “inscrito”."
      className={className}
    />
  );
}

export function Marcador({
  id,
  rotulo,
  marcado,
  onMarcado,
  dica,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  marcado: boolean;
  onMarcado: (v: boolean) => void;
  dica?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={marcado}
          onChange={(e) => onMarcado(e.target.checked)}
          aria-describedby={dica ? `${id}-dica` : undefined}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span>{rotulo}</span>
      </label>
      {dica && (
        <p id={`${id}-dica`} className="pl-6 text-xs text-muted-foreground">
          {dica}
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- numeros --

/**
 * Entrada de numero com texto proprio: o que a Mel digita fica como ela digitou
 * ("33," no meio da digitacao) e o numero sobe para o estado so quando se le.
 * Tecla que nao cabe no formato e recusada na hora.
 *
 * Valor mudado DE FORA (um preset de pagamento) reescreve o texto -- o ajuste e
 * feito durante a renderizacao, no padrao do React para estado derivado de
 * prop, sem efeito.
 */
export function EntradaNumero({
  id,
  valor,
  onValor,
  min,
  max,
  decimais = 0,
  sufixo,
  className,
  ariaLabel,
  ariaDescribedBy,
}: {
  id?: string;
  valor: number;
  onValor: (n: number) => void;
  min?: number;
  max?: number;
  decimais?: number;
  sufixo?: string;
  className?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}) {
  const [texto, setTexto] = useState(() => textoDeNumero(valor, decimais));
  const [ultimo, setUltimo] = useState(valor);
  const vazioVale = min ?? 0;

  if (valor !== ultimo) {
    setUltimo(valor);
    const lido = numeroDoTexto(texto, decimais);
    // Campo apagado de proposito vale o minimo; nao reescreve "0" por cima
    // enquanto a Mel ainda vai digitar.
    const equivalente = lido === valor || (lido === null && valor === vazioVale);
    if (!equivalente) setTexto(textoDeNumero(valor, decimais));
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={texto}
        inputMode={decimais > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => {
          const t = e.target.value;
          if (!textoNumericoAceito(t, decimais)) return;
          setTexto(t);
          const n = numeroDoTexto(t, decimais);
          onValor(n === null ? vazioVale : limitar(n, min, max));
        }}
        onBlur={() => setTexto(textoDeNumero(valor, decimais))}
        className={cn("h-9 tabular-nums", sufixo && "pr-9")}
      />
      {sufixo && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground"
        >
          {sufixo}
        </span>
      )}
    </div>
  );
}

/**
 * Dinheiro em CENTAVOS com a mascara de maquininha ("1.500,00"): cada digito
 * entra pela direita. O "R$" fica fora do texto editavel, desenhado ao lado.
 *
 * Colar e diferente de digitar: "R$ 1.500" colado vem inteiro, e a maquininha
 * o leria como R$ 15,00. `centavosDoColado` reconhece reais inteiros e troca
 * o valor do campo todo; o que ele nao reconhece segue o caminho de sempre.
 */
export function EntradaReais({
  id,
  centavos,
  onCentavos,
  ariaDescribedBy,
  ariaInvalid,
  className,
}: {
  id: string;
  centavos: number;
  onCentavos: (c: number) => void;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
      >
        R$
      </span>
      <Input
        id={id}
        value={textoDeCentavos(centavos)}
        onChange={(e) => onCentavos(centavosDoTexto(e.target.value))}
        onPaste={(e) => {
          const colado = centavosDoColado(e.clipboardData.getData("text"));
          if (colado === null) return;
          e.preventDefault();
          onCentavos(colado);
        }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0,00"
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        className="h-9 pl-9 tabular-nums"
      />
    </div>
  );
}

export function CampoReais({
  id,
  rotulo,
  centavos,
  onCentavos,
  dica,
  erro,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  centavos: number;
  onCentavos: (c: number) => void;
  dica?: ReactNode;
  erro?: string | null;
  className?: string;
}) {
  return (
    <Campo id={id} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <EntradaReais
        id={id}
        centavos={centavos}
        onCentavos={onCentavos}
        ariaDescribedBy={descricaoDe(id, dica, erro)}
        ariaInvalid={!!erro}
      />
    </Campo>
  );
}

const MINUTOS_COMUNS = [0, 15, 30, 45];

/**
 * Duracao em MINUTOS, digitada como horas + minutos ("5 h 30 min"). Duas
 * caixas pequenas em vez de um "5h30" livre: a Mel nao precisa saber formato
 * nenhum, e o teclado numerico do celular basta.
 */
export function CampoDuracao({
  id,
  rotulo,
  minutos,
  onMinutos,
  maxMinutos,
  dica,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  minutos: number;
  onMinutos: (m: number) => void;
  maxMinutos: number;
  dica?: ReactNode;
  className?: string;
}) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  const opcoes = MINUTOS_COMUNS.includes(m) ? MINUTOS_COMUNS : [...MINUTOS_COMUNS, m].sort((a, b) => a - b);
  const mudar = (horas: number, mins: number) => onMinutos(Math.min(horas * 60 + mins, maxMinutos));

  return (
    <Campo id={id} rotulo={rotulo} dica={dica} className={className}>
      <div className="flex items-center gap-2">
        <EntradaNumero
          id={id}
          valor={h}
          onValor={(novo) => mudar(novo, m)}
          min={0}
          max={Math.floor(maxMinutos / 60)}
          className="w-20"
          ariaDescribedBy={dica ? `${id}-dica` : undefined}
        />
        <span className="text-sm text-muted-foreground">h</span>
        <select
          aria-label="Minutos"
          value={m}
          onChange={(e) => mudar(h, Number(e.target.value))}
          className={cn(CLASSE_SELECT, "w-20")}
        >
          {opcoes.map((o) => (
            <option key={o} value={o}>
              {String(o).padStart(2, "0")}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">min</span>
      </div>
    </Campo>
  );
}
