import "server-only";
import type { OpcoesCampanha } from "./contrato";

export function configuracaoCampanhas(e: Record<string, string | undefined> = process.env) {
  const segundos = Number(e.WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS ?? 60);
  const cadencia = Number.isInteger(segundos) && segundos >= 10 && segundos <= 86_400 ? segundos : 60;
  const workerAtivo = e.WHATSAPP_CAMPANHAS_WORKER_ATIVO === "true"
    && (e.WHATSAPP_WORKER_TOKEN?.length ?? 0) >= 32;
  const opcoes: OpcoesCampanha = { workerAtivo, enviosAtivos: workerAtivo, cadencia };
  return opcoes;
}
