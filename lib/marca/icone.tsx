// O tsx (testes e scripts) compila JSX no modo classico (o tsconfig e
// "preserve", para o Next): sem o React no escopo, o `icone.test.ts` nao roda.
import React from "react";
import { CAIXA_MONOGRAMA_MEL, TRACADOS_MONOGRAMA_MEL } from "@/lib/marca/monograma";

// O icone do site: o monograma MS em creme sobre o escuro da marca, quadrado
// cheio. UM desenho para o favicon (`app/icon.tsx`) e para o icone da tela de
// inicio do iPhone (`app/apple-icon.tsx`), aprovado pelo owner em 06/10/2026
// -- os dois so mudam de tamanho em pixel.
//
// Quadrado cheio, sem canto arredondado: o iOS aplica a propria mascara, e um
// canto transparente viraria preto na tela de inicio. O monograma ocupa 60% da
// altura, longe dos cantos que o iPhone arredonda.
//
// Os tons: o escuro e o creme da identidade. O creme e da identidade completa
// (como na LP), mas aqui e imagem, nao CSS do app -- o `estilo:verificar` nao
// alcanca, e a regra das duas cores do site e sobre a interface, nao sobre o
// icone.

export const ICONE_MEL = { fundo: "#20130a", simbolo: "#f0e0c7", proporcao: 0.6 } as const;

/**
 * O icone em `lado` x `lado` px, como elemento para o `ImageResponse`.
 * Funcao e nao componente: o satori desenha elementos, e chamar direto evita
 * depender de como ele resolve componentes.
 */
export function iconeMel(lado: number) {
  const altura = Math.round(lado * ICONE_MEL.proporcao);
  const largura = (altura * CAIXA_MONOGRAMA_MEL.largura) / CAIXA_MONOGRAMA_MEL.altura;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ICONE_MEL.fundo,
      }}
    >
      <svg
        width={largura}
        height={altura}
        viewBox={`0 0 ${CAIXA_MONOGRAMA_MEL.largura} ${CAIXA_MONOGRAMA_MEL.altura}`}
        fill="none"
      >
        {TRACADOS_MONOGRAMA_MEL.map((d, i) => (
          <path key={i} d={d} fill={ICONE_MEL.simbolo} />
        ))}
      </svg>
    </div>
  );
}
