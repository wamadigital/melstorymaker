import { CAIXA_MONOGRAMA_MEL, TRACADOS_MONOGRAMA_MEL } from "@/lib/marca/monograma";

/**
 * O monograma "MS" da identidade (Figma 7121:660), em SVG inline com
 * `currentColor`, pelo mesmo motivo do `LogoMel`: quem usa define a cor por
 * classe, e o desenho nao custa uma requisicao.
 *
 * Decorativo por padrao (`aria-hidden`): onde ele aparece, o nome da Mel esta
 * escrito ao lado. Passe `rotulo` quando ele estiver sozinho.
 */
export function MonogramaMel({ className, rotulo }: { className?: string; rotulo?: string }) {
  return (
    <svg
      viewBox={`0 0 ${CAIXA_MONOGRAMA_MEL.largura} ${CAIXA_MONOGRAMA_MEL.altura}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...(rotulo ? { role: "img", "aria-label": rotulo } : { "aria-hidden": true })}
    >
      {TRACADOS_MONOGRAMA_MEL.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
