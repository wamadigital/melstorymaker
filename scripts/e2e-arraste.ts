/**
 * Arraste REAL no quadro de leads, via CDP: pressiona o mouse no handle, move em
 * passos pequenos e solta, conferindo no BANCO que o status mudou.
 *
 *   npm run dev           # em outro terminal
 *   npm run e2e:arraste
 *
 * Existe porque arrastar e a feature central do quadro e nao da para verificar
 * por leitura de codigo. Ja valeu o preco: pegou que, com o droppable da coluna
 * proibida `disabled`, o closestCorners elegia o proximo droppable mais perto --
 * o cartao mirado em "Novo" era solto em "Aguardando revisao", em silencio.
 *
 * Nao substitui o teste em aparelho de toque: o MouseSensor e o TouchSensor sao
 * sensores diferentes, e a emulacao de toque do DevTools nao reproduz o
 * comportamento de Android real.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { createClient } from "@supabase/supabase-js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const REF = URL_SB.replace("https://", "").split(".")[0];
const EMAIL = `drag-${Date.now()}@wama.digital`;
const SENHA = `E2e!${Math.random().toString(36).slice(2)}Aa9`;

let falhas = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  falhas++;
};
const checar = (c: boolean, m: string) => (c ? ok(m) : erro(m));

let leadId = "";

async function portaLivre(): Promise<number> {
  return new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => r(port));
    });
  });
}
async function esperar<T>(fn: () => Promise<T>, n = 60): Promise<T> {
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("Chrome não subiu");
}

async function main() {
  console.log("\n\x1b[1mArraste real no quadro (CDP)\x1b[0m\n");

  await admin.auth.admin.createUser({ email: EMAIL, password: SENHA, email_confirm: true });
  const publico = createClient(URL_SB, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: sess } = await publico.auth.signInWithPassword({ email: EMAIL, password: SENHA });

  const { data: lead } = await admin
    .from("leads")
    .insert({
      categoria: "casamento",
      status: "aguardando_revisao",
      respostas: { nome: "Lúcia" },
      nome_display: "ARRASTA Teste",
      data_evento: "2027-08-31",
      email: "lead.teste@example.com",
      whatsapp: "19999998888",
      pdf_url: "https://exemplo.invalid/p.pdf",
    })
    .select("id")
    .single();
  leadId = lead!.id;
  ok(`lead semeado em aguardando_revisao (${leadId})`);

  const nomeCookie = `sb-${REF}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64url");
  const partes: string[] = [];
  for (let i = 0; i < valor.length; i += 3180) partes.push(valor.slice(i, i + 3180));
  const cookies = partes.length === 1
    ? [{ name: nomeCookie, value: valor }]
    : partes.map((p, i) => ({ name: `${nomeCookie}.${i}`, value: p }));

  const porta = await portaLivre();
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${porta}`, "--user-data-dir=/tmp/chrome-drag-quadro", "about:blank",
  ]);
  let ws: WebSocket | undefined;

  try {
    const alvo = await esperar(async () => {
      const r = await fetch(`http://127.0.0.1:${porta}/json/new?about:blank`, { method: "PUT" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
    ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws!.onopen = res as never; ws!.onerror = rej as never; });

    let id = 0;
    const pend = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.id && pend.has(m.id)) {
        const { resolve, reject } = pend.get(m.id)!;
        pend.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      }
    };
    const cdp = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, never>>((resolve, reject) => {
        const meu = ++id;
        pend.set(meu, { resolve: resolve as never, reject });
        ws!.send(JSON.stringify({ id: meu, method, params }));
      });

    await cdp("Page.enable");
    await cdp("Network.enable");
    for (const c of cookies) {
      await cdp("Network.setCookie", { ...c, domain: "localhost", path: "/" });
    }
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await cdp("Page.navigate", { url: "http://localhost:3000/admin" });
    await new Promise((r) => setTimeout(r, 5000));

    const avaliar = async (expr: string) => {
      const r = (await cdp("Runtime.evaluate", {
        expression: expr, returnByValue: true, awaitPromise: true,
      })) as unknown as { result: { value: string } };
      return JSON.parse(r.result.value);
    };

    // Centro do grip do cartao e centro da coluna "Virou cliente".
    const pontos = await avaliar(`JSON.stringify((() => {
      const grip = document.querySelector('[aria-label="Arrastar ARRASTA Teste"]');
      const colunas = [...document.querySelectorAll('section')];
      const alvo = colunas.find(s => s.textContent.includes('Virou cliente'));
      const g = grip && grip.getBoundingClientRect();
      const a = alvo && alvo.getBoundingClientRect();
      return {
        achouGrip: !!grip, achouColuna: !!alvo,
        gx: g ? g.x + g.width/2 : 0, gy: g ? g.y + g.height/2 : 0,
        ax: a ? a.x + a.width/2 : 0, ay: a ? a.y + 120 : 0,
      };
    })())`);

    checar(pontos.achouGrip, "handle de arraste presente no cartão");
    checar(pontos.achouColuna, 'coluna "Virou cliente" encontrada');
    if (!pontos.achouGrip || !pontos.achouColuna) throw new Error("elementos não encontrados");

    const mouse = (type: string, x: number, y: number) =>
      cdp("Input.dispatchMouseEvent", {
        type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1,
      });

    await mouse("mousePressed", pontos.gx, pontos.gy);
    // Passos pequenos: o MouseSensor ativa depois de 4px e o dnd-kit precisa de
    // varios mousemove para calcular a colisao.
    for (let i = 1; i <= 24; i++) {
      await mouse(
        "mouseMoved",
        pontos.gx + ((pontos.ax - pontos.gx) * i) / 24,
        pontos.gy + ((pontos.ay - pontos.gy) * i) / 24,
      );
      await new Promise((r) => setTimeout(r, 25));
    }
    await mouse("mouseReleased", pontos.ax, pontos.ay);
    await new Promise((r) => setTimeout(r, 2500));

    const { data: depois } = await admin
      .from("leads").select("status").eq("id", leadId).single();
    checar(
      depois?.status === "virou_cliente",
      `arrastar moveu o lead no banco: aguardando_revisao → ${depois?.status}`,
    );

    const noDom = await avaliar(`JSON.stringify((() => {
      const alvo = [...document.querySelectorAll('section')]
        .find(s => s.textContent.includes('Virou cliente'));
      return { temCartao: !!alvo && alvo.textContent.includes('ARRASTA Teste') };
    })())`);
    checar(noDom.temCartao, "cartão aparece na coluna de destino na tela");

    // ------- o guardrail: arrastar de volta para "Novo" nao pode mover nada
    const pontos2 = await avaliar(`JSON.stringify((() => {
      const grip = document.querySelector('[aria-label="Arrastar ARRASTA Teste"]');
      const novo = [...document.querySelectorAll('section')]
        .find(s => s.textContent.includes('Novo'));
      const g = grip && grip.getBoundingClientRect();
      const a = novo && novo.getBoundingClientRect();
      return {
        achou: !!grip && !!novo,
        gx: g ? g.x + g.width/2 : 0, gy: g ? g.y + g.height/2 : 0,
        ax: a ? a.x + a.width/2 : 0, ay: a ? a.y + 120 : 0,
      };
    })())`);
    checar(pontos2.achou, 'cartão e coluna "Novo" localizados para o 2º arraste');

    await mouse("mousePressed", pontos2.gx, pontos2.gy);
    for (let i = 1; i <= 24; i++) {
      await mouse(
        "mouseMoved",
        pontos2.gx + ((pontos2.ax - pontos2.gx) * i) / 24,
        pontos2.gy + ((pontos2.ay - pontos2.gy) * i) / 24,
      );
      await new Promise((r) => setTimeout(r, 25));
    }
    await mouse("mouseReleased", pontos2.ax, pontos2.ay);
    await new Promise((r) => setTimeout(r, 2500));

    const { data: guardado } = await admin
      .from("leads").select("status").eq("id", leadId).single();
    checar(
      guardado?.status === "virou_cliente",
      `arrastar para "Novo" NÃO moveu (segue ${guardado?.status})`,
    );
  } finally {
    ws?.close();
    chrome.kill();
    await limpar();
  }

  if (falhas) { console.log(`\n\x1b[31m\x1b[1m${falhas} falha(s).\x1b[0m\n`); process.exit(1); }
  console.log("\n\x1b[32m\x1b[1mArraste aprovado.\x1b[0m\n");
}

async function limpar() {
  if (leadId) await admin.from("leads").delete().eq("id", leadId);
  const { data } = await admin.auth.admin.listUsers();
  const t = data?.users.find((u) => u.email === EMAIL);
  if (t) await admin.auth.admin.deleteUser(t.id);
  ok("lead e admin temporários removidos");
}

main().catch(async (e) => { console.error(e); await limpar(); process.exit(1); });
