"use client";

// O texto do contrato para LER e corrigir: clausulas numeradas, remissoes
// resolvidas ("nos termos da Cláusula 10") e negrito aplicado, como no PDF.
//
// A edicao e por clausula. O que se edita e o texto CRU, com a marcacao que o
// PDF entende (`**negrito**`, `{{n}}`, `{{ref:x}}`): mostrar o texto resolvido
// e tentar converter "Cláusula 10" de volta em remissao seria adivinhar -- e
// uma remissao adivinhada errado e um contrato apontando para a clausula
// errada. A dica explica a marcacao em uma linha.
//
// Toda mudanca passa por `validarDocumento` ANTES de ir para o servidor (que
// valida de novo): a Mel ve na hora que remover "Dos serviços adicionais"
// quebra a remissao do objeto, em vez de descobrir no 422.

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cabecalhoClausula } from "@/lib/contrato/clausulas";
import {
  CLAUSULAS_OBRIGATORIAS,
  type Clausula,
  type DocumentoContrato,
  type IdClausula,
} from "@/lib/contrato/tipos";
import {
  numerarClausulas,
  parseNegrito,
  resolverReferencias,
  validarDocumento,
} from "@/lib/contrato/validar";
import { cn } from "@/lib/utils";
import { CLASSE_ROTULO } from "@/components/admin/contrato/campos-ui";
import { idClausula } from "@/components/admin/contrato/campos";
import { paragrafosDoTexto, vizinhaDaRemovida } from "@/components/admin/contrato/estado";

/** Limites do schema de clausula. */
const MAXIMO_PARAGRAFOS = 40;
const MAXIMO_CARACTERES = 6000;

type Edicao = { id: string; titulo: string; texto: string; nova: boolean };

function proximoIdLivreClausula(clausulas: readonly Clausula[]): string {
  let maior = 0;
  for (const c of clausulas) {
    const m = /^livre-(\d+)$/.exec(c.id);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `livre-${maior + 1}`;
}

function obrigatoria(id: string): boolean {
  return (CLAUSULAS_OBRIGATORIAS as readonly string[]).includes(id as IdClausula);
}

// ----------------------------------------------------------------- leitura --

/** `**trecho**` em negrito; marcacao quebrada aparece crua (a validacao ja acusa). */
function ComNegrito({ texto }: { texto: string }) {
  let trechos;
  try {
    trechos = parseNegrito(texto);
  } catch {
    return <>{texto}</>;
  }
  return (
    <>
      {trechos.map((t, i) =>
        t.negrito ? (
          <strong key={i} className="font-semibold">
            {t.texto}
          </strong>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </>
  );
}

/** Itens "A.", "B." com a letra pendurada na margem, como no PDF. */
function Paragrafo({ texto }: { texto: string }) {
  const item = /^([A-Z])\.\s+([\s\S]*)$/.exec(texto);
  if (item) {
    return (
      <p className="grid grid-cols-[1.25rem_1fr] gap-1">
        <span>{item[1]}.</span>
        <span className="min-w-0">
          <ComNegrito texto={item[2]} />
        </span>
      </p>
    );
  }
  return (
    <p>
      <ComNegrito texto={texto} />
    </p>
  );
}

// ------------------------------------------------------------------ editor --

export function EditorClausulas({
  documento,
  travado,
  ocupado,
  salvando,
  onSalvar,
  onEditando,
  recadoDaClausula,
}: {
  documento: DocumentoContrato;
  travado: boolean;
  /** Alguma acao da secao esta em andamento (trava unica). */
  ocupado: boolean;
  /** A acao em andamento e salvar este texto. */
  salvando: boolean;
  /**
   * PUT do documento. Devolve true se salvou. `clausula` e onde o recado do
   * salvamento aparece: na clausula que a Mel mexeu, e nao no topo do texto,
   * que no celular fica milhares de pixels acima.
   */
  onSalvar: (doc: DocumentoContrato, clausula: string | null) => Promise<boolean>;
  /** Avisa a secao que ha uma clausula aberta (e possivelmente alterada): conta para o aviso de sair da pagina. */
  onEditando?: (editando: boolean) => void;
  /** O recado ("Texto salvo.", erro) que a secao tem para esta clausula, ou null. */
  recadoDaClausula?: (id: string) => ReactNode;
}) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);

  const aberta = edicao !== null;
  useEffect(() => {
    onEditando?.(aberta);
  }, [aberta, onEditando]);
  const [problemasEdicao, setProblemasEdicao] = useState<string[]>([]);
  const [problemasRemocao, setProblemasRemocao] = useState<{ id: string; lista: string[] } | null>(null);

  const mapa = numerarClausulas(documento.clausulas);
  // Tolerante: remissao quebrada aparece crua em vez de derrubar a tela; a
  // lista de problemas do documento diz qual e.
  const resolver = (t: string, n: number) => {
    try {
      return resolverReferencias(t, n, mapa);
    } catch {
      return t;
    }
  };

  const problemasDoDocumento = validarDocumento(documento);
  const livre = !travado && !ocupado;

  function abrir(c: Clausula) {
    setProblemasEdicao([]);
    setProblemasRemocao(null);
    setEdicao({ id: c.id, titulo: c.titulo, texto: c.paragrafos.join("\n\n"), nova: false });
  }

  function abrirNova() {
    setProblemasEdicao([]);
    setProblemasRemocao(null);
    setEdicao({ id: proximoIdLivreClausula(documento.clausulas), titulo: "", texto: "", nova: true });
  }

  async function salvarEdicao() {
    if (!edicao) return;
    const paragrafos = paragrafosDoTexto(edicao.texto);
    const titulo = edicao.titulo.replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");

    const problemas: string[] = [];
    if (edicao.nova && !titulo) problemas.push("Dê um título à cláusula (ex.: “Da cessão de imagem”).");
    if (paragrafos.length === 0) problemas.push("Escreva o texto da cláusula.");
    if (paragrafos.length > MAXIMO_PARAGRAFOS)
      problemas.push(`São no máximo ${MAXIMO_PARAGRAFOS} parágrafos por cláusula.`);
    paragrafos.forEach((p, i) => {
      if (p.length > MAXIMO_CARACTERES) {
        problemas.push(
          `O parágrafo ${i + 1} passou de ${MAXIMO_CARACTERES.toLocaleString("pt-BR")} caracteres: divida em dois.`,
        );
      }
    });
    if (problemas.length) {
      setProblemasEdicao(problemas);
      return;
    }

    let clausulas: Clausula[];
    if (edicao.nova) {
      const nova: Clausula = { id: edicao.id, titulo, paragrafos, origem: "editada", problemas: [] };
      // Antes da assinatura eletronica e do foro: o fecho do contrato continua
      // sendo o fecho.
      const antes = ["assinatura_eletronica", "foro"]
        .map((id) => documento.clausulas.findIndex((c) => c.id === id))
        .find((i) => i >= 0);
      clausulas = [...documento.clausulas];
      clausulas.splice(antes ?? clausulas.length, 0, nova);
    } else {
      clausulas = documento.clausulas.map((c) =>
        c.id === edicao.id
          ? {
              ...c,
              titulo: c.id.startsWith("livre-") && titulo ? titulo : c.titulo,
              paragrafos,
              // Editar e a Mel assumir o texto: some a marca de IA e os
              // problemas que a validacao tinha achado nele.
              origem: "editada",
              problemas: [],
            }
          : c,
      );
    }

    const novo: DocumentoContrato = { ...documento, clausulas };
    const invalidos = validarDocumento(novo);
    if (invalidos.length) {
      setProblemasEdicao(invalidos);
      return;
    }

    setProblemasEdicao([]);
    if (await onSalvar(novo, edicao.id)) setEdicao(null);
  }

  async function remover(c: Clausula, numero: number) {
    const cabecalho = cabecalhoClausula(numero, c.titulo);
    const certeza = window.confirm(
      `Remover a ${cabecalho}?\n\nAs cláusulas seguintes são renumeradas, e as remissões acompanham.`,
    );
    if (!certeza) return;

    const novo: DocumentoContrato = {
      ...documento,
      clausulas: documento.clausulas.filter((x) => x.id !== c.id),
    };
    const invalidos = validarDocumento(novo);
    if (invalidos.length) {
      setProblemasRemocao({ id: c.id, lista: invalidos });
      return;
    }
    setProblemasRemocao(null);
    await onSalvar(novo, vizinhaDaRemovida(documento.clausulas, c.id));
  }

  return (
    <div className="space-y-4">
      {problemasDoDocumento.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <p className="font-medium">O texto tem problemas que impedem o PDF:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {problemasDoDocumento.map((p) => (
              <li key={p} className="wrap-anywhere">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <article className="space-y-5 rounded-lg border bg-background p-4 text-sm leading-relaxed">
        <h4 className="text-center font-semibold">{documento.titulo}</h4>

        <div className="space-y-2">
          {documento.partes.map((p) => (
            <p key={p.rotulo} className="wrap-anywhere">
              <strong className="font-semibold">{p.rotulo}:</strong>{" "}
              <ComNegrito texto={resolver(p.texto, 0)} />
            </p>
          ))}
        </div>

        <p>
          <ComNegrito texto={resolver(documento.preambulo, 0)} />
        </p>

        {documento.clausulas.map((c, i) => {
          const numero = i + 1;
          const editando = edicao && !edicao.nova && edicao.id === c.id;
          const removivel = !obrigatoria(c.id);
          return (
            <section
              key={c.id}
              id={idClausula(c.id)}
              tabIndex={-1}
              className="scroll-mt-6 space-y-2 outline-none"
            >
              {/* No celular o titulo tem a linha so para ele (basis-full) e o
                  selo e os botoes descem. Com `flex-1` (base 0) a linha nunca
                  quebrava: o titulo ficava com a sobra -- 5px em 360px, uma
                  palavra por linha, com o selo por cima. Do `sm` para cima a
                  base volta a ser o proprio texto e tudo cabe numa linha. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h5 className="min-w-0 basis-full font-semibold sm:grow sm:basis-auto">
                  {cabecalhoClausula(numero, c.titulo.toLocaleUpperCase("pt-BR"))}
                </h5>
                {c.origem === "ia" && (
                  <span className="rounded-md border border-sky-200 bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-900">
                    IA
                  </span>
                )}
                {c.origem === "editada" && (
                  <span className="rounded-md border border-stone-200 bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-700">
                    Editada
                  </span>
                )}
                {!travado && !editando && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => abrir(c)}
                      disabled={!livre || !!edicao}
                    >
                      <Pencil />
                      Editar
                    </Button>
                    {removivel && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remover(c, numero)}
                        disabled={!livre || !!edicao}
                        aria-label={`Remover a cláusula ${numero}`}
                      >
                        <Trash2 />
                        Remover
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {recadoDaClausula?.(c.id)}

              {c.origem === "ia" && c.problemas.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  <p className="font-medium">
                    Escrita pela IA, com problemas. O PDF só sai depois que você editar este texto:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {c.problemas.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {problemasRemocao?.id === c.id && (
                <div
                  role="status"
                  className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                >
                  <p className="font-medium">
                    Não dá para remover: outra parte do contrato remete a esta cláusula.
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {problemasRemocao.lista.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {editando ? (
                <EdicaoDeClausula
                  edicao={edicao}
                  setEdicao={setEdicao}
                  problemas={problemasEdicao}
                  salvando={salvando}
                  ocupado={ocupado}
                  onSalvar={salvarEdicao}
                  onCancelar={() => {
                    setEdicao(null);
                    setProblemasEdicao([]);
                  }}
                />
              ) : (
                <div className="space-y-2">
                  {c.paragrafos.map((p, j) => (
                    <Paragrafo key={j} texto={resolver(p, numero)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {edicao?.nova && (
          <section className="space-y-2 rounded-lg border border-dashed p-3">
            <h5 className="font-semibold">Nova cláusula</h5>
            <EdicaoDeClausula
              edicao={edicao}
              setEdicao={setEdicao}
              problemas={problemasEdicao}
              salvando={salvando}
              ocupado={ocupado}
              onSalvar={salvarEdicao}
              onCancelar={() => {
                setEdicao(null);
                setProblemasEdicao([]);
              }}
            />
          </section>
        )}

        <p>
          <ComNegrito texto={resolver(documento.localData, 0)} />
        </p>

        <ul className="space-y-1 text-xs text-muted-foreground">
          {documento.assinaturas.map((a) => (
            <li key={a.papel} className="wrap-anywhere">
              <span className="font-medium text-foreground">{a.rotulo}:</span> {a.nome}, {a.documento}
            </li>
          ))}
        </ul>
      </article>

      {!travado && !edicao && (
        <Button type="button" variant="outline" size="lg" onClick={abrirNova} disabled={!livre}>
          <Plus />
          Acrescentar cláusula
        </Button>
      )}
    </div>
  );
}

function EdicaoDeClausula({
  edicao,
  setEdicao,
  problemas,
  salvando,
  ocupado,
  onSalvar,
  onCancelar,
}: {
  edicao: Edicao;
  setEdicao: (e: Edicao) => void;
  problemas: string[];
  salvando: boolean;
  ocupado: boolean;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  const idTexto = `ct-edicao-${edicao.id}`;
  const comTitulo = edicao.nova || edicao.id.startsWith("livre-");
  return (
    <div className="space-y-3">
      {comTitulo && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idTexto}-titulo`} className={CLASSE_ROTULO}>
            Título (sem o “CLÁUSULA N -”)
          </Label>
          <Input
            id={`${idTexto}-titulo`}
            value={edicao.titulo}
            onChange={(e) => setEdicao({ ...edicao, titulo: e.target.value.slice(0, 200) })}
            placeholder="Ex.: Da cessão de imagem"
            autoComplete="off"
            className="h-9"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={idTexto} className={CLASSE_ROTULO}>
          Texto da cláusula
        </Label>
        <Textarea
          id={idTexto}
          value={edicao.texto}
          onChange={(e) => setEdicao({ ...edicao, texto: e.target.value })}
          aria-describedby={`${idTexto}-dica`}
          className="min-h-40 font-sans"
        />
        <p id={`${idTexto}-dica`} className="text-xs text-muted-foreground">
          Separe os parágrafos com uma linha em branco. Trechos entre ** saem em negrito (use só nas frases
          que limitam direitos, como no resto do contrato). {"{{n}}"} é o número desta cláusula e{" "}
          {"{{ref:…}}"} o número de outra: deixe como estão para a numeração continuar certa.
        </p>
      </div>

      {problemas.length > 0 && (
        <div
          role="status"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {problemas.map((p) => (
              <li key={p} className="wrap-anywhere">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={cn("flex flex-wrap gap-2")}>
        <Button type="button" size="lg" onClick={onSalvar} disabled={ocupado}>
          {salvando ? <Loader2 className="animate-spin" /> : <Save />}
          {edicao.nova ? "Salvar cláusula nova" : "Salvar cláusula"}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onCancelar} disabled={ocupado}>
          <X />
          Cancelar
        </Button>
      </div>
    </div>
  );
}
