/**
 * Prepara a mídia da `/casamento` a partir dos Reels brutos e das fontes da marca.
 *
 *   npm run lp:reels                # com a trilha dos Reels (decisão do owner)
 *   npm run lp:reels -- --sem-audio # tira a trilha de todos os Reels
 *
 * Lê `.lp-bruto/<id>.mp4` (baixado do Instagram da Mel com yt-dlp, formato
 * progressivo 720p) e `.lp-bruto/marca/` (exports do Figma), grava em
 * `public/midia/casamento/` e reescreve `app/casamento/midia.gerado.ts`.
 *
 * Por que três arquivos por Reel, e não um:
 * - o PREVIEW (5-6 s, sem áudio, ~400 KB) é o que a galeria toca sozinha. Se
 *   o card tocasse o Reel inteiro, cada swipe puxaria megabytes no 4G e o
 *   preview começaria pelo making of, que é o trecho mais fraco;
 * - o REEL completo (~90 s) só carrega quando a pessoa toca para assistir;
 * - o PÔSTER é o 1º quadro do preview, para a troca imagem -> vídeo não pular.
 *
 * Os nomes levam o hash do conteúdo porque `/midia/*` é servido como immutable
 * (next.config.ts): arquivo novo = nome novo, e cache velho nunca serve vídeo
 * antigo. Pelo mesmo motivo nada aqui é versionado à mão.
 *
 * ffmpeg e cwebp rodam SÓ aqui, no preparo, como o Ghostscript da arte. Em
 * produção a página serve arquivo estático.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HERO, ORCAMENTO, REELS } from "@/app/casamento/reels";

const exec = promisify(execFile);

const RAIZ = process.cwd();
const BRUTO = path.join(RAIZ, ".lp-bruto");
const SAIDA = path.join(RAIZ, "public/midia/casamento");
const URL_BASE = "/midia/casamento";
const GERADO = path.join(RAIZ, "app/casamento/midia.gerado.ts");

/**
 * Reel completo: 540x960 é o que um celular precisa em tela cheia sem pesar.
 * O teto de 1 Mbps só vale com -bufsize (sem ele o x264 ignora o -maxrate em
 * silêncio) e protege o 4G nos picos de cena de pista. GOP de 2 s para a barra
 * de progresso pular sem travar.
 */
const X264_REEL = [
  "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "slow",
  "-crf", "29", "-maxrate", "1000k", "-bufsize", "2000k",
  "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
];

/** Preview e teaser: só vídeo, curtos, em loop. */
const X264_CURTO = [
  "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-preset", "slow",
  "-crf", "29", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-an",
];

const LARGURA_PREVIEW = 432;
const ALTURA_PREVIEW = 768;


const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;
const kb = (b: number) => `${Math.round(b / 1024)} KB`;

async function garantirFerramentas() {
  for (const [bin, arg] of [["ffmpeg", "-version"], ["ffprobe", "-version"], ["cwebp", "-version"]] as const) {
    try {
      await exec(bin, [arg]);
    } catch {
      console.error(`\n${bin} não encontrado. Instale com \`brew install ${bin === "cwebp" ? "webp" : "ffmpeg"}\`.\n`);
      process.exit(1);
    }
  }
}

async function ffmpeg(args: string[]) {
  await exec("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
}

async function duracao(arquivo: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", arquivo,
  ]);
  return Math.round(Number(stdout.trim()) * 10) / 10;
}

async function temTrilha(arquivo: string): Promise<boolean> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", arquivo,
  ]);
  return stdout.trim().length > 0;
}

/** Move o arquivo temporário para `<base>.<hash>.<ext>` na saída e devolve a URL pública. */
async function publicar(tmp: string, base: string, ext: string): Promise<{ url: string; bytes: number }> {
  const dados = await fs.readFile(tmp);
  const hash = createHash("sha256").update(dados).digest("hex").slice(0, 10);
  const nome = `${base}.${hash}.${ext}`;
  await fs.writeFile(path.join(SAIDA, nome), dados);
  await fs.rm(tmp);
  return { url: `${URL_BASE}/${nome}`, bytes: dados.length };
}

async function webp(entrada: string, saida: string, qualidade: number, extra: string[] = []) {
  await exec("cwebp", ["-quiet", "-q", String(qualidade), "-m", "6", ...extra, entrada, "-o", saida]);
}

async function main() {
  const semAudio = process.argv.includes("--sem-audio");
  await garantirFerramentas();

  const faltando: string[] = [];
  for (const id of new Set([...REELS.map((r) => r.id), HERO.id])) {
    try {
      await fs.access(path.join(BRUTO, `${id}.mp4`));
    } catch {
      faltando.push(id);
    }
  }
  if (faltando.length) {
    console.error(
      `\nFaltam Reels brutos em .lp-bruto/: ${faltando.join(", ")}\n` +
        `Baixe com: yt-dlp -f "1/2/3" -o ".lp-bruto/%(id)s.%(ext)s" https://www.instagram.com/reel/<id>/\n`,
    );
    process.exit(1);
  }

  await fs.mkdir(SAIDA, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lp-reels-"));
  const tmp = (nome: string) => path.join(tmpDir, nome);

  const reels: Record<string, unknown> = {};
  let totalReels = 0;

  for (const r of REELS) {
    const bruto = path.join(BRUTO, `${r.id}.mp4`);
    const dur = await duracao(bruto);
    if (r.trecho.fim <= r.trecho.inicio || r.trecho.fim > dur) {
      throw new Error(`${r.id}: trecho ${r.trecho.inicio}-${r.trecho.fim}s fora do Reel (${dur}s).`);
    }
    process.stdout.write(`${r.id}  ${r.espaco} · ${r.quando}  `);

    // Reel completo. A trilha original já é AAC ~60 kbps: copia sem reencodar.
    const audio = semAudio ? ["-an"] : ["-c:a", "copy"];
    await ffmpeg([
      "-i", bruto, "-vf", "scale=540:960:flags=lanczos", ...X264_REEL, ...audio,
      "-movflags", "+faststart", tmp("reel.mp4"),
    ]);
    const comAudio = await temTrilha(tmp("reel.mp4"));
    const video = await publicar(tmp("reel.mp4"), r.id, "mp4");

    // Preview: -ss antes do -i é exato ao transcodificar (decodifica do keyframe anterior).
    const t = String(r.trecho.inicio);
    const len = String(r.trecho.fim - r.trecho.inicio);
    await ffmpeg([
      "-ss", t, "-t", len, "-i", bruto,
      "-vf", `scale=${LARGURA_PREVIEW}:${ALTURA_PREVIEW}:flags=lanczos`, ...X264_CURTO, "-maxrate", "600k", "-bufsize", "1200k",
      "-movflags", "+faststart", tmp("preview.mp4"),
    ]);
    const preview = await publicar(tmp("preview.mp4"), `${r.id}-preview`, "mp4");

    // Pôster = 1º quadro do preview.
    await ffmpeg(["-ss", t, "-i", bruto, "-frames:v", "1", "-vf", `scale=${LARGURA_PREVIEW}:${ALTURA_PREVIEW}:flags=lanczos`, tmp("poster.png")]);
    await webp(tmp("poster.png"), tmp("poster.webp"), 72);
    await fs.rm(tmp("poster.png"));
    const poster = await publicar(tmp("poster.webp"), `${r.id}-poster`, "webp");

    totalReels += video.bytes;
    reels[r.id] = {
      video: video.url,
      preview: preview.url,
      poster: poster.url,
      duracao: dur,
      temAudio: comAudio,
      bytes: { video: video.bytes, preview: preview.bytes, poster: poster.bytes },
    };
    console.log(`reel ${mb(video.bytes)} · preview ${kb(preview.bytes)} · pôster ${kb(poster.bytes)}${comAudio ? "" : " · sem áudio"}`);
  }

  // Hero: 540x960 porque ocupa a tela inteira; o LCP é o pôster, não o vídeo,
  // e o teaser só começa a baixar depois do `load`.
  {
    const bruto = path.join(BRUTO, `${HERO.id}.mp4`);
    const t = String(HERO.trecho.inicio);
    const len = String(HERO.trecho.fim - HERO.trecho.inicio);
    await ffmpeg([
      "-ss", t, "-t", len, "-i", bruto, "-vf", "scale=540:960:flags=lanczos", ...X264_CURTO,
      "-maxrate", "800k", "-bufsize", "1600k", "-movflags", "+faststart", tmp("teaser.mp4"),
    ]);
    await ffmpeg(["-ss", t, "-i", bruto, "-frames:v", "1", "-vf", "scale=720:1280:flags=lanczos", tmp("hero.png")]);
    await webp(tmp("hero.png"), tmp("hero.webp"), 70);
    // JPEG só para o opengraph-image: o satori do next/og não lê WebP.
    await ffmpeg(["-i", tmp("hero.png"), "-q:v", "4", tmp("hero.jpg")]);
    await fs.rm(tmp("hero.png"));
    const teaser = await publicar(tmp("teaser.mp4"), "hero-teaser", "mp4");
    const poster = await publicar(tmp("hero.webp"), "hero-poster", "webp");
    const posterJpg = await publicar(tmp("hero.jpg"), "hero-poster", "jpg");
    reels.__hero = { teaser: teaser.url, poster: poster.url, posterJpg: posterJpg.url, bytes: { teaser: teaser.bytes, poster: poster.bytes } };
    console.log(`hero  teaser ${kb(teaser.bytes)} · pôster ${kb(poster.bytes)}`);
  }

  // Marca: o recorte da Mel com o celular (board da identidade, Figma 7121:612)
  // e a onda topográfica 2x (7012:13). Os dois com transparência.
  const marcaDir = path.join(BRUTO, "marca");
  await webp(path.join(marcaDir, "mel-recorte.png"), tmp("mel.webp"), 78, ["-resize", "720", "0", "-alpha_q", "90"]);
  // Avatar: recorte quadrado do rosto, no mesmo arquivo de origem (1832x1832).
  await ffmpeg(["-i", path.join(marcaDir, "mel-recorte.png"), "-vf", "crop=760:760:520:300,scale=160:160:flags=lanczos", tmp("avatar.png")]);
  await webp(tmp("avatar.png"), tmp("avatar.webp"), 80, ["-alpha_q", "90"]);
  await fs.rm(tmp("avatar.png"));
  await webp(path.join(marcaDir, "onda.png"), tmp("onda.webp"), 70, ["-resize", "1240", "0", "-alpha_q", "70"]);
  const mel = await publicar(tmp("mel.webp"), "mel", "webp");
  const avatar = await publicar(tmp("avatar.webp"), "mel-avatar", "webp");
  const onda = await publicar(tmp("onda.webp"), "onda", "webp");
  console.log(`marca mel ${kb(mel.bytes)} · avatar ${kb(avatar.bytes)} · onda ${kb(onda.bytes)}`);

  // Apaga o que sobrou de execuções anteriores (hash antigo = arquivo órfão).
  const { __hero, ...soReels } = reels as Record<string, { video: string; preview: string; poster: string }> & {
    __hero: { teaser: string; poster: string; posterJpg: string };
  };
  const usados = new Set<string>([
    ...Object.values(soReels).flatMap((r) => [r.video, r.preview, r.poster]),
    __hero.teaser, __hero.poster, __hero.posterJpg, mel.url, avatar.url, onda.url,
  ].map((u) => path.basename(u)));
  for (const nome of await fs.readdir(SAIDA)) {
    if (!usados.has(nome)) await fs.rm(path.join(SAIDA, nome));
  }
  await fs.rm(tmpDir, { recursive: true, force: true });

  const conteudo = `// GERADO por \`npm run lp:reels\` (scripts/lp-reels.ts). Não editar à mão:
// os nomes levam o hash do conteúdo e o reels.test.ts confere cada um.
export const MIDIA = ${JSON.stringify(
    {
      reels: soReels,
      hero: __hero,
      marca: { mel: mel.url, avatar: avatar.url, onda: onda.url },
    },
    null,
    2,
  )} as const;
`;
  await fs.writeFile(GERADO, conteudo);

  console.log(`\nTotal dos Reels completos: ${mb(totalReels)} (teto ${mb(ORCAMENTO.reelsTotal)})`);
  if (totalReels > ORCAMENTO.reelsTotal) {
    console.error("Acima do orçamento: suba o CRF em X264_REEL ou tire um Reel do manifesto.");
    process.exit(1);
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
