/**
 * Confere as regras visuais travadas do projeto, direto no DOM renderizado.
 *
 *   npm run dev
 *   node scripts/verificar-estilo.mjs http://localhost:3000/formulario [...outras urls]
 *
 * O `npm run estilo:verificar` aponta para a porta 3000, que e o padrao do
 * Next. Nesta maquina a 3000 e de outro projeto: com o dev em outra porta,
 * chame o script direto com as URLs dessa porta.
 *
 * O que verifica em cada URL:
 *   - todo border-radius nao nulo e 6px
 *   - toda fonte usada e DM Sans
 *   - toda cor de texto/fundo sai da paleta da URL (ver paletaDaUrl): o app
 *     inteiro fica em #20130A + #F1F1F1; so /casamento usa a identidade
 *     completa da marca
 *   - nao ha scroll horizontal em 360px
 *   - todo elemento clicavel tem cursor: pointer
 *
 * Julgar isso por screenshot nao funciona: 6px num print em 2x parece 12, e
 * uma borda clara muda a leitura da curva. Aqui a resposta vem do
 * getComputedStyle de cada elemento da pagina.
 *
 * Antes de sondar, a pagina e rolada ate o fim e de volta ao topo: secao que
 * so monta ao entrar na tela (IntersectionObserver) nao existe no DOM de quem
 * nao rolou, e passaria sem ser vista.
 *
 * Falham por desenho, e nao sao falso positivo: circulo (rounded-full, que o
 * Tailwind v4 compila para um raio gigante) e veu preto (bg-black/60). O raio
 * e 6px em tudo, e preto nao e tom da marca -- o escurecimento sai do
 * #20130A com alfa.
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

// Cada tom nas notacoes em que o getComputedStyle pode devolve-lo: rgb()
// (com ou sem alfa) e oklab(). O oklab existe porque os modificadores de
// opacidade do Tailwind v4 (border-foreground/25, text-primary-foreground/70)
// nao viram rgba(): compilam para color-mix(in oklab, ...). E o mesmo pigmento
// com alfa -- a comparacao e por valor, com tolerancia, porque a serializacao
// tem casas decimais que variam. Valores de OKLab pelas matrizes do Bjorn
// Ottosson (sRGB > linear > LMS > OKLab), conferidos contra o Chrome.
const TOM = {
  escuro: { hex: "#20130A", rgb: [32, 19, 10], oklab: [0.201556, 0.0155654, 0.0223916] },
  marrom: { hex: "#4D2B22", rgb: [77, 43, 34], oklab: [0.33016, 0.043306, 0.031059] },
  terracota: { hex: "#823B25", rgb: [130, 59, 37], oklab: [0.441945, 0.082217, 0.063796] },
  areia: { hex: "#CBAD95", rgb: [203, 173, 149], oklab: [0.767656, 0.023636, 0.042042] },
  creme: { hex: "#F0E0C7", rgb: [240, 224, 199], oklab: [0.913026, 0.0071, 0.03686] },
  claro: { hex: "#F1F1F1", rgb: [241, 241, 241], oklab: [0.958141, 0.0000436902, 0.0000191331] },
  branco: { hex: "#FFFFFF", rgb: [255, 255, 255], oklab: [1, 0, 0] },
};

// Qual paleta vale para a URL. Tres listas porque a do app nao aceita todo
// tom em toda notacao: `exatos` e rgb() opaco, `comAlfa` aceita rgb()/rgba()
// com qualquer alfa, `oklab` e o color-mix do Tailwind (com ou sem alfa).
function paletaDaUrl(url) {
  // So a landing page do casamento usa a identidade completa da Mel (Figma,
  // frame 7120:556): os quatro tons, o creme, o claro do app e o branco.
  // Decisao do owner em 01/10/2026. Qualquer outra URL segue nas duas cores.
  if (/^\/casamento(\/|$)/.test(new URL(url).pathname)) {
    const tons = [TOM.escuro, TOM.marrom, TOM.terracota, TOM.areia, TOM.creme, TOM.claro, TOM.branco];
    return {
      nome: "identidade completa da marca (só /casamento)",
      descricao: "#20130A, #4D2B22, #823B25, #CBAD95, #F0E0C7, #F1F1F1 e branco",
      exatos: tons,
      comAlfa: tons,
      oklab: tons,
    };
  }
  // #20130A e o escuro da marca; #F1F1F1 o claro; branco e a superficie de
  // card. A terracota (#823B25) entra so como anel de foco, que nao cai em
  // color/background/border -- fica listada, opaca, para o dia em que cair.
  return {
    nome: "paleta do app (duas cores)",
    descricao: "#20130A, #F1F1F1 e branco",
    exatos: [TOM.escuro, TOM.claro, TOM.branco, TOM.terracota],
    comAlfa: [TOM.escuro, TOM.claro, TOM.branco],
    oklab: [TOM.escuro, TOM.claro, TOM.branco],
  };
}

// Roda DENTRO da pagina, antes da sonda. Desce uma tela por vez ate o fim (a
// altura e relida a cada passo, porque a secao que monta aumenta a pagina) e
// volta ao topo. `instant` vence um scroll-behavior: smooth do CSS, que faria
// cada passo virar animacao e o observer nunca disparar a tempo. Pagina que
// nao sai do lugar (scroll travado) para no primeiro passo; o teto segura
// pagina de rolagem infinita.
const ROLAGEM = `(async () => {
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
})()`;

// Roda DENTRO da pagina. Varre todo elemento visivel e coleta o que interessa.
// A paleta desce ja na forma em que o getComputedStyle serializa.
const sonda = (paleta) => `(() => {
  const raios = new Map(), fontes = new Set(), cores = new Map(), semPonteiro = new Map();
  const CLICAVEL = 'button, summary, select, a[href], [role=button], [role=menuitem], [role=radio], [role=option], [role=tab], [role=switch], input[type=checkbox], input[type=radio], input[type=file], input[type=submit]';
  const EXATOS = new Set([...${JSON.stringify(paleta.exatos.map((t) => `rgb(${t.rgb.join(", ")})`))}, 'rgba(0, 0, 0, 0)']);
  const COM_ALFA = new Set(${JSON.stringify(paleta.comAlfa.map((t) => t.rgb.join(", ")))});
  const OKLAB = ${JSON.stringify(paleta.oklab.map((t) => t.oklab))};
  // Os tres canais de um rgb()/rgba(), sem o alfa: "32, 19, 10".
  const canaisRgb = (v) => {
    const m = /^rgba?\\((\\d+), (\\d+), (\\d+)(?=,|\\))/.exec(v);
    return m ? m[1] + ', ' + m[2] + ', ' + m[3] : null;
  };
  const ehOklabDaPaleta = (v) => {
    const m = /^oklab\\(\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)/.exec(v);
    if (!m) return false;
    const [l, a, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return OKLAB.some(
      ([L, A, B]) => Math.abs(l - L) < 0.01 && Math.abs(a - A) < 0.01 && Math.abs(b - B) < 0.01,
    );
  };
  for (const el of document.querySelectorAll('*')) {
    // O indicador de dev do Next.js (<nextjs-portal>) nao e o app: usa Geist e
    // some no build de producao. Contar as cores e fontes dele daria falha
    // falsa em toda execucao.
    if (el.closest('nextjs-portal') || el.tagName.toLowerCase().startsWith('nextjs-')) continue;
    const s = getComputedStyle(el);
    // So display: none fica de fora. visibility: hidden e opacity: 0 entram
    // de proposito: o visualizador de Reels e a barra fixa de CTA do
    // /casamento ficam montados e escondidos assim, e e so dessa forma que a
    // sonda os alcanca sem precisar clicar.
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
      // Tom da paleta com alfa continua sendo a paleta: e o mesmo pigmento.
      const daPaleta = EXATOS.has(v)
        || ehOklabDaPaleta(v)
        || COM_ALFA.has(canaisRgb(v))
        || /^rgba?\\(0, 0, 0, 0(\\)|,)/.test(v);
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
    const paleta = paletaDaUrl(url);
    console.log(`\n\x1b[1m${url}\x1b[0m`);

    // Servidor fora do ar nao e pagina: sem isto a sonda rodaria sobre a tela
    // de erro do proprio Chrome e acusaria as cores e fontes dela.
    const nav = await cdp("Page.navigate", { url });
    if (nav.errorText) {
      falhas++;
      console.log(`  \x1b[31m✗ carregar\x1b[0m — ${nav.errorText} (o servidor está no ar nessa porta?)`);
      continue;
    }
    await new Promise((r) => setTimeout(r, 3000));
    await cdp("Runtime.evaluate", { expression: ROLAGEM, awaitPromise: true });

    const res = await cdp("Runtime.evaluate", { expression: sonda(paleta), returnByValue: true });
    const d = JSON.parse(res.result.value);

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
      console.log(`  \x1b[31m✗ paleta\x1b[0m — cor fora da ${paleta.nome}, que aceita só ${paleta.descricao}:`);
      d.coresForaDaPaleta.forEach((c) => console.log(`      ${c.valor}  em ${c.onde}`));
    } else {
      console.log(`  \x1b[32m✓ paleta\x1b[0m — ${paleta.nome}: só ${paleta.descricao}`);
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
