import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { prepararUmaPropostaAutomatica } from "./preparar-proposta";
import { envelopeJob } from "./contrato";
import { sequenciaPropostaInicial } from "./proposta-inicial";
import type { gerarProposta } from "@/lib/pdf/gerar";

const ID = "30000000-0000-4000-8000-000000000001";
const TOKEN = "40000000-0000-4000-8000-000000000001";
const LINK = "https://site.invalid/p/a3f9";
const respostas = { nome: "Maria Eduarda", noivos: "Maria Eduarda & João", data: "2027-02-14", horario: "16:00",
  local_cerimonia: "Igreja Teste", local_festa: "Espaço Teste", making_of: "Não", entrega: "Em tempo real",
  contato_email: "ficticio@example.invalid", contato_whatsapp: "(19) 91234-5678" };
const preparo = { lead_id: ID, lease_token: TOKEN, categoria: "casamento", respostas, destinatario: "5519912345678" };
const pdf: Awaited<ReturnType<typeof gerarProposta>> = { bytes: new Uint8Array([37,80,68,70]),
  templateId: "casamento", rotuloTemplate: "Casamento", tabelaPreco: "2027", usouPlaceholder: false, usouFallbackDeFonte: false };

function sdk(opcoes: { preparo?: unknown; resultado?: boolean; gravacaoIncerta?: boolean } = {}) {
  const chamadas: { path: string; method: string; body: unknown }[] = [];
  const db = createClient("https://preparo.invalid", "service-ficticio", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      let body: unknown = init?.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
      chamadas.push({ path, method: init?.method ?? "GET", body });
      if (path.endsWith("/reivindicar_preparo_proposta_whatsapp")) return Response.json(opcoes.preparo ?? [preparo]);
      if (path.endsWith("/concluir_preparo_proposta_whatsapp")) return opcoes.gravacaoIncerta
        ? Response.json({ message: "conteúdo privado que não deve aparecer no log", code: "XX000" }, { status: 500 })
        : Response.json(opcoes.resultado ?? true);
      return Response.json(true);
    } },
  });
  return { db, chamadas };
}
const deps = { slug: async () => "a3f9", url: () => LINK, hoje: () => new Date("2026-10-15T12:00:00-03:00") };

test("preparo publica versão imutável antes de finalizar a fila; usa nome de quem respondeu", async () => {
  const { db, chamadas } = sdk();
  await prepararUmaPropostaAutomatica(db, { ...deps, gerar: async () => pdf });
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas[1].path.endsWith(`/automaticas/${ID}/${TOKEN}.pdf`));
  assert.deepEqual(chamadas[2].body, { p_lead_id: ID, p_token: TOKEN, p_nome: "Maria Eduarda", p_link: LINK,
    p_arquivo: `automaticas/${ID}/${TOKEN}.pdf` });
  assert.ok(!chamadas.some(c => c.path.endsWith(`/${ID}.pdf`)), "não sobrescreve o PDF manual");
});

test("dados incompletos ou telefone divergente bloqueiam geração e envio", async () => {
  const log = mock.method(console, "warn", () => {});
  try {
    for (const invalido of [{ ...preparo, respostas: { ...respostas, noivos: "" } }, { ...preparo, destinatario: "5519988887777" }]) {
      const { db, chamadas } = sdk({ preparo: [invalido] });
      await prepararUmaPropostaAutomatica(db, { ...deps, gerar: async () => { throw new Error("não pode renderizar"); } });
      assert.equal(chamadas.length, 2);
      assert.equal((chamadas[1].body as {p_definitivo:boolean}).p_definitivo, true);
      assert.ok(!chamadas.some(c => c.path.includes("/storage/")));
    }
  } finally { log.mock.restore(); }
});

test("resposta perdida do COMMIT nunca apaga o PDF que já pode ter sido publicado", async () => {
  const { db, chamadas } = sdk({ gravacaoIncerta: true });
  const log = mock.method(console, "warn", () => {});
  try { await prepararUmaPropostaAutomatica(db, { ...deps, gerar: async () => pdf }); }
  finally { log.mock.restore(); }
  assert.equal(chamadas.length, 4);
  assert.ok(chamadas[3].path.endsWith("/falhar_preparo_proposta_whatsapp"));
  assert.ok(chamadas.every(c => c.method !== "DELETE"));
});

test("CAS recusado explicitamente remove somente o upload desta reserva", async () => {
  const { db, chamadas } = sdk({ resultado: false });
  await prepararUmaPropostaAutomatica(db, { ...deps, gerar: async () => pdf });
  const remocao = chamadas.find(c => c.method === "DELETE");
  assert.deepEqual(remocao?.body, { prefixes: [`automaticas/${ID}/${TOKEN}.pdf`] });
});

test("worker antigo não recebe a nova copy e protocolo4 preserva somente o envelope autorizado", () => {
  const sequencia = sequenciaPropostaInicial("Maria Eduarda", LINK);
  const linha = { id: ID, lease_token: TOKEN, destinatario: preparo.destinatario, tipo: "proposta_inicial_15m",
    mensagem: sequencia.map(p => p.message).join("\n\n"), sequencia, expira_em: "2027-01-01T00:00:00Z", respostas };
  for (const protocolo of [1, 2, 3] as const) assert.throws(() => envelopeJob(linha, protocolo));
  const job = envelopeJob(linha, 4);
  assert.equal(job.tipo, "proposta_inicial_15m");
  assert.deepEqual(job.messagesSequence, sequencia);
  assert.equal(Object.hasOwn(job, "respostas"), false);
});
