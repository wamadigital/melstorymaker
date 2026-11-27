import { z } from "zod";
import { getSessaoAdmin } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { BUCKET_CAMPANHAS } from "@/lib/campanhas/banco";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSessaoAdmin()) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const db = supabaseAdmin();
  const { data, error } = await db.from("campanhas_whatsapp").select("imagem").eq("id", id).maybeSingle();
  if (error) return new Response(null, { status: 503 });
  if (!data?.imagem) return new Response(null, { status: 404 });
  const arquivo = await db.storage.from(BUCKET_CAMPANHAS).download(data.imagem);
  if (arquivo.error) return new Response(null, { status: 503 });
  return new Response(arquivo.data, { headers: {
    "Content-Type": arquivo.data.type, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache",
  } });
}
