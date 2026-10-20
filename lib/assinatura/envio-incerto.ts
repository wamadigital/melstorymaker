import "server-only";
import { AssinaturaError, type ResultadoEnvio } from "./adapter";

/**
 * A plataforma recebeu uma operacao que pode ter enviado os convites, mas a
 * resposta nao confirmou o resultado. O token conhecido permite consultar ou
 * cancelar o pedido; desfazer a reserva permitiria notificar todos de novo.
 * Nunca reutiliza a mensagem da causa, que pode conter dados de signatarios.
 */
export class EnvioAssinaturaIncertoError extends AssinaturaError {
  readonly resultado: ResultadoEnvio;

  constructor(resultado: ResultadoEnvio, causa?: unknown) {
    const erro = causa instanceof AssinaturaError ? causa : null;
    const codigo =
      erro?.codigo === "timeout" || erro?.codigo === "rede" ? erro.codigo : "resposta_invalida";
    super(
      "Não consegui confirmar se os convites de assinatura foram enviados. O pedido foi guardado para evitar um envio duplicado. Use “Atualizar status” para conferir ou “Cancelar envio” antes de tentar novamente.",
      { codigo, etapa: erro?.etapa ?? null, status: erro?.status ?? null },
    );
    this.name = "EnvioAssinaturaIncertoError";
    this.resultado = resultado;
  }
}
