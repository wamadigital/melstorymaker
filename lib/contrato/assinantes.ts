import { assinaturasDoContrato } from "./clausulas";
import { baseDeRedacao, type ContextoMontagem } from "./montar";
import type { Assinante, DadosContrato, DocumentoContrato } from "./tipos";

const chave = (a: Assinante) => [a.papel, a.rotulo, a.nome, a.documento, a.email].join("\u0000");

/**
 * Confere apenas quem assina: editar clausulas, valores ou datas nao exige
 * reescrever o texto aprovado pela Mel. Identidade, e-mail, papeis e ordem
 * precisam continuar iguais aos dados usados para enviar os convites.
 * Compartilhado pelo painel e pelo servidor, sem rede nem escrita.
 */
export function assinantesConferemComDados(
  documento: DocumentoContrato,
  dados: DadosContrato,
  ctx: ContextoMontagem,
): boolean {
  try {
    const esperado = assinaturasDoContrato(baseDeRedacao(dados, ctx));
    return (
      esperado.length === documento.assinaturas.length &&
      esperado.every((a, i) => chave(a) === chave(documento.assinaturas[i]))
    );
  } catch {
    return false;
  }
}
