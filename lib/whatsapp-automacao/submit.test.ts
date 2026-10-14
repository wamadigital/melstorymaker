import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";
import type { Respostas } from "@/lib/form/types";
import { MENSAGEM_CONFIRMACAO } from "./contrato";

// Processo de teste isolado; nenhum .env.local, after executado ou host real.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://submit-whatsapp.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-ficticio",
  SUPABASE_SERVICE_ROLE_KEY: "service-ficticio", MAIL_FROM: "Mel <mel@example.invalid>", MAIL_DRY_RUN: "1",
  APP_URL: "https://crm.invalid", MEL_WHATSAPP: "5519988887777", WHATSAPP_AUTOMACAO_ATIVA: "1",
});
const require = createRequire(import.meta.url);
const next = require("next/server") as { after: (tarefa: () => unknown) => void };
const ID = "c350bc94-24f1-4359-9e92-eac5f1a76e44";
const completas: Respostas = {
  contato_whatsapp: "19988887777", nome: "Ana Ficticia", noivos: "Ana & Joao",
  data: "2099-10-10", horario: "16:00", local_cerimonia: "Cerimonia ficticia",
  local_festa: "Festa ficticia", making_of: "Não", entrega: "Em tempo real", contato_email: "ana@example.invalid",
};

function instalar(statusInicial = "incompleto", falharRegistro = false) {
  let lead: Record<string, unknown> = { id: ID, categoria: "casamento", status: statusInicial,
    respostas: completas, passo_atual: "contato_email", updated_at: new Date(Date.now() - 1000).toISOString() };
  const registros: Record<string, unknown>[] = [];
  let escritas = 0;
  const rede = mock.method(globalThis, "fetch", async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    assert.equal(url.hostname, "submit-whatsapp.invalid", "qualquer rede real e proibida");
    if (url.pathname === "/rest/v1/rpc/registrar_confirmacao_whatsapp") {
      registros.push(JSON.parse(String(init?.body)));
      return falharRegistro ? Response.json({ code: "XX000", message: "falha ficticia" }, { status: 500 }) : Response.json(ID);
    }
    assert.equal(url.pathname, "/rest/v1/leads");
    const projetar = () => Object.fromEntries((url.searchParams.get("select") ?? "").split(",").map((k) => [k, lead[k]]));
    if ((init?.method ?? "GET") === "GET") return Response.json([projetar()]);
    assert.equal(init?.method, "PATCH");
    if (![...url.searchParams].every(([k, v]) => k === "select" || v === `eq.${lead[k]}`)) return Response.json([]);
    lead = { ...lead, ...JSON.parse(String(init?.body)), updated_at: new Date().toISOString() };
    escritas++;
    return Response.json([projetar()]);
  });
  const after = mock.method(next, "after", () => {});
  const log = mock.method(console, "error", () => {});
  return {
    registros, atual: () => lead, escritas: () => escritas,
    restaurar: () => { rede.mock.restore(); after.mock.restore(); log.mock.restore(); },
  };
}
const contexto = { params: Promise.resolve({ id: ID }) };
const req = (ip: string) => new Request(`https://crm.invalid/api/leads/${ID}/submit`, {
  method: "POST", headers: { "x-forwarded-for": ip },
});

test("dois submits concorrentes registram confirmacao apenas pelo CAS vencedor", async () => {
  const banco = instalar();
  try {
    const { POST } = await import("@/app/api/leads/[id]/submit/route");
    const respostas = await Promise.all([POST(req("concorrencia-whatsapp"), contexto), POST(req("concorrencia-whatsapp"), contexto)]);
    assert.deepEqual(respostas.map((r) => r.status), [200, 200]);
    assert.equal(banco.escritas(), 1); assert.equal(banco.registros.length, 1);
    assert.equal(banco.registros[0].p_mensagem, MENSAGEM_CONFIRMACAO);
    assert.equal(banco.registros[0].p_ocorrido_em, banco.atual().updated_at);
    assert.equal(banco.registros[0].p_destinatario, "5519988887777");
    await POST(req("concorrencia-whatsapp"), contexto);
    assert.equal(banco.registros.length, 1, "ACK perdido/reenvio nao registra historico");
    assert.equal(banco.atual().status, "aguardando_revisao");
    assert.equal(banco.atual().enviado_em, undefined);
  } finally { banco.restaurar(); }
});

test("erro de enqueue preserva sucesso/estado do formulario", async () => {
  const banco = instalar("incompleto", true);
  try {
    const { POST } = await import("@/app/api/leads/[id]/submit/route");
    const r = await POST(req("falha-whatsapp"), contexto);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, status: "aguardando_revisao" });
    assert.equal(banco.registros.length, 1); assert.equal(banco.escritas(), 1);
  } finally { banco.restaurar(); }
});

test("conclusao antiga e flag desativada nao enfileiram", async () => {
  const banco = instalar("aguardando_revisao");
  try {
    const { POST } = await import("@/app/api/leads/[id]/submit/route");
    assert.equal((await POST(req("historico-whatsapp"), contexto)).status, 200);
    assert.equal(banco.registros.length, 0);
  } finally { banco.restaurar(); }
  process.env.WHATSAPP_AUTOMACAO_ATIVA = "0";
  const desativado = instalar();
  try {
    const { POST } = await import("@/app/api/leads/[id]/submit/route");
    assert.equal((await POST(req("desativado-whatsapp"), contexto)).status, 200);
    assert.equal(desativado.registros.length, 0); assert.equal(desativado.escritas(), 1);
  } finally { desativado.restaurar(); process.env.WHATSAPP_AUTOMACAO_ATIVA = "1"; }
});
