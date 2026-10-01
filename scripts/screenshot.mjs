/**
 * Screenshot de uma tela do app em viewport mobile de verdade.
 *
 *   node scripts/screenshot.mjs http://localhost:3000/formulario saida.png [largura]
 *     [--cookie "nome=valor; nome2=valor2"] [--inteira]
 *
 * Sem flag, o print corta em 2000px de altura. `--inteira` fotografa a pagina
 * toda (a landing page do /casamento passa disso): antes do tiro ela e rolada
 * ate o fim e de volta ao topo, porque secao que so monta ao entrar na tela
 * (IntersectionObserver) nao existe para quem nao rolou e sairia em branco.
 * Elemento fixo (barra de CTA) aparece onde fica com a pagina no topo.
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
const args = process.argv.slice(2);

// Cookie de sessao, para fotografar tela autenticada: sem ele o middleware
// manda /admin para /admin/login e o print sai da tela errada. Aceita o formato
// "nome=valor; nome2=valor2", que e o mesmo que o e2e-admin.ts ja monta.
const iCookie = args.indexOf("--cookie");
const cookieBruto = iCookie > -1 ? args[iCookie + 1] : null;
const inteira = args.includes("--inteira");

// Os posicionais sao o que sobra tirando as flags (e o valor do --cookie):
// assim a ordem entre flag e largura nao importa.
const [url, saida, larguraArg] = args.filter(
  (a, i) => !a.startsWith("--") && !(iCookie > -1 && i === iCookie + 1),
);
const largura = Number(larguraArg) || 360;

if (!url || !saida) {
  console.error(
    "\nUso: node scripts/screenshot.mjs <url> <saida.png> [largura] [--cookie \"n=v; n2=v2\"] [--inteira]\n",
  );
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

  if (cookieBruto) {
    await cdp("Network.enable");
    const dominio = new URL(url).hostname;
    for (const parte of cookieBruto.split("; ")) {
      const corte = parte.indexOf("=");
      if (corte < 1) continue;
      await cdp("Network.setCookie", {
        name: parte.slice(0, corte),
        value: parte.slice(corte + 1),
        domain: dominio,
        path: "/",
      });
    }
  }

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

  if (inteira) {
    // Mesma rolagem do verificar-estilo.mjs: uma tela por vez, altura relida a
    // cada passo (a secao que monta aumenta a pagina), `instant` para vencer
    // um scroll-behavior: smooth, e volta ao topo antes do tiro.
    await cdp("Runtime.evaluate", {
      awaitPromise: true,
      expression: `(async () => {
        const espera = (ms) => new Promise((r) => setTimeout(r, ms));
        const passo = window.innerHeight;
        for (let i = 0; i < 80; i++) {
          const antes = window.scrollY;
          if (antes + passo >= document.documentElement.scrollHeight - 1) break;
          window.scrollTo({ top: antes + passo, behavior: 'instant' });
          await espera(350);
          if (window.scrollY === antes) break;
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        await espera(500);
      })()`,
    });
  }

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
    clip: { x: 0, y: 0, width: largura, height: inteira ? m.altura : Math.min(m.altura, 2000), scale: 1 },
  });
  await fs.writeFile(saida, Buffer.from(tiro.data, "base64"));

  const estoura = m.scrollWidth > m.clientWidth;
  console.log(
    `  ${saida}  ${largura}px${inteira ? ` x ${m.altura}px (página inteira)` : ""}\n` +
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
