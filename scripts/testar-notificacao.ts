/**
 * Envia uma notificacao de teste REAL para o WhatsApp configurado.
 *
 *   npm run notifica:testar
 *
 * Use depois de preencher NOTIFICA_WHATSAPP_FONE e NOTIFICA_WHATSAPP_APIKEY
 * no .env.local. Ignora o NOTIFICA_DRY_RUN de proposito: o script existe
 * exatamente para provar o envio de verdade, uma unica vez.
 */
async function main() {
  const fone = process.env.NOTIFICA_WHATSAPP_FONE;
  const apikey = process.env.NOTIFICA_WHATSAPP_APIKEY;
  if (!fone || !apikey) {
    console.error("\nPreencha NOTIFICA_WHATSAPP_FONE e NOTIFICA_WHATSAPP_APIKEY no .env.local.\n");
    process.exit(1);
  }
  const texto = "✨ Teste do sistema Mel Storymaker: as notificações de lead novo estão funcionando!";
  const url = `https://api.callmebot.com/whatsapp.php?phone=${fone}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(texto)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const corpo = await r.text();
  if (!r.ok || /error/i.test(corpo)) {
    console.error(`\n✗ CallMeBot recusou (HTTP ${r.status}):\n${corpo.slice(0, 300)}\n`);
    process.exit(1);
  }
  console.log("\n✓ Enviada. Confira o WhatsApp.\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
