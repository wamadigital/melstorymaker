import { NextResponse } from "next/server";
import { TEMPLATES, isCategoria, type TemplateId } from "@/lib/form/types";
import { resolverTemplateId } from "@/lib/form/engine";
import { gerarPdfCalibracao } from "@/lib/pdf/grid";
import { TABELAS_PRECO, TABELA_BASE, type TabelaPreco } from "@/lib/pdf/precos";

export const runtime = "nodejs";

function ehTemplate(v: string | null): v is TemplateId {
  return !!v && (TEMPLATES as readonly string[]).includes(v);
}

function ehTabela(v: string | null): v is TabelaPreco {
  return !!v && (TABELAS_PRECO as readonly string[]).includes(v);
}

/**
 * GET /admin/debug-template?template=aniversario_infantil&tabela=2027
 *
 * Rota de calibracao das coordenadas (regra do CLAUDE.md: existe ANTES de
 * calibrar o primeiro template). Protegida pelo middleware do /admin.
 *
 * Aceita `?categoria=` por compatibilidade, mas so resolve o caso simples:
 * `aniversario` tem duas artes e precisa do `?template=` para desambiguar.
 *
 * `?tabela=` escolhe a tabela de preco; sem ela, a tabela base. Cada tabela tem
 * PDF base proprio, entao calibrar uma arte nova exige abrir a arte DELA -- o
 * grid sobre a arte de 2026 nao prova nada sobre a de 2027.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pedido = params.get("template");
  const categoria = params.get("categoria");
  const pedidoTabela = params.get("tabela");

  if (pedidoTabela !== null && !ehTabela(pedidoTabela)) {
    return NextResponse.json(
      { erro: `Tabela inválida. Use uma destas: ${TABELAS_PRECO.join(" | ")}` },
      { status: 400 },
    );
  }
  const tabela: TabelaPreco = ehTabela(pedidoTabela) ? pedidoTabela : TABELA_BASE;

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
    // `aniversario` ja saiu no if acima, entao aqui a categoria sempre tem
    // arte de mesmo nome. O null so existe para o caso ambiguo.
    const resolvido = resolverTemplateId(categoria, {});
    if (!resolvido) {
      return NextResponse.json({ erro: `Categoria "${categoria}" é ambígua.` }, { status: 400 });
    }
    template = resolvido;
  } else {
    return NextResponse.json(
      { erro: `Use ?template= com um destes: ${TEMPLATES.join(" | ")}` },
      { status: 400 },
    );
  }

  try {
    const bytes = await gerarPdfCalibracao(template, tabela);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="grid-${template}-${tabela}.pdf"`,
        // Calibrar e um ciclo de editar-e-recarregar: cache aqui atrapalha.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 404 });
  }
}
