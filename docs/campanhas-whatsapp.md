# Campanhas de WhatsApp

O painel autenticado em `/campanhas` consulta os cards diretamente. As datas inicial e final são inclusivas e seguem `leads.data_evento`, que espelha a resposta `data` do formulário. O status a excluir se aplica a cada card. Entre os cards aptos do mesmo telefone, o card elegível mais recente representa o contato.

A campanha congela o público e sorteia uma versão por telefone ao clicar em **Iniciar campanha**. O worker volta a conferir o consentimento antes da chamada de envio. O intervalo configurado começa após o resultado da tentativa anterior. Ações de pausa e cancelamento valem para os próximos trabalhos. Um envio já em processamento pode terminar. **Enviado** significa que a Meta aceitou a requisição e devolveu um ID de mensagem.

## Instalação

1. Aplique [a migração de campanhas](../supabase/migrations/20261127110412_campanhas_whatsapp.sql) no Supabase após o [schema base](../supabase/schema.sql). A migração cria as tabelas, funções privadas e o bucket de mídia privado.
2. Publique a aplicação na Vercel com `WHATSAPP_CAMPANHAS_WORKER_ATIVO=true` e mantenha o `WHATSAPP_WORKER_TOKEN` compartilhado com o worker.
3. Publique o worker atualizado no serviço WhatsApp da Railway com `MEL_WHATSAPP_CAMPANHAS=true`. Ele consulta a rota autenticada de campanhas nas rodadas do worker. A simulação já funciona nessa configuração mesmo sem credenciais da Meta.

## Envio de teste e real

- Configure na Vercel `WHATSAPP_CAMPANHAS_META_WABA_ID`, `WHATSAPP_CAMPANHAS_META_PHONE_ID`, `WHATSAPP_CAMPANHAS_META_VERSAO` e `WHATSAPP_CAMPANHAS_META_TOKEN`. A conta e o número devem estar registrados na Cloud API. O token precisa de acesso aos dois recursos e das permissões `whatsapp_business_management` e `whatsapp_business_messaging`. [Catálogo de modelos](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/), [Envio de mensagens](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api).
- Configure `WHATSAPP_CAMPANHAS_LIMITE_24H` de acordo com o orçamento e a capacidade do remetente. A cadência mínima entre tentativas reais é de 60 segundos por padrão, ajustável por `WHATSAPP_CAMPANHAS_CADENCIA_SEGUNDOS` com mínimo de 10 segundos. O limite móvel é compartilhado entre campanhas reais e testes pelo mesmo remetente deste sistema. Recusas explícitas por capacidade respeitam `Retry-After` e podem gerar até três tentativas totais. Resultados indeterminados ficam no histórico para conferência manual.
- Aprove na Meta um modelo de categoria `MARKETING` para cada variação. O painel aceita corpo fixo sem variáveis, com cabeçalho de imagem para campanhas com anexo. Inclua no corpo instruções de descadastro e registre os pedidos no painel. O provedor recebe a imagem por link temporário do bucket privado. [Política de mensagens do WhatsApp](https://business.whatsapp.com/policy/).
- Registre a autorização explícita por telefone no detalhe do card, em **Gerenciar consentimento**. Informe a origem e a data comprováveis. Para interromper envios futuros a esse telefone, use **Registrar descadastro** no mesmo lugar.

## Teste com Henrique

1. Em ambiente isolado, use dois cards fictícios com o telefone do Henrique, em formatos diferentes, e a mesma categoria. Use datas de evento dentro do intervalo. Acrescente um card com telefone inválido e outro sem data.
2. Em **Nova campanha**, escolha **Simulação sem envio · Henrique**. Combine os filtros e verifique os dois cards do Henrique, um único contato apto e o telefone inválido identificado. Adicione duas mensagens, uma imagem de teste e um intervalo. Revise e inicie. A fila registra uma versão e o resultado **Simulado**, sem chamar a Meta.
3. Para receber no WhatsApp, configure a Meta, confira se o número do Henrique está autorizado no painel da Meta quando usar um remetente de teste, registre o consentimento no card, escolha **Envio de teste · Henrique** e selecione modelos aprovados. Esse modo só aceita o telefone do Henrique.
4. O [teste SQL](../lib/campanhas/campanhas.test.sql) cobre a fila com vários números fictícios, pausa, retomada, deduplicação, repetição e consentimento. Execute-o em banco descartável após aplicar o schema e a migração.
