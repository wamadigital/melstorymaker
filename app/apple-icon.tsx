import { ImageResponse } from "next/og";
import { iconeMel } from "@/lib/marca/icone";

// Icone de quem salva o site na tela de inicio do iPhone. O Next gera o
// `<link rel="apple-touch-icon">` em todas as paginas a partir deste arquivo.
// O desenho e o mesmo do favicon (`lib/marca/icone.tsx`); 180 px e o tamanho
// que o iPhone usa.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(iconeMel(size.width), size);
}
