import assert from "node:assert/strict";
import { test } from "node:test";

// O e2e do contrato cria admin e lead no banco que o servidor usa e exercita
// o envio para assinatura. Producao tambem responde 401 "Sessão expirada." a
// sonda, entao so a sonda nao impede rodar contra ela: a base precisa ser
// local, ou vir com --permitir-remoto.
//
// O script le as envs do Supabase no import (sem rede nenhuma); aqui vao
// valores ficticios, e o roteiro nao roda (so roda chamado como script).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://projeto-ficticio.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-ficticia";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-ficticia";

test("o e2e do contrato só aceita servidor desta máquina sem --permitir-remoto", async () => {
  const { baseEhLocal } = await import("./e2e-contrato");

  for (const local of [
    "http://localhost:3107",
    "http://LOCALHOST:3100/",
    "http://127.0.0.1:3100",
    "http://[::1]:3100",
    "http://mel.localhost:3100",
  ]) {
    assert.equal(baseEhLocal(local), true, local);
  }

  for (const remota of [
    "https://melstorymaker.com.br",
    "https://sistema-mel.vercel.app",
    "http://192.168.0.10:3100",
    "http://localhost.example.com:3100",
    "http://127.0.0.1.example.com",
    "não é url",
    "",
  ]) {
    assert.equal(baseEhLocal(remota), false, remota);
  }
});
