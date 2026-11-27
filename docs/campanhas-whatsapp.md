# Campanhas de WhatsApp

O painel autenticado em `/campanhas` consulta os cards diretamente. O período é inclusivo e usa `leads.data_evento`, preenchido com a resposta do formulário. É possível selecionar vários status a excluir. Entre os cards aptos do mesmo telefone, o mais recente representa o contato.

A campanha congela o público e sorteia uma mensagem de texto por telefone ao clicar em **Iniciar campanha**. O worker da Mel confirma o consentimento antes de reservar o próximo envio e usa seu conector WhatsApp existente. O intervalo começa após o resultado da tentativa anterior. Ações de pausa e cancelamento valem para os próximos trabalhos. **Enviado** significa que o conector confirmou o aceite pelo WhatsApp.

## Instalação

1. Aplique as [migrações de Campanhas](../supabase/migrations/) no Supabase, na ordem dos arquivos e após o [schema base](../supabase/schema.sql).
2. Publique a aplicação na Vercel com `WHATSAPP_CAMPANHAS_WORKER_ATIVO=true` e preserve o `WHATSAPP_WORKER_TOKEN` compartilhado.
3. Publique o worker atualizado no serviço WhatsApp da Railway com `MEL_WHATSAPP_CAMPANHAS=true`. O mesmo conector e a mesma sessão atendem às campanhas e aos lembretes.
4. A fila de campanhas usa por padrão até 20 tentativas nas últimas 24 horas, com pelo menos 60 segundos entre tentativas. Ajuste `WHATSAPP_CAMPANHAS_LIMITE_24H` e `WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS` no servidor. O intervalo escolhido na campanha pode ampliar a cadência. Resultado indeterminado fica no histórico e não gera reenvio automático.
5. Registre a autorização explícita por telefone no detalhe do card em **Gerenciar consentimento**. Use **Registrar descadastro** para suspender futuros envios àquele número.

## Testar antes de iniciar

No cabeçalho de **Nova campanha** ou **Revisar campanha**, preencha o celular e clique em **Enviar teste**. Quando houver mais de uma mensagem preenchida, escolha a variação. O teste vai para um único telefone, fica no próprio histórico e não altera o público dos filtros. O número do Henrique já está autorizado para este teste. Outros números precisam de autorização registrada no detalhe de um lead.

Em ambiente isolado, use os cards fictícios do Henrique para conferir filtros e deduplicação no modo **Simulação sem envio**. O [teste SQL](../lib/campanhas/campanhas.test.sql) cobre a fila, vários status excluídos, pausa, retomada, deduplicação e o teste independente dos cards.
