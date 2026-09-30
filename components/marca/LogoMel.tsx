import { CAIXA_LOGO_MEL, TRACADOS_LOGO_MEL } from "@/lib/marca/logo";

/**
 * Assinatura "Mel Storymaker", vinda da identidade no Figma (frame 7120:556).
 *
 * Inline, e nao <img src="/logo.svg">: o logo aparece no cabecalho de toda tela
 * autenticada, entao uma requisicao a mais atrasaria a primeira pintura -- e
 * inline ele herda a cor do texto.
 *
 * Os `fill` do arquivo original eram #20130A fixo. Aqui viram `currentColor`
 * para o logo seguir a cor da marca definida em CSS: se o escuro mudar, ou se
 * um dia isto for parar sobre fundo escuro, o desenho acompanha sem editar o
 * path. Quem define a cor e quem usa o componente.
 *
 * A altura vem por classe (`h-7` = 28px no cabecalho) e a largura sai sozinha
 * do viewBox, mantendo a proporcao 274x38.
 *
 * Os tracados moram em `lib/marca/logo.ts`, compartilhados com o PDF do
 * contrato, que desenha o mesmo logo no topo da primeira pagina.
 */
export function LogoMel({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${CAIXA_LOGO_MEL.largura} ${CAIXA_LOGO_MEL.altura}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Mel Storymaker"
    >
      {TRACADOS_LOGO_MEL.map((t, i) =>
        t.parImpar ? (
          <path key={i} fillRule="evenodd" clipRule="evenodd" d={t.d} fill="currentColor" />
        ) : (
          <path key={i} d={t.d} fill="currentColor" />
        ),
      )}
    </svg>
  );
}
