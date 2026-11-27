import assert from "node:assert/strict";
import { test } from "node:test";
import { configuracaoCampanhas, enviarModeloCampanha, modelosAprovados } from "./provedor";

const ambiente = {
  WHATSAPP_CAMPANHAS_META_TOKEN: "token-ficticio",
  WHATSAPP_CAMPANHAS_META_WABA_ID: "101",
  WHATSAPP_CAMPANHAS_META_PHONE_ID: "102",
  WHATSAPP_CAMPANHAS_META_VERSAO: "v99.0",
  WHATSAPP_CAMPANHAS_LIMITE_24H: "10",
};
const meta = configuracaoCampanhas(ambiente).meta!;
const contato = "5519988763916";
const modelo = { nome: "fixture", idioma: "pt_BR", texto: "Mensagem de teste", imagem: true };

test("a integração exige um limite diário e uma cadência compatível", () => {
  assert.equal(configuracaoCampanhas({ ...ambiente, WHATSAPP_CAMPANHAS_LIMITE_24H: "" }).meta, null);
  assert.equal(configuracaoCampanhas({ ...ambiente, WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS: "5" }).meta, null);
});

test("catálogo filtra categoria, aprovação, parâmetros e formato em todas as páginas", async () => {
  const base = { name: "fixture", language: "pt_BR", category: "MARKETING", status: "APPROVED" };
  const corpo = { type: "BODY", text: "Mensagem de teste" };
  const mock: typeof fetch = async (entrada) => {
    const url = new URL(String(entrada));
    assert.equal(url.origin, "https://graph.facebook.com");
    return url.searchParams.has("after")
      ? Response.json({ data: [{ ...base, components: [corpo, { type: "HEADER", format: "IMAGE" }] }] })
      : Response.json({ data: [
        { ...base, category: "UTILITY", components: [corpo] },
        { ...base, status: "PENDING", components: [corpo] },
        { ...base, components: [{ type: "BODY", text: "Olá {{1}}" }] },
        { ...base, components: [corpo, { type: "HEADER", format: "VIDEO" }] },
      ], paging: { next: "https://ignorar.invalid/", cursors: { after: "pagina2" } } });
  };
  assert.deepEqual(await modelosAprovados(meta, undefined, mock), [modelo]);
});

test("um envio usa o modelo sorteado e a imagem privada assinada, com aceite identificado pelo provedor", async () => {
  const imagem = "https://exemplo.invalid/imagem-assinada";
  let chamadas = 0;
  const mock: typeof fetch = async (alvo, init) => {
    chamadas++;
    assert.match(String(alvo), /graph\.facebook\.com\/v99\.0\/102\/messages$/);
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.to, contato);
    assert.equal(payload.type, "template");
    assert.deepEqual(payload.template, {
      name: "fixture", language: { code: "pt_BR" },
      components: [{ type: "header", parameters: [{ type: "image", image: { link: imagem } }] }],
    });
    return Response.json({ messages: [{ id: "wamid.fixture" }] });
  };
  assert.deepEqual(await enviarModeloCampanha(meta, contato, modelo, imagem, mock),
    { status: "enviado", provedorId: "wamid.fixture" });
  assert.equal(chamadas, 1);
});

test("somente uma recusa explícita por capacidade autoriza nova tentativa automática", async () => {
  const texto = { ...modelo, imagem: false };
  assert.deepEqual(await enviarModeloCampanha(meta, contato, texto, undefined,
    async () => new Response(null, { status: 429, headers: { "Retry-After": "90" } })),
  { status: "repetir", motivo: "limite_provedor", espera: 90 });
  assert.equal((await enviarModeloCampanha(meta, contato, texto, undefined,
    async () => Response.json({ error: { code: 130429 } }, { status: 400 }))).status, "repetir");
  assert.deepEqual(await enviarModeloCampanha(meta, contato, texto, undefined,
    async () => { throw new Error("timeout fictício"); }), { status: "falha", motivo: "resultado_indeterminado" });
  assert.deepEqual(await enviarModeloCampanha(meta, contato, texto, undefined,
    async () => Response.json({})), { status: "falha", motivo: "resultado_indeterminado" });
});
