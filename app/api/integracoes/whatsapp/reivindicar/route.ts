import { tratarReivindicacao } from "@/lib/whatsapp-automacao/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return tratarReivindicacao(req);
}
