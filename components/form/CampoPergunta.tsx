"use client";

import { useRef, useState } from "react";
import { CaixaMarcacao } from "./CaixaMarcacao";
import { CampoData } from "./campos/CampoData";
import { CampoEmail } from "./campos/CampoEmail";
import { CampoEscolhaUnica } from "./campos/CampoEscolhaUnica";
import { CampoHora } from "./campos/CampoHora";
import { CampoNumero } from "./campos/CampoNumero";
import { CampoTelefone } from "./campos/CampoTelefone";
import { CampoTexto } from "./campos/CampoTexto";
import type { CampoProps } from "./tipos";
import { A_DEFINIR, ehADefinir, type TipoPergunta } from "@/lib/form/types";

// Mapa tipo -> componente. Uma pergunta nova no arvore.json com um tipo ja
// existente nao encosta neste arquivo; um tipo novo entra aqui e so aqui.
const POR_TIPO: Record<TipoPergunta, React.ComponentType<CampoProps>> = {
  texto: CampoTexto,
  data: CampoData,
  hora: CampoHora,
  escolha_unica: CampoEscolhaUnica,
  email: CampoEmail,
  telefone: CampoTelefone,
  numero: CampoNumero,
};

export function CampoPergunta(props: CampoProps) {
  // Tipo desconhecido no JSON: melhor um texto simples do que uma tela branca.
  const Componente = POR_TIPO[props.passo.tipo] ?? CampoTexto;

  if (props.passo.a_definir) {
    return <ComADefinir {...props} rotulo={props.passo.a_definir} Componente={Componente} />;
  }

  return <Componente {...props} />;
}

/**
 * O campo com a caixa "decidir depois" embaixo (`a_definir` no arvore.json).
 * Marcada, a resposta vira `A_DEFINIR` e o campo fica inativo; desmarcada,
 * volta o que a pessoa tinha digitado antes de marcar.
 *
 * A marca e estado PROPRIO, e nao `valor === A_DEFINIR` a cada render: senao
 * quem digitasse "A definir" no local veria o campo travar na ultima letra.
 * Ela nasce da resposta, e isso basta para a retomada e para o voltar: o
 * componente remonta a cada pergunta (a tela e chaveada pelo id do passo).
 */
function ComADefinir({
  Componente,
  rotulo,
  ...props
}: CampoProps & { Componente: React.ComponentType<CampoProps>; rotulo: string }) {
  const { passo, valor, onChange, onAvancar } = props;
  const [marcado, setMarcado] = useState(() => ehADefinir(valor));
  const digitado = useRef(marcado ? "" : valor);

  function alternar(marcar: boolean) {
    setMarcado(marcar);
    if (marcar) {
      digitado.current = valor;
      onChange(A_DEFINIR);
    } else {
      onChange(digitado.current);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Componente {...props} valor={marcado ? "" : valor} desabilitado={marcado} />
      <CaixaMarcacao
        id={`${passo.id}-a-definir`}
        rotulo={rotulo}
        marcado={marcado}
        onAlternar={alternar}
        onEnter={() => onAvancar()}
        className="min-h-11 text-base text-muted-foreground md:text-lg"
      />
    </div>
  );
}
