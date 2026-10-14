import { tratarReivindicacao } from "@/lib/whatsapp-automacao/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return tratarReivindicacao(req);
}
