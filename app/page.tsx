import { redirect } from "next/navigation";
import { repassarQuery } from "@/lib/url";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// O dominio existe para uma coisa so: receber o lead que veio do link da Mel.
//
// A query vai junto: anuncio que aponta para a raiz chega com `fbclid` e
// `utm_*` na URL, e o redirect puro os descartava -- o clique chegava ao
// formulario sem nada que o ligasse ao anuncio (ver `lib/meta/rastreio.ts`).
// A LP `/casamento` repassa a query pelo mesmo helper, no clique do CTA.
export default async function Home({ searchParams }: Props) {
  redirect(repassarQuery("/formulario", await searchParams));
}
