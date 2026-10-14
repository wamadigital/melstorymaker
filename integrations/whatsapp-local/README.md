# WhatsApp local da Mel

Instalação no Mac Apple Silicon do Henrique, autorizada em 14/10/2026.
O sistema continua na Vercel; o Mac busca a fila privada por HTTPS e envia pelo
MCP. Não existe túnel, porta pública ou credencial de banco entregue ao worker.

O primeiro fluxo é uma confirmação na primeira conclusão do formulário:

> Oi! Recebi as informações do seu evento 💛
>
> Vou analisar os detalhes e te chamar por aqui para conversar sobre a sua proposta.
>
> Mel Simão | Storymaker

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

Preparar os dois plists apenas no runtime, sem instalar ou iniciar serviços:

```bash
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/service.py --prepare
```

Após parear e ativar a configuração local (`enabled:true`), instalar para o login
da usuária deste Mac:

```bash
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/service.py --install
```

O comando confirma a sessão autenticada e pede Enter depois de encerrar o bridge
iniciado manualmente. O operador interrompe somente esse processo; o helper não
mata processos. A comprovação do pareamento permanece na mesma invocação.
Ele recusa plists ou rótulos já existentes e cria somente
`com.melstorymaker.whatsapp.bridge` e `com.melstorymaker.whatsapp.worker` em
`~/Library/LaunchAgents`. Falha durante a instalação reverte apenas seus próprios
plists e serviços. Os serviços reutilizam a sessão, sem `--pair`, e os logs ficam
privados em `.whatsapp-local/state/`. Entrar no Mac inicia os serviços; o Mac
continua precisando estar ligado, acordado e conectado.

## Ativação

1. Aplicar `supabase/whatsapp-outbox.sql` manualmente no SQL Editor da conta da Mel.
2. Publicar as rotas e o gatilho da conclusão, mantendo a flag desativada até validar.
3. Configurar `WHATSAPP_WORKER_TOKEN` na Vercel com o segredo privado de
   `.whatsapp-local/state/worker-token`; nunca usar `NEXT_PUBLIC_`.
4. Conectar o WhatsApp da Mel e confirmar o status autenticado do bridge.
5. Ativar `WHATSAPP_AUTOMACAO_ATIVA=true` no servidor e `enabled:true` em
   `.whatsapp-local/state/worker-config.json`, então iniciar o worker.

A flag desativada bloqueia novas confirmações e novos inícios de envio.
Resultados de trabalhos já iniciados ainda podem ser reconciliados.
Leads antigos não são importados, e não há backfill.

## Falhas e recibos

A fila tem RLS e acesso exclusivo ao backend. O worker reserva um item e precisa
receber a autorização de início do servidor antes de chamar o MCP. O servidor
revalida prazo, status do lead e telefone. A fila expira em 24 horas.

O Mac guarda ID, hash, estado e ACK pendente em SQLite, sem texto ou telefone.
Se WhatsApp tiver sido chamado e o resultado ficar desconhecido, não existe
reenvio automático. O worker pode reenviar o ACK ao servidor sem enviar outra
mensagem. Um retorno de envio confirma aceitação pelo cliente do WhatsApp;
não confirma leitura nem entrega ao destinatário.

O registro na fila é auxiliar e ocorre após concluir o formulário. Falha ou
crash entre a conclusão e o registro pode perder essa confirmação; o formulário
permanece concluído. A fila não substitui a fila da Meta nem o CallMeBot interno.

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
