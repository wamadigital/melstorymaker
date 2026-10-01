import { ImageResponse } from "next/og";
import { CAIXA_MONOGRAMA_MEL, TRACADOS_MONOGRAMA_MEL } from "@/lib/marca/monograma";

// Favicon do site: o monograma MS da marca, no lugar do ícone padrão do Next
// que veio com o projeto. Desenhado a partir dos mesmos traçados do
// `MonogramaMel` (lib/marca/monograma.ts), nunca de uma cópia.
//
// Só o escuro e o creme da marca: o creme é tom da identidade completa, mas
// aqui é imagem, não CSS do app -- o `estilo:verificar` não alcança, e a regra
// das duas cores do site é sobre a interface, não sobre o ícone da aba.

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  const altura = 46;
  const largura = (altura * CAIXA_MONOGRAMA_MEL.largura) / CAIXA_MONOGRAMA_MEL.altura;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#20130a",
          borderRadius: 6,
        }}
      >
        <svg
          width={largura}
          height={altura}
          viewBox={`0 0 ${CAIXA_MONOGRAMA_MEL.largura} ${CAIXA_MONOGRAMA_MEL.altura}`}
          fill="none"
        >
          {TRACADOS_MONOGRAMA_MEL.map((d, i) => (
            <path key={i} d={d} fill="#f0e0c7" />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
