# Campanhas de WhatsApp

O painel autenticado em `/campanhas` consulta os cards diretamente. O período é inclusivo e usa `leads.data_evento`, preenchido com a resposta do formulário. É possível selecionar vários status a excluir. Entre os cards aptos do mesmo telefone, o mais recente representa o contato. Números descadastrados ficam de fora.

Na revisão, confirme que os contatos selecionados autorizaram o recebimento da campanha. A confirmação vale para o público revisado e fica registrada com a campanha. Ao clicar em **Iniciar campanha**, o sistema congela esse público e sorteia uma mensagem de texto por telefone. O worker verifica novos descadastros antes do envio e usa o conector WhatsApp da Mel. **Enviado** indica que o conector confirmou o aceite.

O intervalo começa após o resultado da tentativa anterior. Ações de pausa e cancelamento valem para os próximos trabalhos. Um envio com resultado indeterminado fica no histórico sem reenvio automático.

## Instalação

1. Aplique as [migrações de Campanhas](../supabase/migrations/) no Supabase, na ordem dos arquivos e após o [schema base](../supabase/schema.sql).
2. Publique a aplicação na Vercel com `WHATSAPP_CAMPANHAS_WORKER_ATIVO=true` e preserve o `WHATSAPP_WORKER_TOKEN` compartilhado.
3. O worker da Railway usa `MEL_WHATSAPP_CAMPANHAS=true`. O mesmo conector e a mesma sessão atendem às campanhas e aos lembretes.
4. A fila processa todos os destinatários elegíveis sem teto diário. A cadência mínima do disparador é de 60 segundos por padrão e pode ser ajustada via `WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS`. O intervalo escolhido na campanha é respeitado junto com essa cadência.
5. Registre pedidos de descadastro no detalhe do card em **Gerenciar consentimento**. O bloqueio vale para o telefone, mesmo se ele estiver em vários cards.

O [teste SQL](../lib/campanhas/campanhas.test.sql) verifica a fila em banco isolado, incluindo confirmação, descadastro, exclusão por status, deduplicação, pausa e retomada.
