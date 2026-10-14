import { tratarResultado } from "@/lib/whatsapp-automacao/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return tratarResultado(req, (await params).id);
}
