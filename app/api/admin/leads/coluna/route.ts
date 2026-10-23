import { NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIAS, STATUS } from "@/lib/form/types";
import { normalizarFiltrosNavegacao } from "@/lib/admin/navegacao";
import { TAMANHO_LOTE_KANBAN } from "@/lib/admin/paginacao-kanban";
import { PERIODOS } from "@/lib/admin/periodo";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { lerColunaKanban } from "@/lib/supabase/coluna-kanban";

export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const parametros = z.object({
  status: z.enum(STATUS),
  quantidade: z.string().regex(/^\d+$/).transform(Number).refine(numero => Number.isSafeInteger(numero) &&
    numero >= TAMANHO_LOTE_KANBAN && numero <= 1_000_000 && numero % TAMANHO_LOTE_KANBAN === 0),
  q: z.string().optional(),
  categoria: z.enum(CATEGORIAS).optional(),
  periodo: z.enum(PERIODOS).optional(),
}).strict();

/** Leitura autenticada: não executa manutenção de leads nem inicia mensagens. */
export async function GET(req: Request) {
  try {
    if (!(await getSessaoAdmin())) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401, headers });

    const busca = new URL(req.url).searchParams;
    const repetido = [...busca.keys()].some(chave => busca.getAll(chave).length !== 1);
    const parsed = parametros.safeParse(Object.fromEntries(busca));
    if (repetido || !parsed.success) return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400, headers });

    const { status, quantidade, q, categoria, periodo } = parsed.data;
    const agoraMs = Date.now();
    const coluna = await lerColunaKanban({ status, quantidade,
      filtros: normalizarFiltrosNavegacao({ q, categoria, periodo }), agoraMs });
    if (coluna.erro) return NextResponse.json({ erro: "Não consegui carregar esta coluna. Tente novamente." }, { status: 503, headers });
    return NextResponse.json({ coluna, agoraMs }, { headers });
  } catch {
    console.error("[admin] não consegui carregar mais cartões do Kanban");
    return NextResponse.json({ erro: "Não consegui carregar esta coluna. Tente novamente." }, { status: 503, headers });
  }
}
