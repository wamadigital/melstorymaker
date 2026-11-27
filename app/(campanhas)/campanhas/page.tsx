import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CascaPainel } from "@/components/admin/CascaPainel";
import { PainelCampanhas } from "@/components/admin/campanhas/PainelCampanhas";
import { getSessaoAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Campanhas | Mel Simão Storymaker",
  robots: { index: false, follow: false },
};

export default async function PaginaCampanhas({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!await getSessaoAdmin()) redirect("/admin/login?proximo=/campanhas");
  const id = z.uuid().safeParse((await searchParams).id);
  return (
    <CascaPainel>
      <PainelCampanhas idInicial={id.success ? id.data : null} />
    </CascaPainel>
  );
}
