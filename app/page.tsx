import { redirect } from "next/navigation";

// O dominio existe para uma coisa so: receber o lead que veio do link da Mel.
export default function Home() {
  redirect("/formulario");
}
