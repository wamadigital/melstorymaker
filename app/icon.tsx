import { ImageResponse } from "next/og";
import { iconeMel } from "@/lib/marca/icone";

// Favicon do site: o mesmo desenho do icone da tela de inicio do iPhone
// (`app/apple-icon.tsx`), aprovado pelo owner em 06/10/2026 -- os dois saem de
// `lib/marca/icone.tsx` e so mudam de tamanho. 64 px cobre a aba em tela
// retina (32 px a 2x).

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(iconeMel(size.width), size);
}
