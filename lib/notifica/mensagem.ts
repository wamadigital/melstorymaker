import { arvore, normalizarOpcoes } from "@/lib/form/engine";
import { nomeContato, sujeitoDoEvento } from "@/lib/leads";
import { dataCurta } from "@/lib/pdf/formatadores";
import type { Categoria, Respostas } from "@/lib/form/types";

/**
 * Texto da notificacao interna de lead novo, enviada ao WhatsApp da Mel.
 *
 * CONTEUDO MINIMO DE PROPOSITO: a mensagem atravessa um gateway de terceiro,
 * entao levam so o sujeito do evento, a categoria, a data e quem preencheu.
 * O e-mail e o telefone do lead NUNCA entram aqui -- esses ficam no painel,
 * que e para onde o link aponta.
 *
 * Funcao pura, sem rede: o provedor que envia mora em adapter.ts.
 */
export function mensagemNovoLead(
  categoria: Categoria,
  respostas: Respostas,
  urlAdmin: string,
): string {
  // Rotulo humano da categoria, vindo do arvore.json -- nunca hardcoded.
  const rotulo =
    normalizarOpcoes(arvore.categoria.opcoes).find((o) => o.valor === categoria)?.rotulo ??
    categoria;

  const sujeito = sujeitoDoEvento(categoria, respostas);
  const contato = nomeContato(respostas);
  const data = respostas.data ? dataCurta(respostas.data) : null;

  const linhas = [
    "✨ Novo lead no formulário!",
    `${sujeito || contato} — ${rotulo}${data ? `, ${data}` : ""}`,
  ];
  // Quem preencheu so aparece quando nao e o proprio sujeito do evento.
  if (contato && contato !== sujeito) linhas.push(`Preenchido por ${contato}`);
  linhas.push(`Revisar e enviar: ${urlAdmin}`);

  return linhas.join("\n");
}
