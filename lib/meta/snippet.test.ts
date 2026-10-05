import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { snippetPixel } from "./snippet";

/** Roda o snippet num contexto falso e devolve o que ele chamou no `fbq` e guardou para a cópia. */
function rodar(s: string) {
  const chamadas: unknown[][] = [];
  const avisos: string[] = [];
  const janela: Record<string, unknown> = {
    dispatchEvent: (e: { type: string }) => avisos.push(e.type),
  };
  // `fbq` já definido: o stub do snippet sai cedo (`if(f.fbq)return`) e o
  // resto usa este.
  janela.fbq = (...args: unknown[]) => chamadas.push(args);
  janela.window = janela;
  vm.runInNewContext(s, { ...janela, document: {}, Event: class { constructor(public type: string) {} } });
  // Objetos de outro contexto têm outro protótipo: o JSON os traz para este, e o deepEqual estrito compara só o conteúdo.
  const aqui = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    chamadas: aqui(chamadas),
    iniciais: aqui(janela.__metaIniciais as { nome: string; id: string; dados: unknown }[]),
    avisos,
  };
}

test("sem eventos iniciais: init e PageView, com eventID, guardado para a cópia", () => {
  const { chamadas, iniciais, avisos } = rodar(snippetPixel("1234567890"));
  assert.deepEqual(chamadas[0], ["init", "1234567890"]);
  assert.equal(chamadas[1][0], "track");
  assert.equal(chamadas[1][1], "PageView");
  const id = (chamadas[1][3] as { eventID: string }).eventID;
  assert.match(id, /^PageView\.[a-z0-9]+\.[a-z0-9]+$/);
  assert.deepEqual(iniciais, [{ nome: "PageView", id, dados: {} }]);
  assert.deepEqual(avisos, ["meta:iniciais"]);
});

test("eventos iniciais saem depois do PageView, na ordem, com os dados e ids distintos", () => {
  const { chamadas, iniciais } = rodar(
    snippetPixel("1234567890", [
      { tipo: "track", nome: "ViewContent", dados: { content_category: "casamento" } },
      { tipo: "trackCustom", nome: "Outro" },
    ]),
  );
  assert.deepEqual(
    chamadas.slice(1).map((c) => c.slice(0, 3)),
    [
      ["track", "PageView", {}],
      ["track", "ViewContent", { content_category: "casamento" }],
      ["trackCustom", "Outro", {}],
    ],
  );
  assert.deepEqual(
    iniciais.map((e) => e.nome),
    ["PageView", "ViewContent", "Outro"],
  );
  assert.equal(new Set(iniciais.map((e) => e.id)).size, 3);
  // O id da cópia é o mesmo que o Pixel recebeu.
  assert.equal((chamadas[2][3] as { eventID: string }).eventID, iniciais[1].id);
});

test("aspas e </script> num valor não escapam do script", () => {
  const s = snippetPixel("1234567890", [{ tipo: "track", nome: "ViewContent", dados: { x: "a'b\"c</script><img>" } }]);
  assert.ok(!s.includes("</script>"));
  assert.ok(!s.includes("<img>"));
  // O valor continua o mesmo para o fbq: < é o próprio "<" em JS.
  const { chamadas } = rodar(s);
  assert.equal((chamadas[2][2] as { x: string }).x, "a'b\"c</script><img>");
});
