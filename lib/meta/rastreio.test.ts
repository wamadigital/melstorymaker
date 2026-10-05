import assert from "node:assert/strict";
import { test } from "node:test";
import { origemDaRequisicao, paraGuardar, rastreioDaRequisicao, rastreioGuardado } from "./rastreio";
import { EVENTO_DO_STATUS, idEvento } from "./eventos";
import { STATUS } from "@/lib/form/types";

function req(headers: Record<string, string>): Request {
  return new Request("https://melstorymaker.com.br/api/leads", { method: "POST", headers });
}

test("lê _fbp e _fbc dos cookies do Pixel", () => {
  const r = rastreioDaRequisicao(
    req({ cookie: "outro=1; _fbp=fb.1.1700000000000.987654; _fbc=fb.1.1700000000000.IwAR_x-1" }),
  );
  assert.deepEqual(r, { fbp: "fb.1.1700000000000.987654", fbc: "fb.1.1700000000000.IwAR_x-1" });
});

test("cookie fora do formato da Meta não vai para o banco", () => {
  const r = rastreioDaRequisicao(req({ cookie: "_fbp=<script>; _fbc=qualquer" }));
  assert.deepEqual(r, {});
});

test("sem _fbc, monta o fbc a partir do fbclid da página (Pixel bloqueado)", () => {
  const r = rastreioDaRequisicao(
    req({ referer: "https://melstorymaker.com.br/formulario?fbclid=IwAR123abc&utm_source=fb" }),
    1_700_000_000_000,
  );
  assert.deepEqual(r, { fbc: "fb.1.1700000000000.IwAR123abc" });
});

test("o cookie _fbc do MESMO clique fica, com a data original", () => {
  const r = rastreioDaRequisicao(
    req({
      cookie: "_fbc=fb.1.1600000000000.original",
      referer: "https://melstorymaker.com.br/formulario?fbclid=original",
    }),
    1_700_000_000_000,
  );
  assert.equal(r.fbc, "fb.1.1600000000000.original");
});

test("clique NOVO na URL vence o cookie de um clique anterior (remarketing)", () => {
  const r = rastreioDaRequisicao(
    req({
      cookie: "_fbc=fb.1.1600000000000.antigo",
      referer: "https://melstorymaker.com.br/casamento?fbclid=novo",
    }),
    1_700_000_000_000,
  );
  assert.equal(r.fbc, "fb.1.1700000000000.novo");
});

test("origem: ip desconhecido não é mandado como ip", () => {
  assert.deepEqual(origemDaRequisicao(req({ "user-agent": "UA" })), { userAgent: "UA" });
  assert.deepEqual(
    origemDaRequisicao(
      req({ "x-forwarded-for": "200.1.2.3, 10.0.0.1", referer: "https://melstorymaker.com.br/formulario" }),
    ),
    { ip: "200.1.2.3", url: "https://melstorymaker.com.br/formulario" },
  );
});

test("rastreio guardado: lead antigo (null) e jsonb torto viram objeto vazio", () => {
  assert.deepEqual(rastreioGuardado(null), {});
  assert.deepEqual(rastreioGuardado({ fbp: 42, fbc: "lixo", ua: "", ip: "não é ip" }), {});
  assert.deepEqual(rastreioGuardado({ fbc: "fb.1.1700000000000.abc" }), { fbc: "fb.1.1700000000000.abc" });
});

test("rastreio guardado: navegador volta com o nome de Pessoa (userAgent)", () => {
  assert.deepEqual(rastreioGuardado({ ua: "Mozilla/5.0 (iPhone)", ip: "2804:14c::1" }), {
    userAgent: "Mozilla/5.0 (iPhone)",
    ip: "2804:14c::1",
  });
});

test("paraGuardar: cookies + navegador + ip do lead, sem o que não presta", () => {
  assert.deepEqual(
    paraGuardar({ fbc: "fb.1.1700000000000.abc" }, { userAgent: "Mozilla/5.0", ip: "200.1.2.3", url: "x" }),
    { fbc: "fb.1.1700000000000.abc", ua: "Mozilla/5.0", ip: "200.1.2.3" },
  );
  // A URL nao vai para o banco; navegador gigante ou com quebra de linha tambem nao.
  assert.deepEqual(paraGuardar({}, { userAgent: "a".repeat(501) }), {});
  assert.deepEqual(paraGuardar({}, { userAgent: "linha\nquebrada" }), {});
});

test("nenhum evento de quadro para status que nasce de ação do lead", () => {
  // `incompleto` nunca e destino (CLAUDE.md) e `aguardando_revisao` ja tem o
  // SubmitApplication do proprio lead: evento aqui seria conversao dobrada.
  assert.equal(EVENTO_DO_STATUS.incompleto, undefined);
  assert.equal(EVENTO_DO_STATUS.aguardando_revisao, undefined);
  for (const status of Object.keys(EVENTO_DO_STATUS)) {
    assert.ok((STATUS as readonly string[]).includes(status), `${status} nao e status valido`);
  }
});

test("id do evento é o mesmo no navegador e no servidor (deduplicação)", () => {
  assert.equal(idEvento("lead", "abc"), "lead_abc");
  assert.equal(idEvento("enviado", "abc"), "enviado_abc");
});
