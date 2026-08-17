import { NextResponse } from "next/server";
import { isCategoria } from "@/lib/form/types";
import { gerarPdfCalibracao } from "@/lib/pdf/grid";

export const runtime = "nodejs";

/**
 * GET /admin/debug-template?categoria=casamento
 *
 * Rota de calibracao das coordenadas (regra do CLAUDE.md: existe ANTES de
 * calibrar o primeiro template). Protegida pelo middleware do /admin.
 * A logica de desenho vive em lib/pdf/grid.ts, para poder ser exercitada sem
 * sessao pelo `npm run pdf:verificar --grid`.
 */
export async function GET(req: Request) {
  const categoria = new URL(req.url).searchParams.get("categoria");

  if (!isCategoria(categoria)) {
    return NextResponse.json(
      { erro: "Use ?categoria=debutante|aniversario|casamento|corporativo" },
      { status: 400 },
    );
  }

  try {
    const bytes = await gerarPdfCalibracao(categoria);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="grid-${categoria}.pdf"`,
        // Calibrar e um ciclo de editar-e-recarregar: cache aqui atrapalha.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 404 });
  }
}
