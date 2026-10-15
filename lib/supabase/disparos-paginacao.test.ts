import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { lerDisparosWhatsApp } from "./disparos-whatsapp";

const AGORA = "2026-10-15T18:00:00Z";
const REVISAO = "2026-09-01T18:00:00Z";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Linha = {
  lead_id: string;
  tipo: "lembrete_proposta_7d";
  estado: "cancelado" | "enviado";
  enviado_em: string | null;
  ocorrido_em: string;
  proposta_enviado_em: string;
  ultimo_codigo: string | null;
};

function linha(lead_id: string, estado: Linha["estado"] = "enviado"): Linha {
  return { lead_id, tipo: "lembrete_proposta_7d", estado,
    enviado_em: estado === "enviado" ? AGORA : null, ocorrido_em: AGORA,
    proposta_enviado_em: REVISAO, ultimo_codigo: estado === "cancelado" ? "inactivity_recent" : null };
}

function bancoFicticio(linhas: Linha[], falharDepoisDaPrimeiraPagina = false) {
  const pedidos: URL[] = [];
  const db = createClient("https://database.example.invalid", "chave-ficticia", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      assert.equal(init?.method ?? "GET", "GET", "somente leitura, sem mutação");
      const url = new URL(String(input));
      pedidos.push(url);
      const ids = (url.searchParams.get("lead_id") ?? "").slice(4, -1).split(",");
      const inicio = Number(url.searchParams.get("offset") ?? 0);
      const limite = Number(url.searchParams.get("limit") ?? 1000);
      if (falharDepoisDaPrimeiraPagina && inicio > 0) {
        return new Response(JSON.stringify({ message: "falha fictícia da segunda página" }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      }
      const permitidas = linhas.filter((registro) => ids.includes(registro.lead_id));
      return new Response(JSON.stringify(permitidas.slice(inicio, inicio + limite)), {
        headers: { "content-type": "application/json" },
      });
    } },
  });
  return { db, pedidos };
}

test("ACK após mil cancelamentos permanece visível no histórico e no resumo da solicitação", async () => {
  const LEAD = id(1);
  const cancelamentos = Array.from({ length: 1000 }, () => linha(LEAD, "cancelado"));
  const { db, pedidos } = bancoFicticio([...cancelamentos, linha(LEAD)]);
  const resultado = await lerDisparosWhatsApp([LEAD], db);

  assert.equal(resultado.erro, false);
  assert.equal(pedidos.length, 2, "a segunda página contém o ACK de índice 1000");
  assert.deepEqual(pedidos.map((url) => [url.searchParams.get("offset"), url.searchParams.get("limit")]), [
    ["0", "1000"], ["1000", "1000"],
  ]);
  assert.ok(pedidos.every((url) => url.searchParams.get("order") === "id.asc"), "paginação usa ordem estável");
  assert.deepEqual(resultado.porLead.get(LEAD), [{
    tipo: "lembrete_proposta_7d", enviado_em: AGORA, proposta_enviado_em: REVISAO,
  }]);
  assert.equal(resultado.solicitacoesPorLead.get(LEAD)?.length, 1001);
  assert.equal(resultado.solicitacoesPorLead.get(LEAD)?.at(-1)?.estado, "enviado");
});

test("IDs repetidos são deduplicados e distribuídos em lotes de no máximo cem", async () => {
  const ids = Array.from({ length: 205 }, (_, i) => id(i + 1));
  const { db, pedidos } = bancoFicticio(ids.map((lead) => linha(lead)));
  const resultado = await lerDisparosWhatsApp([...ids, ids[0], ids[100]], db);

  assert.equal(resultado.erro, false);
  const lotes = pedidos.map((url) => (url.searchParams.get("lead_id") ?? "").slice(4, -1).split(","));
  assert.deepEqual(lotes.map((lote) => lote.length), [100, 100, 5]);
  assert.deepEqual(lotes.flat(), ids, "nenhum ID se perde ou se repete entre os lotes");
  assert.ok(pedidos.every((url) => url.toString().length < 5000), "consulta não cresce com todos os IDs do quadro");
  assert.equal(resultado.porLead.size, ids.length);
  assert.equal(resultado.solicitacoesPorLead.size, ids.length);
  assert.ok(ids.every((lead) => resultado.porLead.get(lead)?.[0].enviado_em === AGORA));
});

test("falha ao buscar página posterior não publica histórico parcial como se estivesse completo", async () => {
  const LEAD = id(1);
  const { db, pedidos } = bancoFicticio(Array.from({ length: 1001 }, () => linha(LEAD)), true);
  const resultado = await lerDisparosWhatsApp([LEAD], db);

  assert.equal(pedidos.length, 4, "primeira página e três tentativas da segunda");
  assert.equal(resultado.erro, true);
  assert.equal(resultado.porLead.size, 0);
  assert.equal(resultado.solicitacoesPorLead.size, 0);
});
