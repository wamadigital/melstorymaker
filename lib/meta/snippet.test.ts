import assert from "node:assert/strict";
import { test } from "node:test";
import { snippetPixel } from "./snippet";

test("sem eventos iniciais, o snippet termina no PageView", () => {
  const s = snippetPixel("1234567890");
  assert.ok(s.endsWith("fbq('init','1234567890');fbq('track','PageView');"));
});

test("eventos iniciais saem depois do PageView, na ordem, com os dados", () => {
  const s = snippetPixel("1234567890", [
    { tipo: "track", nome: "ViewContent", dados: { content_category: "casamento" } },
    { tipo: "trackCustom", nome: "Outro" },
  ]);
  const depois = s.split("fbq('track','PageView');")[1];
  assert.equal(depois, 'fbq("track","ViewContent",{"content_category":"casamento"});fbq("trackCustom","Outro",{});');
});

test("aspas e </script> num valor não escapam do script", () => {
  const s = snippetPixel("1234567890", [{ tipo: "track", nome: "ViewContent", dados: { x: "a'b\"c</script><img>" } }]);
  assert.ok(!s.includes("</script>"));
  assert.ok(!s.includes("<img>"));
  // O valor continua o mesmo para o fbq: < é o próprio "<" em JS.
  const chamada = s.split("fbq('track','PageView');")[1];
  const dados = JSON.parse(chamada.slice(chamada.indexOf("{"), chamada.lastIndexOf("}") + 1));
  assert.equal(dados.x, "a'b\"c</script><img>");
});
