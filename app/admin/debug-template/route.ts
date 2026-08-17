import { NextResponse } from "next/server";
import { TEMPLATES, isCategoria, type TemplateId } from "@/lib/form/types";
import { resolverTemplateId } from "@/lib/form/engine";
import { gerarPdfCalibracao } from "@/lib/pdf/grid";

export const runtime = "nodejs";

function ehTemplate(v: string | null): v is TemplateId {
  return !!v && (TEMPLATES as readonly string[]).includes(v);
}

/**
 * GET /admin/debug-template?template=aniversario_infantil
 *
 * Rota de calibracao das coordenadas (regra do CLAUDE.md: existe ANTES de
 * calibrar o primeiro template). Protegida pelo middleware do /admin.
 *
 * Aceita `?categoria=` por compatibilidade, mas so resolve o caso simples:
 * `aniversario` tem duas artes e precisa do `?template=` para desambiguar.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pedido = params.get("template");
  const categoria = params.get("categoria");

  let template: TemplateId;

  if (ehTemplate(pedido)) {
    template = pedido;
  } else if (isCategoria(categoria)) {
    if (categoria === "aniversario") {
      return NextResponse.json(
        {
          erro:
            "aniversario tem duas artes. Use ?template=aniversario_infantil " +
            "ou ?template=aniversario_adulto",
        },
        { status: 400 },
      );
    }
    template = resolverTemplateId(categoria, {});
  } else {
    return NextResponse.json(
      { erro: `Use ?template= com um destes: ${TEMPLATES.join(" | ")}` },
      { status: 400 },
    );
  }

  try {
    const bytes = await gerarPdfCalibracao(template);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="grid-${template}.pdf"`,
        // Calibrar e um ciclo de editar-e-recarregar: cache aqui atrapalha.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 404 });
  }
}
