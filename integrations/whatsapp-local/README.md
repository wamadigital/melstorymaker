# WhatsApp local da Mel

**Situação da publicação de 15/10/2026:** confirmação ao concluir formulário
permanece removida. Habilitados somente os lembretes de proposta por clique
nos botões de 7/30 dias. Flag própria do formulário permanece desligada.
O worker local processa a fila manual e o observador registra a cobertura;
ambos dependem do Mac ligado e conectado. Preservar histórico e sessão.

Instalação no Mac Apple Silicon do Henrique, autorizada em 14/10/2026.
O sistema continua na Vercel; o Mac busca a fila privada por HTTPS e envia pelo
MCP. Não existe túnel, porta pública ou credencial de banco entregue ao worker.

Os envios autorizados são o lembrete automático de formulário incompleto e os
lembretes de proposta acionados pelo botão da Mel. Copy e pausas são fechadas;
a confirmação de recebimento permanece removida. Flags, histórico de envios e
sessão não devem ser alterados para executar testes. Somente os lembretes de proposta por clique são habilitados nesta publicação.
Proposta exige aprovação da Mel e permanece no fluxo atual do painel.

| Componente | Local |
|---|---|
| Formulário, fila e rotas privadas | Vercel + Supabase |
| Bridge autenticado | `127.0.0.1:18281` no Mac |
| MCP stdio, apenas `send_message` | `.codex/config.toml` deste projeto |
| Sessão, tokens e recibos | `.whatsapp-local/state/`, privada e fora do Git/deploy |

## Instalação e conexão

```bash
bash integrations/whatsapp-local/install.sh
bash integrations/whatsapp-local/run-bridge.sh --pair
```

No WhatsApp da Mel: Configurações → Aparelhos conectados → Conectar um aparelho.
O QR aparece no terminal e em `.whatsapp-local/state/pairing.png`; expira e é
removido ao conectar ou encerrar. `connect.command` também abre o pareamento.
Não compartilhar sessão, bancos, tokens ou logs.

Depois de parear, iniciar o bridge sem `--pair` reutiliza a sessão existente:

```bash
bash integrations/whatsapp-local/run-bridge.sh
bash integrations/whatsapp-local/run-worker.sh
```

O Mac precisa ficar ligado, acordado e conectado. Fechar o processo para os
envios. A instalação não altera as configurações de energia do macOS.

## Início automático no login

O runtime canônico dos serviços fica em
`~/Library/Application Support/MelStorymaker/WhatsApp`. LaunchAgents não usam o
checkout em `Documents`: o macOS bloqueia esse acesso em segundo plano (TCC).
Não é necessário conceder Acesso Total ao Disco.

Preparar os dois plists apenas no runtime, sem instalar ou iniciar serviços:

```bash
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/service.py --prepare
```

Para realocar esta instalação que já tem os dois plists próprios, depois de
parear, validar o manifesto e parar seus dois serviços/bridge foreground:

```bash
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/service.py --relocate
```

`--relocate` exige `enabled:true`, os dois plists exatamente iguais aos desta
instalação e rótulos parados. Recusa um destino já existente. Copia a sessão,
tokens e recibos de forma privada, incluindo os arquivos WAL/SHM dos bancos,
com o worker de origem travado e o bridge parado. Copia o CPython real e os
pacotes instalados, refaz a venv sem links para `Documents` e testa os imports
offline. Não copia logs, QR, histórico, caches, Go ou o upstream. O bridge novo
precisa confirmar uma sessão autenticada antes de iniciar o worker.

A origem permanece como backup. **Após sucesso, desativar `enabled` na
configuração da origem e nunca iniciar o `connect.command`, bridge ou worker
antigos**: a sessão e os recibos passarão a evoluir somente em Application
Support. Manutenção e pareamentos futuros usam exclusivamente essa cópia:

```bash
cd "$HOME/Library/Application Support/MelStorymaker/WhatsApp"
bash integrations/whatsapp-local/run-bridge.sh --pair  # somente com o serviço bridge parado
```

Se a migração falhar antes de iniciar serviços, os plists originais são
restaurados. Se já iniciou algum serviço, a cópia nova da sessão é preservada
para revisão; ela não é sobrescrita silenciosamente nem removida. Não repetir
`--relocate` contra um destino existente.

O modo `--install` permanece para uma instalação em diretório sem a proteção
de `Documents`: confirma a sessão autenticada e pede Enter depois de encerrar
o bridge foreground, sem matar processos automaticamente. Recusa plists e
rótulos já existentes. Os modos de instalação usam somente
`com.melstorymaker.whatsapp.bridge` e `com.melstorymaker.whatsapp.worker` em
`~/Library/LaunchAgents`. Rollback altera apenas seus próprios plists e serviços.
Os serviços reutilizam a sessão, sem `--pair`, e os logs ficam privados em
`.whatsapp-local/state/` da cópia canônica. Entrar no Mac inicia os serviços; o Mac
continua precisando estar ligado, acordado e conectado.

## Ativação

1. Aplicar `supabase/whatsapp-outbox.sql` manualmente no SQL Editor da conta da Mel.
2. Publicar as rotas privadas, mantendo todas as flags desativadas até validar.
3. Configurar `WHATSAPP_WORKER_TOKEN` na Vercel com o segredo privado de
   `.whatsapp-local/state/worker-token`; nunca usar `NEXT_PUBLIC_`.
4. Conectar o WhatsApp da Mel e confirmar o status autenticado do bridge.
5. Ativar `WHATSAPP_AUTOMACAO_ATIVA=true` no servidor e `enabled:true` em
   `.whatsapp-local/state/worker-config.json`, então iniciar o worker.

A flag desativada bloqueia reservas e novos inícios de envio.
Resultados de trabalhos já iniciados ainda podem ser reconciliados.
Leads antigos não são importados, e não há backfill.

## Lembrete de formulário incompleto

Texto e sequência definidos pelo owner em 15/10/2026:

| Parte | Mensagem | Pausa antes |
|---|---|---|
| 1 | Olá! Aqui é a Mel Storymaker 👋 | Nenhuma |
| 2 | Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊 | 2 segundos após o sucesso da parte 1 |
| 3 | Suas respostas estão salvas, acesse o link: | 3 segundos após o sucesso da parte 2 |
| 4 | Link individual `/continuar/{id}`, sozinho | 2 segundos após o sucesso da parte 3 |

A terceira mensagem foi ajustada pelo owner em 15/10/2026. Para instalações
existentes, aplicar manualmente `supabase/whatsapp-lembrete-copy.sql` no banco
da Mel junto da publicação do backend. O histórico mantém o texto enviado;
sequências antigas ainda pendentes são canceladas, sem reenvio automático.

O prazo conta da criação do lead, quando ele deixa o WhatsApp e avança na
primeira pergunta. A primeira coluna é `Novo` (`incompleto`); nenhum status
volta para ela. Salvar mais respostas não reinicia o prazo. O preparo exige
**mais de** 24 horas em Novo; antes de cada parte, o servidor revalida coluna,
idade, telefone e ativação. O link retoma as respostas salvas da própria pessoa.

Há um único lembrete por lead, composto das quatro partes, separado da
confirmação de conclusão. As partes e as pausas são um snapshot na fila. O envio
não muda status nem carimbos manuais de “já chamei”, e não exige e-mail ou nome.
O worker busca os itens elegíveis da fila a cada 60 segundos. O Mac precisa
estar acordado e conectado. As pausas começam após o retorno de sucesso da
mensagem anterior; as verificações e a rede também ocupam tempo.

O worker atualizado anuncia `X-Mel-Worker-Protocol: 3`; o backend preserva
protocolo 2 apenas para formulário. O protocolo 3 permite também as duas
sequências de proposta, com comprovação local de inatividade. Falha, timeout,
interrupção ou recusa após o início encerra a sequência como indeterminada,
sem repetição de partes. Um ACK perdido é reconciliado sem reenviar mensagens.
`sent` exige sucesso de todas as chamadas ao MCP, sem afirmar leitura no celular.
Para ativar, aplicar manualmente `supabase/whatsapp-lembrete-formulario.sql`
no SQL Editor, atualizar o worker canônico em Application Support e publicar o
backend. Configurar `WHATSAPP_LEMBRETE_FORMULARIO_ATIVO=true` e
`WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM` com o instante de ativação em ISO com
fuso; `APP_URL` precisa ser HTTPS. O corte inclui apenas leads criados a partir
desse instante, evitando mensagens retroativas. O interruptor geral
`WHATSAPP_AUTOMACAO_ATIVA` continua valendo. Flag ausente/falsa, corte ausente ou
inválido e URL inválida mantêm os lembretes desligados. Sem cron ou ferramenta
MCP nova. O `send_message` existente é chamado quatro vezes, em série.

## Falhas e recibos

A fila tem RLS e acesso exclusivo ao backend. O worker reserva um item e precisa
receber a autorização de início do servidor antes de chamar o MCP. O servidor
revalida prazo, status do lead e telefone. A fila expira em 24 horas.

O Mac guarda ID, hash, estado e ACK pendente em SQLite, sem texto ou telefone.
Se WhatsApp tiver sido chamado e o resultado ficar desconhecido, não existe
reenvio automático. O worker pode reenviar o ACK ao servidor sem enviar outra
mensagem. Um retorno de envio confirma aceitação pelo cliente do WhatsApp;
não confirma leitura nem entrega ao destinatário.

O formulário não enfileira confirmação de recebimento. O primeiro lembrete é
preparado apenas para formulários elegíveis após o corte de ativação; os dois
lembretes de proposta nascem exclusivamente de um clique autenticado da Mel.
A fila não substitui a integração CRM da Meta nem o CallMeBot interno.

## Lembretes de proposta por clique

Aplicar manualmente `supabase/whatsapp-lembretes-proposta.sql` depois da
atualização da terceira frase (`whatsapp-lembrete-copy.sql`). Atualizar bridge,
MCP e worker da cópia canônica antes de ativar `WHATSAPP_LEMBRETE_PROPOSTA_ATIVO`.
O preparo do código não instala o runtime nem ativa qualquer flag.

Em 15/10/2026, o observador e o worker atualizados foram instalados no runtime
canônico, com a sessão preservada e o bridge autenticado. A cobertura começou
às 10h28 de São Paulo. O worker desta publicação atende somente a fila criada pelos botões. Os SQLs
incrementais são aplicados na conta da Mel antes da publicação do backend;
a observação local, sozinha, não ativa mensagens.

| Fluxo | Prazo desde a proposta | Silêncio mínimo | Sequência |
|---|---|---|---|
| Relembrar cliente | 7 dias | 5 dias | 4 partes; pausas 2/3/2s |
| Última tentativa | 30 dias e primeiro lembrete confirmado para a mesma proposta | 15 dias | 5 partes; pausas 4/4/3/5s |
| Formulário em Novo | mais de 24h desde criação, após o corte | não exige histórico de conversa | 4 partes; pausas 2/3/2s |

O primeiro lembrete conta como interação para o segundo. Se for enviado no dia
25, a última tentativa aguarda pelo menos até o dia 40. Nenhum relógio dispara
essas cobranças por conta própria: cada tentativa exige o clique no card. O botão
faz a solicitação somente após o prazo de 7/30 dias e fica bloqueado durante
a fila/envio. Depois do ACK completo, permanece visível como `Enviado`,
desabilitado. O bloqueio também existe no banco para o mesmo lembrete da mesma
proposta: outra aba, clique duplo e POST direto não criam um segundo disparo.

O bridge antigo não registra conversas. O novo observador guarda somente hashes
privados dos identificadores e horários de mensagens/chamadas individuais,
sem texto, mídia ou nomes. A cobertura começa depois da conexão e sincronização
de mensagens offline; é necessário observar continuamente a janela inteira.
Reinício, desconexão, suspensão do Mac ou identidade PN/LID sem correspondência
bloqueiam o envio. Não assumir silêncio com histórico vazio ou incompleto.

A verificação ocorre antes de cada parte. Só as partes da própria tentativa são
excluídas da consulta; resposta do lead, mensagem da Mel em outro aparelho ou
outro disparo interrompem a sequência. Falha depois de começar não reenvia nada.
Se a primeira verificação bloquear antes de começar, outro clique pode tentar
de novo quando houver cobertura e silêncio suficientes. Não existe retentativa
automática para falta de histórico ou interação recente.

## Versões e verificações

Upstream fixado: `lharries/whatsapp-mcp@7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88`.
SDK atualizado: `whatsmeow@v0.0.0-20261014094007-f16f9ca30d6a`.
Go oficial 1.27.2, Python 3.12.14 e MCP 1.30.0. Locks em `dependencies/`.
Os checksums e o manifesto impedem compilar um preparo parcial ou alterado.

```bash
python3 integrations/whatsapp-local/prepare.py --verify
bash integrations/whatsapp-local/run-bridge.sh --simulate
# Em outro terminal, sem WhatsApp conectado:
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/verify_mcp.py
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python -m unittest discover -s integrations/whatsapp-local -p 'test_*.py'
```

O modo simulação não abre sessão do WhatsApp nem envia mensagens.
O worker recusa bridge em simulação. Nenhum dado real é fixture de teste.
