import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
// @ts-expect-error -- o Next não publica os tipos do path-to-regexp que ele embute (é o mesmo que casa as rotas do `headers()`)
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig from "@/next.config";
import { MIDIA } from "./midia.gerado";
import { HERO, ORCAMENTO, REELS } from "./reels";

// O manifesto (`reels.ts`) e a mídia gerada (`midia.gerado.ts` + arquivos em
// public/) andam juntos: esquecer de rodar o `lp:reels` depois de mexer num é
// quebrar a página no build, ou servir um arquivo que o hash não descreve.

const PUBLIC = path.join(process.cwd(), "public");
const arquivo = (url: string) => path.join(PUBLIC, url);

function confereHash(url: string) {
  const m = /\.([0-9a-f]{10})\.[a-z0-9]+$/.exec(url);
  assert.ok(m, `${url}: o nome não traz o hash do conteúdo`);
  const dados = fs.readFileSync(arquivo(url));
  const hash = createHash("sha256").update(dados).digest("hex").slice(0, 10);
  assert.equal(hash, m![1], `${url}: o conteúdo não bate com o hash do nome (rode npm run lp:reels)`);
  return dados.length;
}

test("todo Reel do manifesto tem mídia gerada, e nada sobra", () => {
  const ids = REELS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "id repetido no manifesto");
  assert.deepEqual(Object.keys(MIDIA.reels).sort(), [...ids].sort());
});

test("arquivos existem, o hash do nome bate e cada um cabe no orçamento", () => {
  let total = 0;
  for (const r of REELS) {
    const m = MIDIA.reels[r.id as keyof typeof MIDIA.reels];
    const video = confereHash(m.video);
    assert.ok(video <= ORCAMENTO.reel, `${r.id}: Reel com ${video} bytes`);
    assert.ok(confereHash(m.preview) <= ORCAMENTO.preview, `${r.id}: preview acima do orçamento`);
    assert.ok(confereHash(m.poster) <= ORCAMENTO.poster, `${r.id}: pôster acima do orçamento`);
    total += video;
  }
  assert.ok(total <= ORCAMENTO.reelsTotal, `Reels somam ${total} bytes`);
  assert.ok(confereHash(MIDIA.hero.teaser) <= ORCAMENTO.teaser);
  confereHash(MIDIA.hero.poster);
  confereHash(MIDIA.hero.posterJpg);
  for (const url of Object.values(MIDIA.marca)) confereHash(url);
});

test("a pasta de mídia não guarda arquivo órfão", () => {
  const usados = new Set(
    [
      ...Object.values(MIDIA.reels).flatMap((m) => [m.video, m.preview, m.poster]),
      MIDIA.hero.teaser,
      MIDIA.hero.poster,
      MIDIA.hero.posterJpg,
      ...Object.values(MIDIA.marca),
    ].map((u) => path.basename(u)),
  );
  for (const nome of fs.readdirSync(path.join(PUBLIC, "midia/casamento"))) {
    assert.ok(usados.has(nome), `${nome} não é usado por ninguém`);
  }
});

test("o teaser do hero sai de um Reel baixado e o trecho cabe nele", () => {
  assert.ok(HERO.trecho.fim > HERO.trecho.inicio);
  for (const r of REELS) assert.ok(r.trecho.fim > r.trecho.inicio, r.id);
});

test("immutable só na mídia, nunca na página", async () => {
  const regras = (await nextConfig.headers!()) ?? [];
  const imutaveis = regras.filter((r) => r.headers.some((h) => /immutable/.test(h.value)));
  assert.ok(imutaveis.length > 0, "a mídia perdeu o cache longo");
  const casa = (rota: string) => imutaveis.some((r) => (pathToRegexp(r.source) as RegExp).test(rota));
  assert.ok(casa(MIDIA.reels[REELS[0].id as keyof typeof MIDIA.reels].video));
  for (const pagina of ["/casamento", "/casamento/opengraph-image.jpg", "/formulario", "/"]) {
    assert.ok(!casa(pagina), `${pagina} receberia cache de um ano`);
  }
});
