# WhatsApp na Railway

Um container reúne a bridge Go, o worker existente e seu servidor MCP por stdio. O sistema Next.js e o banco permanecem nos serviços atuais. Não há navegador, Chromium, Redis ou banco adicional nesta imagem.

## Estado operacional em 15/10/2026

O projeto privado [mel-whatsapp](https://railway.com/project/7e6e06c6-9ea1-45e5-940f-9b889178b51d), criado pelo MCP no workspace pessoal do Henrique, é o runtime canônico do WhatsApp. A migração foi concluída: implantação Linux x86_64 com estado `SUCCESS`, volume persistente montado em `/data`, bridge autenticado e worker em execução. O Mac pode ficar desligado.

| Recurso | Identificador |
| --- | --- |
| Projeto | `7e6e06c6-9ea1-45e5-940f-9b889178b51d` |
| Ambiente production | `26e2cbab-c227-4d1f-9e99-a56cf5b12bb3` |
| Serviço whatsapp | `40f9e9ae-f810-4786-b07e-92de11abc9e5` |
| Volume de 512 MB | `e5336d49-dbaf-4a25-99d5-ab7252e2545e` |
| Implantação validada | `47e5370d-dd0b-4d9b-a57a-e482a6974b4a` |

O import privado conferiu SHA-256 dos oito payloads antes de publicar `/data/state`; preservou sessão, metadados e ledger. No checkpoint da migração, o ledger tinha quatro registros `sent` e nenhum ACK pendente. O health confirmou `phase=running`, `bridgeConnected=true` e `workerRunning=true`; isso comprova conexão e processos, sem representar novo envio ou leitura de mensagem pelo destinatário.

Os dois LaunchAgents próprios do Mac foram descarregados e desabilitados. A cópia em `~/Library/Application Support/MelStorymaker/WhatsApp` é somente backup, com `enabled:false` no worker e registro privado `cloud-migration.json`. Não iniciar `connect.command`, bridge, worker ou reinstalar LaunchAgents dessa origem. O estado remoto passa a evoluir; qualquer recuperação exige parar a nuvem primeiro e trazer o estado mais recente, inclusive ledger/ACKs. Nunca usar a mesma sessão em dois hosts nem restaurar ledger antigo sobre o atual.

As flags de mensagem foram preservadas: geral e lembretes de proposta por clique habilitados, lembrete de formulário desligado e confirmação de recebimento removida. Textos, pausas, critérios, botões e histórico não mudaram. A comprovação de silêncio de 5/15 dias reiniciou após reconectar na Railway e deve ser construída continuamente para contatos reais; importar os bancos não restaura essa cobertura. A exceção dos cinco testes do owner mantém o prazo original, sem ampliação.

## Orçamento e limites aplicados

O owner aprovou manter o Hobby e autorizou hard limits de **US$ 10 para compute e US$ 0 para Railway Agent** no workspace; ambos foram aplicados. O Hobby inclui US$ 5 de uso compartilhado, não uso ilimitado. O limite de compute não equivale a uma fatura mensal fixa garantida; atingi-lo interrompe os workloads do workspace. Nenhum upgrade de plano foi feito. [Preços](https://docs.railway.com/pricing/plans), [controle de custo](https://docs.railway.com/pricing/cost-control).

Uma réplica em `us-east4`, 0,256 GB de RAM e 0,05 vCPU foram aplicados e conferidos no container: cgroup `memory.max=256000000` e `cpu.max=5000 100000`. O volume tem 512 MB. Sem domínio público ou TCP proxy. A quantidade de mensagens não elimina a memória residente; consumo e picos reais são medidos na execução, sem tratar o teto configurado como gasto efetivo.

## Imagem e contexto

Gerar sempre um contexto isolado a partir da raiz do repositório. O comando imprime apenas o caminho da pasta temporária privada:

```sh
MEL_BUILD_CONTEXT="$(python3 integrations/whatsapp-railway/source_context.py)"
docker build --file "$MEL_BUILD_CONTEXT/integrations/whatsapp-railway/Dockerfile" --tag mel-whatsapp:railway "$MEL_BUILD_CONTEXT"
```

Não usar o checkout completo como contexto nem como upload da Railway. `source_context.py` copia somente os arquivos explicitamente permitidos pelo `Dockerfile.dockerignore`, mantendo os caminhos relativos ao repositório, e cria uma `.dockerignore` idêntica na raiz para o builder legado. Sessão local, `.env`, `.git`, `.next`, `node_modules` e o restante da aplicação não entram nessa pasta. O arquivo `SOURCE-MANIFEST.json` registra tamanho e SHA-256 das fontes copiadas, sem credenciais ou caminhos absolutos. Diretórios existentes e symlinks nas fontes são rejeitados.

O Dockerfile é compatível com o builder legado: não exige buildx, BuildKit ou `RUN --mount`. A estrutura do contexto mantém `integrations/whatsapp-local` e `integrations/whatsapp-railway`; nunca usar somente um desses diretórios.

Em uma atualização autorizada, selecionar explicitamente o projeto/serviço corretos da Railway e usar a mesma pasta isolada no upload:

```sh
railway up "$MEL_BUILD_CONTEXT" --path-as-root
```

O upload da Railway não usa o filtro do Docker para decidir quais arquivos enviar. A pasta isolada é obrigatória mesmo quando o Docker já aplica `.dockerignore`. Não fazer upload da pasta que contém sessão, tokens ou o backup de migração.

| Componente | Versão / origem |
| --- | --- |
| Upstream | `lharries/whatsapp-mcp`, commit `7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88`, checksum verificado pelo preparador existente |
| Go no builder | `golang:1.27.2-bookworm`; dependências de `go.mod` / `go.sum` existentes; CGO habilitado para SQLite |
| Python | `python:3.12.15-slim-bookworm`, igual nos estágios de instalação e execução |
| uv no builder | `ghcr.io/astral-sh/uv:0.12.7`; `uv sync --frozen --no-dev`, usando o lock existente |
| Execução | Python + certificados + SQLite; sem uv, Go ou compiladores |

O download usa apenas o arquivo GitHub fixado. `prepare_build.py` verifica o SHA-256 antes de extrair, rejeita links/arquivos especiais e aplica os mesmos patches locais. O token temporário criado por `prepare.py` é descartado no build. O estágio Go executa os testes antes de compilar.

## Configuração do serviço

A configuração foi aplicada pelo MCP/API da Railway. A documentação oficial de 15/10/2026 informa que novos serviços não podem usar `railway.json` / `railway.toml`; por isso este diretório não cria um arquivo de configuração legado.

| Ajuste | Valor |
| --- | --- |
| Builder | Dockerfile |
| Dockerfile | `integrations/whatsapp-railway/Dockerfile` |
| Contexto / Root Directory | Raiz do contexto isolado produzido por `source_context.py` |
| Réplicas | 1 |
| Região | `us-east4` |
| Limite RAM | 256.000.000 bytes (0,256 GB), conferido em cgroup |
| Limite CPU | 0,05 vCPU, conferido em cgroup |
| Volume persistente | 512 MB, montado em `/data` |
| Health check | `/healthz`, na porta `PORT` fornecida pela Railway |
| Domínio público / TCP proxy | Nenhum |
| Serverless / dormir por inatividade | Desativado para manter a conexão WhatsApp |
| Sobreposição de deploys | 0; a sessão nunca deve executar em duas réplicas |

O limite de memória do processo Go é `GOMEMLIMIT=64MiB` (meta de GC, não limite total do container). Limites do serviço e tamanho do volume são definidos na Railway; não criam garantia de gasto mensal. A quantidade de mensagens não elimina o custo de memória de um processo ligado continuamente.

## Contrato com o supervisor

O comando padrão é `python /app/integrations/whatsapp-railway/cloud.py`, usando o Python da venv aprovada pelo `PATH`.

| Caminho | Uso |
| --- | --- |
| `/app/.whatsapp-local/bin/whatsapp-bridge` | Bridge compilada para Linux |
| `/app/.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python` | Python do worker e MCP |
| `/app/integrations/whatsapp-local/worker.py` | Consumidor da fila atual, sem alteração de contratos |
| `/app/integrations/whatsapp-local/run-mcp.sh` | Comando stdio iniciado pelo próprio worker |
| `/app/.whatsapp-local/state` | Symlink para `/data/state` |
| `/data/state` | Sessão, tokens, metadados de interação e ledger de deduplicação persistentes |

A imagem executa como root para inicializar as permissões do volume Railway. O supervisor usa `umask 077`, exige o volume e aguarda o import privado e o marcador de ativação antes de iniciar bridge ou worker. O importador cria `/data/state` somente após validar os arquivos. A bridge recebe `MEL_WHATSAPP_BRIDGE_TOKEN` do arquivo privado e inicia com diretório de trabalho `/data/state`. Seu REST continua restrito a `127.0.0.1:18281`; não publicar essa porta. O worker requer `bridge-token`, `worker-token` e `worker-config.json` no estado persistente e inicia seu MCP internamente, sem um segundo servidor MCP permanente.

A migração deve copiar consistentemente os bancos SQLite/ledger e parar o consumidor local antes de habilitar o consumidor remoto. Não criar uma sessão nova, apagar ledger ou ativar envios como parte do build.

## Verificação offline

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/whatsapp-railway -p 'test_*.py'
```

Os testes verificam bloqueio sobre runtime existente, checksum antes de extração, rejeição de links/traversal, descarte do token de build e isolamento do contexto. O empacotador também é testado com pasta que contém espaços e ponto e vírgula, sem shell ou execução de comandos. Não abrem sessão nem enviam mensagens. O teste do Dockerfile é estático; somente um build Linux concluído comprova a imagem executável.

Na preparação inicial, 48 testes Python passaram, o build Docker Linux/arm64 no Mac foi concluído e os testes Go passaram no estágio de build. A imagem final carregou o worker e o MCP, listou somente `send_message` e iniciou o bridge em simulação, com rede externa desativada e sem estado pessoal; o build Next.js também passou. Depois, exportação/importação privadas receberam testes próprios, e a implantação Linux/amd64 na Railway confirmou autenticação, worker em execução e limites cgroup descritos acima. A prova local e a prova da implantação são checkpoints distintos; nenhuma delas afirma entrega ou leitura de uma nova mensagem.

## Ferramentas de migração privada

`export_state.py` opera com bridge e worker parados, trava o ledger de origem, copia os bancos e seus sidecars para staging privado, produz backups SQLite consistentes e gera `IMPORT-MANIFEST.json` com os hashes de oito payloads. Não altera os originais nem inicia serviços. A exportação desta migração aconteceu antes de desabilitar a configuração de origem; não reativar o backup local para repetir esse passo.

`receive_state.py` recebe um tar.gz por stdin de SSH autenticado sem PTY. Aceita exatamente os sete arquivos de `cloud.REQUIRED`, `.cloud-ready.json` e o manifesto; somente membros regulares USTAR, sem diretórios, links, traversal, PAX ou duplicados. Limita todo o descomprimido a 32 MiB, confere tamanhos/hashes e `cloud.validate_state`, fixa diretórios `0700`/arquivos `0600` e faz rename atômico sem substituir estado existente. Recusa import se `/data/state` ou `/data/enable-cloud` já existem; nunca ativa o serviço. Essas ferramentas não entram na imagem ou no contexto de deploy, nem expõem rotas públicas.

As oito cargas são `bridge-token`, `worker-token`, `worker-config.json`, `worker-ledger.db`, `store/whatsapp.db`, `store/activity.db`, `store/messages.db` e `.cloud-ready.json`. O pacote de migração e seu manifesto são privados; não enviar conteúdo em logs, variáveis públicas, Git ou imagem. A origem Mac e o backup exportado devem permanecer como checkpoints até uma recuperação acompanhada exigir o estado remoto mais recente.

## Procedimento preservado de migração e recuperação acompanhada

A troca inicial abaixo foi concluída. Estes passos são referência para operação acompanhada, não uma instrução para repetir o import na instalação ativa ou religar o Mac.

1. Para nova migração ou recuperação aprovada, revisar configuração pelo MCP. Preservar o serviço, volume e limites atuais; provisionar substitutos somente quando fizer parte da recuperação autorizada. Conferir CPU/RAM e uma réplica antes de fazer upload do contexto isolado. Não adicionar GitHub autodeploys ou réplicas extras durante a troca.
2. Validar a imagem Linux e os imports sem sessão. No Railway, iniciar o supervisor sem marcadores de importação/ativação: ele apenas espera. `/healthz` é liveness do supervisor e não comprova autenticação do WhatsApp.
3. Impedir novos cliques durante a troca; aguardar qualquer envio em curso terminar. Conferir ACKs pendentes, parar primeiro o LaunchAgent próprio do worker e depois o do bridge. Preservar a origem completa como rollback. Nunca iniciar a mesma sessão em dois hosts.
4. Na migração inicial, com os serviços locais parados, `export_state.py` produziu cópias consistentes de `store/whatsapp.db`, `store/activity.db`, `store/messages.db` e `worker-ledger.db`, e dos mesmos `bridge-token`, `worker-token` e `worker-config.json`. Em recuperação atual, a origem é o estado remoto mais recente, não o backup antigo. Conferir schemas, integridade e hashes. Não enviar logs, QR, histórico de conversas, mídias, Go ou caches. O token do bridge também é o segredo HMAC dos registros de interação e deve ser preservado.
5. Transferir por SSH autenticado, diretamente para o volume privado, sem gravar conteúdo em comando/log, variável pública, Git ou imagem. Fixar `/data/state` e `/data/state/store` em `0700`, arquivos em `0600`; fechar/checkpointar SQLite antes de comparar hashes. Não publicar a API do bridge nem criar domínio público de envio.
6. O export inclui `.cloud-ready.json` com conteúdo exato `{"version":1}` no pacote validado por `receive_state.py`; o import publica o estado somente após validar o conjunto. Rodar `python /app/integrations/whatsapp-railway/cloud.py --check`. Criar o arquivo privado `/data/enable-cloud` somente com a outra origem parada e o orçamento autorizado. O supervisor espera o bridge confirmar conexão autenticada antes de iniciar o worker/MCP.
7. Conferir conexão, worker, ledger e reconciliação dos ACKs sem enviar mensagem de teste não solicitada. Confirmar que o lembrete de formulário continua desligado e a confirmação de recebimento removida. Mensagens, pausas, botões e condições permanecem iguais; a orientação operacional do painel deve refletir execução online, sem dependência do Mac.
8. A cobertura de silêncio **recomeça** após reconectar: aguardar 5/15 dias contínuos para contatos reais. Não fabricar histórico ou restaurar cobertura em memória. A exceção temporária de testes do owner conserva seu prazo e não é ampliada.
9. Os dois LaunchAgents locais próprios já estão descarregados/desabilitados e o worker local desativado. Preservar esse estado e o backup privado. Em rollback, parar/desativar a nuvem antes de reutilizar a sessão no Mac e trazer de volta o estado persistente mais recente, incluindo ledger/ACKs. Nunca restaurar um ledger antigo sobre o atual.

O supervisor recusa execução padrão sem mount em `/data`, usa uma trava no volume, não possui pareamento automático e não publica logs dos filhos. Remover `/data/enable-cloud` encerra worker/MCP antes do bridge. Resultado desconhecido de envio continua bloqueado pelo ledger e pela fila existente; nenhum cron ou automação de envio é criado por esta implantação.

Fontes oficiais conferidas: [Docker Python](https://hub.docker.com/_/python), [Docker Go](https://hub.docker.com/_/golang), [uv em Docker](https://docs.astral.sh/uv/guides/integration/docker/), [uv 0.12.7](https://github.com/astral-sh/uv/releases/tag/0.12.7), [Dockerfile específico e dockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files), [configuração Railway](https://docs.railway.com/config-as-code).

## Proposta inicial automática (RF-28)

A revisão do worker protocolo 4 acrescenta `proposta_inicial_15m`: a Vercel
prepara o PDF após os 15 minutos registrados no Supabase, e a Railway envia
as quatro partes com pausas 3/2/4s. A nova flag é própria; não ativa confirmação
antiga nem lembrete de formulário. O primeiro orçamento não usa a janela de
inatividade dos lembretes; os gates de 5/15 dias continuam iguais para 7/30 dias.
Ledger, sessão e volume continuam os mesmos. Só ACK completo move para Enviado;
parcial/desconhecido nunca é repetido automaticamente. E-mail continua manual.

A atualização substitui somente o código do serviço existente e conserva
Hobby, uma réplica, 256 MB, 0,05 vCPU e volume 512 MB. Um redeploy reconecta o
bridge e reinicia a cobertura de inatividade dos lembretes, sem apagar histórico.
