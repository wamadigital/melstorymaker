import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pacoteDoCatalogo } from "@/lib/contrato/catalogo";
import { quantidadeComExtenso } from "@/lib/contrato/extenso";
import { adicionaisDaLp, condicoesDaLp, maisDe, pacotesDaLp, prazosDoFaq, telefoneLegivel } from "./conteudo";

test("os dois pacotes de casamento, na ordem, com o selo só no Principal", () => {
  const p = pacotesDaLp();
  assert.deepEqual(p.map((x) => x.nome), ["Pacote Principal", "Pacote Real Time"]);
  assert.equal(p[0].selo, "O mais contratado pelos noivos");
  assert.equal(p[1].selo, null);
});

test("nenhum bullet promete prazo: o prazo sai do contrato, não da arte", () => {
  for (const p of pacotesDaLp()) {
    for (const item of p.itens) {
      assert.doesNotMatch(item, /dias? úte|mesmo dia|entrega/i, `${p.nome}: "${item}"`);
      assert.doesNotMatch(item, /\.$/);
    }
  }
});

test("os prazos são os números do escopo do contrato", () => {
  const [principal, realTime] = pacotesDaLp();
  const ep = pacoteDoCatalogo("casamento", "Pacote Principal")!.escopo;
  const er = pacoteDoCatalogo("casamento", "Pacote Real Time")!.escopo;
  assert.equal(principal.destaque, `Stories publicados em até ${ep.diasStories} dias úteis`);
  assert.ok(principal.prazo.includes(`Stories em até ${ep.diasStories} dias úteis`));
  assert.ok(principal.prazo.includes(`em até ${ep.diasReels} dias úteis`));
  assert.ok(er.tempoReal);
  assert.equal(realTime.destaque, "Stories publicados durante a festa");
  assert.ok(realTime.prazo.startsWith("Stories no mesmo dia (sem internet no local, em até 48 horas)."));
  assert.ok(realTime.prazo.includes(`em até ${er.diasReels} dias úteis`));
});

test("nada da LP carrega preço", () => {
  const texto = JSON.stringify({ p: pacotesDaLp(), a: adicionaisDaLp(), f: prazosDoFaq() });
  assert.doesNotMatch(texto, /R\$|\d{3,}/);
});

test("adicionais: making of na forma do contrato, o resto com o nome da arte", () => {
  const a = adicionaisDaLp();
  assert.ok(a.includes("Making of da noiva"));
  assert.ok(a.includes("Making of do noivo"));
  assert.ok(a.includes("Cantinho Polaroid"));
  assert.ok(a.includes("Hora adicional"));
  assert.ok(!a.some((x) => /locomo|outro servi/i.test(x)), `adicional que não é da arte: ${a.join(", ")}`);
});

test("telefone legível a partir do MEL_WHATSAPP", () => {
  assert.equal(telefoneLegivel("5519992808396"), "(19) 99280-8396");
  assert.equal(telefoneLegivel("19992808396"), "(19) 99280-8396");
  assert.equal(telefoneLegivel("1932321234"), "(19) 3232-1234");
});

test("o número afirmado arredonda para baixo", () => {
  assert.equal(maisDe(22), "Mais de 20");
  assert.equal(maisDe(30), "Mais de 20");
  assert.equal(maisDe(31), "Mais de 30");
});

test("os números das garantias são os das cláusulas do contrato", () => {
  // O texto das cláusulas guarda o número por extenso; se alguém mudar a
  // cláusula, a LP precisa mudar junto (a oferta da página vincula).
  const clausulas = fs.readFileSync(path.join(process.cwd(), "lib/contrato/clausulas.ts"), "utf8");
  const c = condicoesDaLp();
  assert.equal(c.reservaPct, 30);
  assert.equal(c.diasAntesSaldo, 10);
  for (const trecho of [
    `em até ${quantidadeComExtenso(c.horasSemInternet, "feminino")} horas após o evento`,
    `período de ${quantidadeComExtenso(c.mesesDrive)} meses após o evento`,
    `corrigidas sem custo em até ${quantidadeComExtenso(c.diasCorrecao)} dias úteis`,
    `restituirá integralmente os valores pagos pela CONTRATANTE, em até ${quantidadeComExtenso(c.diasDevolucao)} dias`,
  ]) {
    assert.ok(clausulas.includes(trecho), `a cláusula não diz mais: "${trecho}"`);
  }
});

test("a página não escreve preço nem prazo à mão", () => {
  // Os números da LP passam por conteudo.ts; o JSX só os interpola.
  const pagina = fs.readFileSync(path.join(process.cwd(), "app/casamento/page.tsx"), "utf8");
  assert.doesNotMatch(pagina, /R\$/);
  const literais = pagina.match(/\b\d+\s*(?:%|dias?\b|horas?\b|meses\b|minutos?\b)/g);
  assert.equal(literais, null, `número escrito à mão em page.tsx: ${literais?.join(", ")}`);
});
