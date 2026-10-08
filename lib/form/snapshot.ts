import type { Categoria, Respostas } from "./types";

/** Estado confirmado pelo servidor, usado como base de cada escrita pública. */
export type EstadoFormulario = {
  categoria: Categoria;
  respostas: Respostas;
  passo_atual: string | null;
};

export function copiarEstado(estado: EstadoFormulario): EstadoFormulario {
  return { ...estado, respostas: { ...estado.respostas } };
}

/** A ordem das chaves do jsonb não muda a versão das respostas. */
export function estadosIguais(a: EstadoFormulario, b: EstadoFormulario): boolean {
  return a.passo_atual === b.passo_atual && respostasIguais(a, b);
}

/** O encerramento pode mudar o passo, mas nunca confirma respostas diferentes. */
export function respostasIguais(
  a: Pick<EstadoFormulario, "categoria" | "respostas">,
  b: Pick<EstadoFormulario, "categoria" | "respostas">,
): boolean {
  if (a.categoria !== b.categoria) return false;
  const chaves = Object.keys(a.respostas);
  return chaves.length === Object.keys(b.respostas).length &&
    chaves.every((chave) => Object.prototype.hasOwnProperty.call(b.respostas, chave) && a.respostas[chave] === b.respostas[chave]);
}
