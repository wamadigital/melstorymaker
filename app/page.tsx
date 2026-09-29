import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// O dominio existe para uma coisa so: receber o lead que veio do link da Mel.
//
// A query vai junto: anuncio que aponta para a raiz chega com `fbclid` e
// `utm_*` na URL, e o redirect puro os descartava -- o clique chegava ao
// formulario sem nada que o ligasse ao anuncio (ver `lib/meta/rastreio.ts`).
export default async function Home({ searchParams }: Props) {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(valor) ? valor : valor ? [valor] : []) query.append(chave, v);
  }
  const qs = query.toString();
  redirect(qs ? `/formulario?${qs}` : "/formulario");
}
