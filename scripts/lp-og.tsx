/**
 * Gera a imagem de compartilhamento da `/casamento` (a prévia do link no
 * WhatsApp, no Instagram e no Facebook).
 *
 *   npm run lp:og
 *
 * Desenha com o `next/og` (o mesmo satori que o Next usaria numa rota
 * `opengraph-image.tsx`) e grava um JPEG ESTÁTICO em
 * `app/casamento/opengraph-image.jpg`. Por que não a rota dinâmica: o
 * `ImageResponse` só devolve PNG, e com a foto do hero o PNG passava de 550 KB
 * -- o WhatsApp costuma descartar a prévia acima de ~300 KB. O JPEG fica em
 * ~100 KB.
 *
 * Rode de novo quando mudar o título da página ou o teaser do hero
 * (`npm run lp:reels` troca o pôster que entra aqui).
 */
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ImageResponse } from "next/og";
// O tsx compila JSX no modo clássico (o tsconfig é "preserve", para o Next).
import React from "react";
import { MIDIA } from "@/app/casamento/midia.gerado";
import { CAIXA_LOGO_MEL, TRACADOS_LOGO_MEL } from "@/lib/marca/logo";

const exec = promisify(execFile);
const SAIDA = path.join(process.cwd(), "app/casamento/opengraph-image.jpg");

async function main() {
  const [fonte, poster] = await Promise.all([
    readFile(path.join(process.cwd(), "assets/fonts/DMSans-Bold.ttf")),
    // O satori não lê WebP: o `lp:reels` gera esta cópia em JPEG só para isto.
    readFile(path.join(process.cwd(), "public", MIDIA.hero.posterJpg)),
  ]);
  const fundo = `data:image/jpeg;base64,${poster.toString("base64")}`;
  const larguraLogo = 300;
  const alturaLogo = (larguraLogo * CAIXA_LOGO_MEL.altura) / CAIXA_LOGO_MEL.largura;

  const imagem = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#20130a", fontFamily: "DM Sans" }}>
        <div
          style={{
            width: 720,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 64px 56px",
          }}
        >
          <svg width={larguraLogo} height={alturaLogo} viewBox={`0 0 ${CAIXA_LOGO_MEL.largura} ${CAIXA_LOGO_MEL.altura}`} fill="none">
            {TRACADOS_LOGO_MEL.map((t, i) => (
              <path key={i} d={t.d} fill="#f0e0c7" fillRule={t.parImpar ? "evenodd" : "nonzero"} />
            ))}
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 22, letterSpacing: 4, color: "#cbad95" }}>STORYMAKER DE CASAMENTOS</div>
            <div style={{ fontSize: 58, lineHeight: 1.08, color: "#f0e0c7", letterSpacing: -1 }}>
              Vocês vivem o casamento. Eu conto tudo nos stories.
            </div>
          </div>
          <div style={{ fontSize: 26, color: "#cbad95" }}>Campinas e região · @mel.storymaker</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- o satori só desenha <img> */}
        <img src={fundo} alt="" width={480} height={630} style={{ objectFit: "cover" }} />
      </div>
    ),
    { width: 1200, height: 630, fonts: [{ name: "DM Sans", data: fonte, weight: 700, style: "normal" }] },
  );

  const png = path.join(os.tmpdir(), `lp-og-${process.pid}.png`);
  await writeFile(png, Buffer.from(await imagem.arrayBuffer()));
  await exec("ffmpeg", ["-v", "error", "-y", "-i", png, "-q:v", "4", SAIDA]);
  await rm(png);
  const { size } = await import("node:fs").then((fs) => fs.statSync(SAIDA));
  console.log(`app/casamento/opengraph-image.jpg  ${Math.round(size / 1024)} KB`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
