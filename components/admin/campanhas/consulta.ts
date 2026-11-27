export const API_CAMPANHAS = "/api/admin/campanhas";

export async function consultarCampanhas<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { cache: "no-store", ...init });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro ?? "Não consegui concluir a solicitação.");
  return dados as T;
}

export function enviarJson(method: string, dados: unknown, signal?: AbortSignal): RequestInit {
  return { method, signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) };
}

export function erroCampanha(erro: unknown) {
  return erro instanceof Error && erro.message !== "Failed to fetch" ? erro.message : "Não consegui me conectar ao sistema.";
}
