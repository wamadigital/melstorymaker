import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "./LoginClient";

export const metadata: Metadata = {
  title: "Entrar | Painel da Mel",
  robots: { index: false, follow: false },
};

export default function PaginaLogin() {
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
