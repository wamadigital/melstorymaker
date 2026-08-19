/**
 * Confere as regras visuais travadas do projeto, direto no DOM renderizado.
 *
 *   npm run dev
 *   node scripts/verificar-estilo.mjs http://localhost:3000/formulario [...outras urls]
 *
 * O que verifica em cada URL:
 *   - todo border-radius nao nulo e 6px
 *   - toda fonte usada e DM Sans
 *   - toda cor de texto/fundo sai da paleta preto + #F1F1F1
 *   - nao ha scroll horizontal em 360px
 *   - todo elemento clicavel tem cursor: pointer
 *
 * Julgar isso por screenshot nao funciona: 6px num print em 2x parece 12, e
 * uma borda clara muda a leitura da curva. Aqui a resposta vem do
 * getComputedStyle de cada elemento da pagina.
 */
import { spawn } from "node:child_process";
import net from "node:net";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const urls = process.argv.slice(2);
const LARGURA = 360;

if (!urls.length) {
  console.error("\nUso: node scripts/verificar-estilo.mjs <url> [url...]\n");
  process.exit(1);
}

const portaLivre = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

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

// Roda DENTRO da pagina. Varre todo elemento visivel e coleta o que interessa.
const SONDA = `(() => {
  const raios = new Map(), fontes = new Set(), cores = new Map(), semPonteiro = new Map();
  const CLICAVEL = 'button, summary, select, a[href], [role=button], [role=menuitem], [role=radio], [role=option], [role=tab], [role=switch], input[type=checkbox], input[type=radio], input[type=file], input[type=submit]';
  const PALETA = new Set(['rgb(0, 0, 0)', 'rgb(241, 241, 241)', 'rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)']);
  for (const el of document.querySelectorAll('*')) {
    // O indicador de dev do Next.js (<nextjs-portal>) nao e o app: usa Geist e
    // some no build de producao. Contar as cores e fontes dele daria falha
    // falsa em toda execucao.
    if (el.closest('nextjs-portal') || el.tagName.toLowerCase().startsWith('nextjs-')) continue;
    const s = getComputedStyle(el);
    if (!s.width || s.display === 'none') continue;
    const marca = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '');
    for (const canto of ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius']) {
      const v = s[canto];
      if (v && v !== '0px' && !raios.has(v)) raios.set(v, marca);
    }
    (s.fontFamily || '').split(',').forEach(f => fontes.add(f.trim().replace(/^["']|["']$/g, '')));
    if (el.matches(CLICAVEL)) {
      // Desabilitado deve ser not-allowed, nao pointer: mao ali prometeria
      // uma acao que nao acontece.
      const inerte = el.disabled || el.getAttribute('aria-disabled') === 'true'
        || el.hasAttribute('data-disabled');
      const esperado = inerte ? 'not-allowed' : 'pointer';
      if (s.cursor !== esperado && !semPonteiro.has(marca)) {
        semPonteiro.set(marca, s.cursor + ' (esperado ' + esperado + ')');
      }
    }
    for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
      const v = s[prop];
      // Preto/claro com alfa continuam sendo a paleta: e o mesmo pigmento.
      const daPaleta = PALETA.has(v)
        || /^rgba?\\(0, 0, 0(,|\\))/.test(v)
        || /^rgba?\\(241, 241, 241(,|\\))/.test(v)
        || /^rgba?\\(255, 255, 255(,|\\))/.test(v);
      if (!daPaleta && !cores.has(v)) cores.set(v, marca + ' [' + prop + ']');
    }
  }
  return JSON.stringify({
    raios: [...raios].map(([v, onde]) => ({ valor: v, onde })),
    fontes: [...fontes],
    coresForaDaPaleta: [...cores].map(([v, onde]) => ({ valor: v, onde })),
    semPonteiro: [...semPonteiro].map(([onde, valor]) => ({ onde, valor })),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  });
})()`;

const porta = await portaLivre();
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${porta}`,
  "--user-data-dir=/tmp/chrome-verificar-estilo",
  "about:blank",
]);

let falhas = 0;
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
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: LARGURA, height: 800, deviceScaleFactor: 2, mobile: true,
  });

  for (const url of urls) {
    await cdp("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 3000));

    const res = await cdp("Runtime.evaluate", { expression: SONDA, returnByValue: true });
    const d = JSON.parse(res.result.value);

    console.log(`\n\x1b[1m${url}\x1b[0m`);

    const raiosErrados = d.raios.filter((r) => r.valor !== "6px");
    if (raiosErrados.length) {
      falhas++;
      console.log(`  \x1b[31m✗ raio\x1b[0m — esperado só 6px:`);
      raiosErrados.forEach((r) => console.log(`      ${r.valor}  em ${r.onde}`));
    } else {
      console.log(`  \x1b[32m✓ raio\x1b[0m — todos os cantos arredondados em 6px`);
    }

    const fontesErradas = d.fontes.filter(
      (f) => f && !/dmsans/i.test(f) && !/fallback/i.test(f),
    );
    if (fontesErradas.length) {
      falhas++;
      console.log(`  \x1b[31m✗ fonte\x1b[0m — fora da DM Sans: ${fontesErradas.join(", ")}`);
    } else {
      console.log(`  \x1b[32m✓ fonte\x1b[0m — só DM Sans (${d.fontes.join(", ")})`);
    }

    if (d.coresForaDaPaleta.length) {
      falhas++;
      console.log(`  \x1b[31m✗ paleta\x1b[0m — cor fora de preto/#F1F1F1:`);
      d.coresForaDaPaleta.forEach((c) => console.log(`      ${c.valor}  em ${c.onde}`));
    } else {
      console.log(`  \x1b[32m✓ paleta\x1b[0m — só preto, #F1F1F1 e branco`);
    }

    if (d.semPonteiro.length) {
      falhas++;
      console.log(`  \x1b[31m✗ cursor\x1b[0m — clicável sem cursor de mão:`);
      d.semPonteiro.forEach((c) => console.log(`      ${c.valor}  em ${c.onde}`));
    } else {
      console.log(`  \x1b[32m✓ cursor\x1b[0m — todo clicável tem cursor de mão`);
    }

    if (d.scrollWidth > d.clientWidth) {
      falhas++;
      console.log(`  \x1b[31m✗ largura\x1b[0m — estoura em ${LARGURA}px (${d.scrollWidth} > ${d.clientWidth})`);
    } else {
      console.log(`  \x1b[32m✓ largura\x1b[0m — cabe em ${LARGURA}px sem scroll horizontal`);
    }
  }
} finally {
  ws?.close();
  chrome.kill();
}

console.log(
  falhas
    ? `\n\x1b[31m\x1b[1m${falhas} verificação(ões) falharam.\x1b[0m\n`
    : `\n\x1b[32m\x1b[1mEstilo aprovado.\x1b[0m\n`,
);
process.exit(falhas ? 1 : 0);
