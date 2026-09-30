"use client";

// "Evento": data, inicio da cobertura, homenageado, locais, making of, ensaio
// fotografico e alimentacao. Vem pre-preenchido das respostas do formulario; o que vale e o
// que a Mel confirma aqui (o formulario pergunta o horario do CONVITE, e o
// contrato precisa do inicio da COBERTURA).

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Evento, Local } from "@/lib/contrato/tipos";
import { ROTULOS_LOCAL } from "@/lib/contrato/regras";
import type { Categoria } from "@/lib/form/types";
import { dataCurta } from "@/lib/pdf/formatadores";
import { Campo, CampoTexto, CLASSE_SELECT, Marcador } from "@/components/admin/contrato/campos-ui";
import { ID } from "@/components/admin/contrato/campos";

/** O schema aceita ate 6 locais: mais que isso e outro contrato. */
const MAXIMO_LOCAIS = 6;

const ROTULO_HOMENAGEADO: Record<Categoria, { rotulo: string; dica: string }> = {
  casamento: { rotulo: "Nome dos noivos", dica: "Como vai no contrato: “do casamento de Ana e João”." },
  debutante: {
    rotulo: "Nome da debutante",
    dica: "Como vai no contrato: “da festa de 15 (quinze) anos de …”.",
  },
  aniversario: {
    rotulo: "Nome do(a) aniversariante",
    dica: "Como vai no contrato: “da festa de aniversário de …”.",
  },
  corporativo: { rotulo: "Empresa do evento", dica: "Como vai no contrato: “do evento … de Empresa X”." },
};

export function FormEvento({
  categoria,
  evento,
  onEvento,
  temMakingOf,
  temEnsaio,
  hojeISO,
}: {
  categoria: Categoria;
  evento: Evento;
  onEvento: (e: Evento) => void;
  /** O pacote ou um adicional tem making of: mostra local e horario dele. */
  temMakingOf: boolean;
  /** O escopo tem ensaio fotografico (Pacote Luxo da debutante): mostra data, horario e local dele. */
  temEnsaio: boolean;
  hojeISO: string;
}) {
  const set = (patch: Partial<Evento>) => onEvento({ ...evento, ...patch });
  const setLocal = (i: number, patch: Partial<Local>) =>
    set({ locais: evento.locais.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const homenageado = ROTULO_HOMENAGEADO[categoria];
  // Mostra os campos do making of tambem quando ja ha algo preenchido (veio do
  // formulario), mesmo sem making of no escopo: esconder apagaria da vista um
  // dado que ainda pode entrar se a Mel incluir o adicional.
  const mostrarMakingOf =
    temMakingOf || evento.makingOfLocal.trim() !== "" || evento.makingOfHorario.trim() !== "";
  // Mesma regra para o ensaio: preenchido continua a vista mesmo se o pacote
  // mudar. Contrato salvo antes dos campos do ensaio le "" (o schema completa).
  const mostrarEnsaio =
    temEnsaio ||
    evento.ensaioData.trim() !== "" ||
    evento.ensaioHorario.trim() !== "" ||
    evento.ensaioLocal.trim() !== "";
  const ensaioDepois = evento.ensaioData !== "" && evento.data !== "" && evento.ensaioData > evento.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          id={ID.evData}
          rotulo="Data do evento"
          tipo="date"
          valor={evento.data}
          onValor={(v) => set({ data: v })}
          dica={
            evento.data && evento.data < hojeISO
              ? `Essa data (${dataCurta(evento.data)}) já passou.`
              : undefined
          }
        />
        <CampoTexto
          id={ID.evHorario}
          rotulo="Início da cobertura"
          tipo="time"
          valor={evento.horarioInicio}
          onValor={(v) => set({ horarioInicio: v })}
          dica="O formulário pergunta o horário do convite; confira se a cobertura começa nele."
        />
        <CampoTexto
          id={ID.evHomenageado}
          rotulo={homenageado.rotulo}
          valor={evento.homenageado}
          onValor={(v) => set({ homenageado: v })}
          dica={homenageado.dica}
          className={categoria === "corporativo" ? undefined : "sm:col-span-2"}
        />
        {categoria === "corporativo" && (
          <CampoTexto
            id={ID.evTipo}
            rotulo="Tipo do evento (opcional)"
            valor={evento.tipoEvento}
            onValor={(v) => set({ tipoEvento: v })}
            placeholder="Ex.: lançamento, convenção"
          />
        )}
      </div>

      {/* ------------------------------------------------------------ locais */}
      <fieldset id={ID.evLocais} tabIndex={-1} className="min-w-0 scroll-mt-6 space-y-3 outline-none">
        <legend className="text-xs font-medium">Locais</legend>
        {evento.locais.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum local ainda. Inclua pelo menos o local do evento.
          </p>
        )}
        {evento.locais.map((local, i) => {
          const pronto = (ROTULOS_LOCAL as readonly string[]).includes(local.rotulo);
          return (
            <div key={i} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium">Local {i + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={`Remover o local ${i + 1}`}
                  onClick={() => set({ locais: evento.locais.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
              <Campo id={ID.evLocalRotulo(i)} rotulo="Como a linha aparece no contrato">
                <select
                  id={ID.evLocalRotulo(i)}
                  value={pronto ? local.rotulo : "outro"}
                  // "Outro" limpa o rotulo: vazio e o sinal de "digitar",
                  // e a montagem acusa se ficar assim.
                  onChange={(e) => setLocal(i, { rotulo: e.target.value === "outro" ? "" : e.target.value })}
                  className={CLASSE_SELECT}
                >
                  {ROTULOS_LOCAL.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value="outro">Outro…</option>
                </select>
              </Campo>
              {!pronto && (
                <CampoTexto
                  id={`${ID.evLocalRotulo(i)}-outro`}
                  rotulo="Nome da linha"
                  valor={local.rotulo}
                  onValor={(v) => setLocal(i, { rotulo: v })}
                  placeholder="Ex.: Local do ensaio"
                />
              )}
              <Campo
                id={ID.evLocalEndereco(i)}
                rotulo="Nome do espaço e endereço completo"
                dica="Vai assim no contrato. Ex.: Espaço Jardim, Rua das Flores, 100, Campinas/SP."
              >
                <Textarea
                  id={ID.evLocalEndereco(i)}
                  value={local.endereco}
                  onChange={(e) => setLocal(i, { endereco: e.target.value.slice(0, 2000) })}
                  aria-describedby={`${ID.evLocalEndereco(i)}-dica`}
                  className="min-h-16"
                />
              </Campo>
            </div>
          );
        })}
        {evento.locais.length < MAXIMO_LOCAIS && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() =>
              set({
                locais: [
                  ...evento.locais,
                  { rotulo: evento.locais.length === 0 ? "Local do evento" : "", endereco: "" },
                ],
              })
            }
          >
            <Plus />
            Adicionar local
          </Button>
        )}
      </fieldset>

      {/* --------------------------------------------------------- making of */}
      {mostrarMakingOf && (
        <fieldset className="min-w-0 space-y-3">
          <legend className="text-xs font-medium">Making of</legend>
          {!temMakingOf && (
            <p className="text-xs text-muted-foreground">
              O pacote escolhido não tem making of: estes campos só entram no contrato se você incluir um.
            </p>
          )}
          {/* Textarea como os Locais: o endereco vai por extenso para o
              contrato, e num input de uma linha a Mel so o conferia rolando
              dentro do campo. */}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Campo id={ID.evMakingOfLocal} rotulo="Local do making of">
              <Textarea
                id={ID.evMakingOfLocal}
                value={evento.makingOfLocal}
                onChange={(e) => set({ makingOfLocal: e.target.value.slice(0, 2000) })}
                placeholder="A definir"
                className="min-h-16"
              />
            </Campo>
            <CampoTexto
              id={ID.evMakingOfHorario}
              rotulo="Início do making of"
              tipo="time"
              valor={evento.makingOfHorario}
              onValor={(v) => set({ makingOfHorario: v })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Em branco sai “A DEFINIR”, e o contrato dá à CONTRATANTE até 10 dias antes do evento para
            informar.
          </p>
        </fieldset>
      )}

      {/* ----------------------------------------------------------- ensaio */}
      {mostrarEnsaio && (
        <fieldset className="min-w-0 space-y-3">
          <legend className="text-xs font-medium">Ensaio fotográfico</legend>
          {!temEnsaio && (
            <p className="text-xs text-muted-foreground">
              O pacote escolhido não tem ensaio: estes campos só entram no contrato se o escopo tiver um.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              id={ID.evEnsaioData}
              rotulo="Data do ensaio"
              tipo="date"
              valor={evento.ensaioData}
              onValor={(v) => set({ ensaioData: v })}
              placeholder="A definir"
              dica={
                ensaioDepois
                  ? `Essa data (${dataCurta(evento.ensaioData)}) é depois do evento: o ensaio acontece antes.`
                  : undefined
              }
            />
            <CampoTexto
              id={ID.evEnsaioHorario}
              rotulo="Início do ensaio"
              tipo="time"
              valor={evento.ensaioHorario}
              onValor={(v) => set({ ensaioHorario: v })}
              placeholder="A definir"
            />
            <Campo id={ID.evEnsaioLocal} rotulo="Local do ensaio" className="sm:col-span-2">
              <Textarea
                id={ID.evEnsaioLocal}
                value={evento.ensaioLocal}
                onChange={(e) => set({ ensaioLocal: e.target.value.slice(0, 2000) })}
                placeholder="A definir"
                className="min-h-16"
              />
            </Campo>
          </div>
          <p className="text-xs text-muted-foreground">
            O ensaio é em outro dia, antes do evento. Em branco sai “A DEFINIR”: o que faltar fica de comum
            acordo, sujeito à sua agenda, e a CONTRATANTE agenda com no mínimo 10 dias de antecedência.
          </p>
        </fieldset>
      )}

      <Marcador
        id={ID.evAlimentacao}
        rotulo="Tem buffet/alimentação para a equipe"
        marcado={evento.alimentacao}
        onMarcado={(v) => set({ alimentacao: v })}
        dica="Desmarque em eventos sem buffet (uma cobertura curta na igreja, por exemplo): a cláusula da alimentação sai do contrato."
      />
    </div>
  );
}
