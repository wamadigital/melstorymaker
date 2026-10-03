/**
 * Prepara a mídia da `/casamento` a partir dos Reels brutos e das fontes da marca.
 *
 *   npm run lp:reels                # gera só o que falta ou mudou
 *   npm run lp:reels -- --sem-audio # tira a trilha de todos os Reels
 *   npm run lp:reels -- --refazer   # recodifica tudo (veja abaixo antes)
 *
 * Só recodifica o que mudou. Cada arquivo gerado guarda em `midia.gerado.ts`
 * os parâmetros de que saiu (`origem`): o Reel completo depende do áudio, o
 * preview e o pôster do trecho, o hero do Reel, do trecho e do recorte. Bateu
 * e o arquivo existe, fica o mesmo. Por que isso importa: recodificar NÃO sai
 * idêntico byte a byte (o x264 com várias threads varia de uma execução para
 * outra, medido em 03/10/2026), então refazer tudo troca o hash dos dez
 * vídeos -- ~96 MB novos no histórico de um repositório público e o cache
 * immutable de quem já assistiu jogado fora, por nada. Casamento novo
 * recodifica só o casamento novo. O que é WebP e JPEG (pôsteres, marca, foto
 * da imagem de compartilhamento) sai idêntico e é refeito sempre.
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

type Trecho = { inicio: number; fim: number };
type OrigemReel = { trecho: Trecho; semAudio: boolean };
type MidiaReel = {
  video: string;
  preview: string;
  poster: string;
  duracao: number;
  temAudio: boolean;
  bytes: { video: number; preview: number; poster: number };
  origem: OrigemReel;
};
type OrigemHero = { id: string; trecho: Trecho; recorteY: number };
type MidiaHero = { teaser: string; poster: string; fotoOg: string; bytes: { teaser: number; poster: number }; origem: OrigemHero };

const mesmoTrecho = (a: Trecho | undefined, b: Trecho) => !!a && a.inicio === b.inicio && a.fim === b.fim;

async function existe(url: string): Promise<boolean> {
  try {
    await fs.access(path.join(RAIZ, "public", url));
    return true;
  } catch {
    return false;
  }
}

/** O que a última execução gerou (vazio na primeira, sem `midia.gerado.ts`). */
async function geradoAntes(): Promise<{ reels: Record<string, MidiaReel | undefined>; hero?: MidiaHero }> {
  try {
    const { MIDIA } = await import("@/app/casamento/midia.gerado");
    return MIDIA as unknown as { reels: Record<string, MidiaReel | undefined>; hero?: MidiaHero };
  } catch {
    return { reels: {} };
  }
}

async function main() {
  const semAudio = process.argv.includes("--sem-audio");
  const refazer = process.argv.includes("--refazer");
  await garantirFerramentas();

  // Plano: o que se aproveita da execução anterior e o que precisa do bruto.
  const antes = await geradoAntes();
  const plano = await Promise.all(
    REELS.map(async (r) => {
      const a = antes.reels[r.id];
      const video = !refazer && !!a && a.origem.semAudio === semAudio && (await existe(a.video));
      const trecho = !refazer && !!a && mesmoTrecho(a.origem.trecho, r.trecho) && (await existe(a.preview)) && (await existe(a.poster));
      return { r, a, mantemVideo: video, mantemTrecho: trecho };
    }),
  );
  const origemHero: OrigemHero = { id: HERO.id, trecho: HERO.trecho, recorteY: HERO.recorteY };
  const h = antes.hero;
  const mantemHero =
    !refazer &&
    !!h &&
    JSON.stringify(h.origem) === JSON.stringify(origemHero) &&
    (await existe(h.teaser)) &&
    (await existe(h.poster)) &&
    (await existe(h.fotoOg));

  // Só pede o bruto do que vai ser codificado: com tudo aproveitado, dá para
  // rodar sem ter baixado os ~330 MB de Reels (o `.lp-bruto/` fica fora do git).
  const precisa = new Set(plano.filter((p) => !p.mantemVideo || !p.mantemTrecho).map((p) => p.r.id));
  precisa.add(HERO.id); // a foto da imagem de compartilhamento sai sempre do bruto do hero
  const faltando: string[] = [];
  for (const id of precisa) {
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
  const marcaDir = path.join(BRUTO, "marca");
  for (const nome of ["mel-recorte.png", "onda.png"]) {
    try {
      await fs.access(path.join(marcaDir, nome));
    } catch {
      console.error(`\nFalta .lp-bruto/marca/${nome} (export do Figma, ver comentário da marca abaixo).\n`);
      process.exit(1);
    }
  }

  await fs.mkdir(SAIDA, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lp-reels-"));
  const tmp = (nome: string) => path.join(tmpDir, nome);

  const reels: Record<string, MidiaReel> = {};
  let totalReels = 0;

  for (const { r, a, mantemVideo, mantemTrecho } of plano) {
    process.stdout.write(`${r.id}  ${r.espaco} · ${r.quando}  `);
    if (mantemVideo && mantemTrecho && a) {
      reels[r.id] = a;
      totalReels += a.bytes.video;
      console.log("mantido");
      continue;
    }
    const bruto = path.join(BRUTO, `${r.id}.mp4`);
    const dur = await duracao(bruto);
    if (r.trecho.fim <= r.trecho.inicio || r.trecho.fim > dur) {
      throw new Error(`${r.id}: trecho ${r.trecho.inicio}-${r.trecho.fim}s fora do Reel (${dur}s).`);
    }

    let video: { url: string; bytes: number };
    let comAudio: boolean;
    if (mantemVideo && a) {
      video = { url: a.video, bytes: a.bytes.video };
      comAudio = a.temAudio;
    } else {
      // Reel completo. A trilha original já é AAC ~60 kbps: copia sem reencodar.
      const audio = semAudio ? ["-an"] : ["-c:a", "copy"];
      await ffmpeg([
        "-i", bruto, "-vf", "scale=540:960:flags=lanczos", ...X264_REEL, ...audio,
        "-movflags", "+faststart", tmp("reel.mp4"),
      ]);
      comAudio = await temTrilha(tmp("reel.mp4"));
      video = await publicar(tmp("reel.mp4"), r.id, "mp4");
    }

    let preview: { url: string; bytes: number };
    let poster: { url: string; bytes: number };
    if (mantemTrecho && a) {
      preview = { url: a.preview, bytes: a.bytes.preview };
      poster = { url: a.poster, bytes: a.bytes.poster };
    } else {
      // Preview: -ss antes do -i é exato ao transcodificar (decodifica do keyframe anterior).
      const t = String(r.trecho.inicio);
      const len = String(r.trecho.fim - r.trecho.inicio);
      await ffmpeg([
        "-ss", t, "-t", len, "-i", bruto,
        "-vf", `scale=${LARGURA_PREVIEW}:${ALTURA_PREVIEW}:flags=lanczos`, ...X264_CURTO, "-maxrate", "600k", "-bufsize", "1200k",
        "-movflags", "+faststart", tmp("preview.mp4"),
      ]);
      preview = await publicar(tmp("preview.mp4"), `${r.id}-preview`, "mp4");

      // Pôster = 1º quadro do preview.
      await ffmpeg(["-ss", t, "-i", bruto, "-frames:v", "1", "-vf", `scale=${LARGURA_PREVIEW}:${ALTURA_PREVIEW}:flags=lanczos`, tmp("poster.png")]);
      await webp(tmp("poster.png"), tmp("poster.webp"), 72);
      await fs.rm(tmp("poster.png"));
      poster = await publicar(tmp("poster.webp"), `${r.id}-poster`, "webp");
    }

    totalReels += video.bytes;
    reels[r.id] = {
      video: video.url,
      preview: preview.url,
      poster: poster.url,
      duracao: dur,
      temAudio: comAudio,
      bytes: { video: video.bytes, preview: preview.bytes, poster: poster.bytes },
      origem: { trecho: { inicio: r.trecho.inicio, fim: r.trecho.fim }, semAudio },
    };
    const refeito = [!mantemVideo && "reel", !mantemTrecho && "preview e pôster"].filter(Boolean).join(" + ");
    console.log(
      `${refeito}: reel ${mb(video.bytes)} · preview ${kb(preview.bytes)} · pôster ${kb(poster.bytes)}${comAudio ? "" : " · sem áudio"}`,
    );
  }

  // Hero: o quadro 4:3 recortado nos noivos (`HERO.recorteY`), na resolução
  // do bruto (720 de largura), sem escala. O LCP é o pôster, não o vídeo, e o
  // teaser só começa a baixar depois do `load`.
  const bruto = path.join(BRUTO, `${HERO.id}.mp4`);
  const t = String(HERO.trecho.inicio);
  let hero: MidiaHero;
  if (mantemHero && h) {
    hero = h;
    console.log("hero  mantido");
  } else {
    const len = String(HERO.trecho.fim - HERO.trecho.inicio);
    const recorte = `crop=iw:iw*3/4:0:${HERO.recorteY}`;
    await ffmpeg([
      "-ss", t, "-t", len, "-i", bruto, "-vf", recorte, ...X264_CURTO,
      "-maxrate", "800k", "-bufsize", "1600k", "-movflags", "+faststart", tmp("teaser.mp4"),
    ]);
    await ffmpeg(["-ss", t, "-i", bruto, "-frames:v", "1", "-vf", recorte, tmp("hero.png")]);
    await webp(tmp("hero.png"), tmp("hero.webp"), 72);
    await fs.rm(tmp("hero.png"));
    const teaser = await publicar(tmp("teaser.mp4"), "hero-teaser", "mp4");
    const poster = await publicar(tmp("hero.webp"), "hero-poster", "webp");
    hero = { teaser: teaser.url, poster: poster.url, fotoOg: "", bytes: { teaser: teaser.bytes, poster: poster.bytes }, origem: origemHero };
    console.log(`hero  teaser ${kb(teaser.bytes)} · pôster ${kb(poster.bytes)}`);
  }
  // A foto da imagem de compartilhamento (`lp:og`) é o MESMO quadro, mas
  // vertical e inteiro: lá ela ocupa uma coluna em pé de 480x630. JPEG porque
  // o satori do next/og não lê WebP. Sai idêntica a cada execução.
  await ffmpeg(["-ss", t, "-i", bruto, "-frames:v", "1", "-vf", "scale=720:1280:flags=lanczos", "-q:v", "4", tmp("og.jpg")]);
  hero.fotoOg = (await publicar(tmp("og.jpg"), "og-foto", "jpg")).url;

  // Marca: o recorte da Mel com o celular (board da identidade, Figma 7121:612)
  // e a onda topográfica 2x (7012:13). Os dois com transparência.
  await webp(path.join(marcaDir, "mel-recorte.png"), tmp("mel.webp"), 78, ["-resize", "720", "0", "-alpha_q", "90"]);
  await webp(path.join(marcaDir, "onda.png"), tmp("onda.webp"), 70, ["-resize", "1240", "0", "-alpha_q", "70"]);
  const mel = await publicar(tmp("mel.webp"), "mel", "webp");
  const onda = await publicar(tmp("onda.webp"), "onda", "webp");
  console.log(`marca mel ${kb(mel.bytes)} · onda ${kb(onda.bytes)}`);

  // Apaga o que sobrou de execuções anteriores (hash antigo = arquivo órfão).
  const usados = new Set<string>([
    ...Object.values(reels).flatMap((r) => [r.video, r.preview, r.poster]),
    hero.teaser, hero.poster, hero.fotoOg, mel.url, onda.url,
  ].map((u) => path.basename(u)));
  for (const nome of await fs.readdir(SAIDA)) {
    if (!usados.has(nome)) await fs.rm(path.join(SAIDA, nome));
  }
  await fs.rm(tmpDir, { recursive: true, force: true });

  const conteudo = `// GERADO por \`npm run lp:reels\` (scripts/lp-reels.ts). Não editar à mão:
// os nomes levam o hash do conteúdo e o reels.test.ts confere cada um.
export const MIDIA = ${JSON.stringify(
    {
      reels,
      hero,
      marca: { mel: mel.url, onda: onda.url },
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
