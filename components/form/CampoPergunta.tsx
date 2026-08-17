"use client";

import { CampoData } from "./campos/CampoData";
import { CampoEmail } from "./campos/CampoEmail";
import { CampoEscolhaUnica } from "./campos/CampoEscolhaUnica";
import { CampoHora } from "./campos/CampoHora";
import { CampoNumero } from "./campos/CampoNumero";
import { CampoTelefone } from "./campos/CampoTelefone";
import { CampoTexto } from "./campos/CampoTexto";
import type { CampoProps } from "./tipos";
import type { TipoPergunta } from "@/lib/form/types";

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
  const Componente = POR_TIPO[props.passo.tipo];

  if (!Componente) {
    // Tipo desconhecido no JSON: melhor um texto simples do que uma tela branca.
    return <CampoTexto {...props} />;
  }

  return <Componente {...props} />;
}
