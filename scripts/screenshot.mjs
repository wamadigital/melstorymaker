/**
 * Screenshot de uma tela do app em viewport mobile de verdade.
 *
 *   node scripts/screenshot.mjs http://localhost:3000/formulario saida.png [largura]
 *
 * Existe porque `chrome --headless --window-size=360,780` NAO da um viewport de
 * 360px: o Chrome tem largura minima de janela no macOS, entao a pagina e
 * diagramada larga e a imagem sai apenas RECORTADA em 360 -- o que parece um
 * estouro de layout que nao existe. Aqui a emulacao vem do CDP
 * (Emulation.setDeviceMetricsOverride), que e o mesmo caminho do modo
 * dispositivo do DevTools.
 *
 * O CLAUDE.md exige desenvolver em 360px porque o cenario real e o navegador
 * in-app do WhatsApp. Sem este script nao da para conferir isso localmente.
 *
 * Ferramenta de inspecao, fora do bundle: nao entra em nenhuma rota.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [url, saida, larguraArg] = process.argv.slice(2);
const largura = Number(larguraArg) || 360;

if (!url || !saida) {
  console.error("\nUso: node scripts/screenshot.mjs <url> <saida.png> [largura]\n");
  process.exit(1);
}

async function portaLivre() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function esperar(fn, tentativas = 50, intervalo = 200) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch {
      await new Promise((r) => setTimeout(r, intervalo));
    }
  }
  throw new Error("tempo esgotado esperando o Chrome");
}

const porta = await portaLivre();
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${porta}`,
  "--user-data-dir=/tmp/chrome-screenshot-perfil",
  "about:blank",
]);

let ws;
try {
  const alvo = await esperar(async () => {
    const r = await fetch(`http://127.0.0.1:${porta}/json/new?about:blank`, { method: "PUT" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

  ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pendentes = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { resolve, reject } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const meu = ++id;
      pendentes.set(meu, { resolve, reject });
      ws.send(JSON.stringify({ id: meu, method, params }));
    });

  await cdp("Page.enable");
  // O que o --window-size nao faz: viewport real de <largura>px, com
  // deviceScaleFactor 2 e mobile=true (o meta viewport passa a valer).
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: largura,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 3500)); // fontes + animacao de entrada

  const metricas = await cdp("Runtime.evaluate", {
    expression: `JSON.stringify({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      altura: document.documentElement.scrollHeight,
      fonte: getComputedStyle(document.body).fontFamily,
      raio: getComputedStyle(document.querySelector('button, a[class*=bg-primary]') || document.body).borderRadius,
    })`,
    returnByValue: true,
  });
  const m = JSON.parse(metricas.result.value);

  const tiro = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: largura, height: Math.min(m.altura, 2000), scale: 1 },
  });
  await fs.writeFile(saida, Buffer.from(tiro.data, "base64"));

  const estoura = m.scrollWidth > m.clientWidth;
  console.log(
    `  ${saida}  ${largura}px\n` +
      `  fonte:  ${m.fonte}\n` +
      `  raio:   ${m.raio}\n` +
      `  ${estoura ? "\x1b[31m✗ ESTOURA na horizontal" : "\x1b[32m✓ sem scroll horizontal"}` +
      ` (scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth})\x1b[0m`,
  );
  if (estoura) process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
}
