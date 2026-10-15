# WhatsApp na Railway

Um container reúne a bridge Go, o worker existente e seu servidor MCP por stdio. O sistema Next.js e o banco permanecem nos serviços atuais. Não há navegador, Chromium, Redis ou banco adicional nesta imagem.

## Estado do preparo em 15/10/2026

Projeto privado [mel-whatsapp](https://railway.com/project/7e6e06c6-9ea1-45e5-940f-9b889178b51d) criado pelo MCP no workspace pessoal do Henrique. Serviço e volume estão **staged**, sem implantação ou provisão. O runtime canônico do Mac continua sendo a origem ativa; nenhum token, banco ou sessão foi transferido.

| Recurso | Identificador |
| --- | --- |
| Projeto | `7e6e06c6-9ea1-45e5-940f-9b889178b51d` |
| Ambiente production | `26e2cbab-c227-4d1f-9e99-a56cf5b12bb3` |
| Serviço whatsapp | `40f9e9ae-f810-4786-b07e-92de11abc9e5` |
| Volume de 512 MB | `e5336d49-dbaf-4a25-99d5-ab7252e2545e` |

**Ativação depende da decisão de orçamento.** O pedido exige não aumentar a mensalidade. O Hobby inclui US$ 5 de uso compartilhado pelo workspace; não é um preço fixo ilimitado. No snapshot desta preparação, os três serviços existentes somavam 0,474546176 GB de memória, equivalentes a US$ 4,75/mês só de RAM se mantidos continuamente nesse consumo. O novo serviço ainda precisa de memória/CPU próprias. A estimativa deve ser medida no Linux antes de confirmar o gasto; contagem baixa de mensagens não elimina a memória residente.

O Railway não permite hard limit financeiro de US$ 5: o mínimo de compute é US$ 10 e atingi-lo derruba todos os workloads do workspace. Nenhum limite financeiro, plano ou serviço existente foi alterado. [Preços](https://docs.railway.com/pricing/plans), [controle de custo](https://docs.railway.com/pricing/cost-control).

Limites propostos para medir a implantação: uma réplica, 0,256 GB de RAM, 0,05 vCPU e volume de 512 MB. **Os limites de CPU/RAM ainda não foram aplicados**: o MCP exige um Service Instance existente para essa operação e o serviço ainda está staged. Aplicar e conferir esses limites antes de conectar a fonte/iniciar o primeiro build na Railway. Não confundir valor planejado com configuração persistida.

## Imagem e contexto

Gerar sempre um contexto isolado a partir da raiz do repositório. O comando imprime apenas o caminho da pasta temporária privada:

```sh
MEL_BUILD_CONTEXT="$(python3 integrations/whatsapp-railway/source_context.py)"
docker build --file "$MEL_BUILD_CONTEXT/integrations/whatsapp-railway/Dockerfile" --tag mel-whatsapp:railway "$MEL_BUILD_CONTEXT"
```

Não usar o checkout completo como contexto nem como upload da Railway. `source_context.py` copia somente os arquivos explicitamente permitidos pelo `Dockerfile.dockerignore`, mantendo os caminhos relativos ao repositório, e cria uma `.dockerignore` idêntica na raiz para o builder legado. Sessão local, `.env`, `.git`, `.next`, `node_modules` e o restante da aplicação não entram nessa pasta. O arquivo `SOURCE-MANIFEST.json` registra tamanho e SHA-256 das fontes copiadas, sem credenciais ou caminhos absolutos. Diretórios existentes e symlinks nas fontes são rejeitados.

O Dockerfile é compatível com o builder legado: não exige buildx, BuildKit ou `RUN --mount`. A estrutura do contexto mantém `integrations/whatsapp-local` e `integrations/whatsapp-railway`; nunca usar somente um desses diretórios.

Depois da aprovação do orçamento, selecionar o projeto/serviço correto da Railway e usar a mesma pasta isolada no upload:

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

Configurar pelo MCP/API/dashboard da Railway, após a aprovação do orçamento. A documentação oficial de 15/10/2026 informa que novos serviços não podem usar `railway.json` / `railway.toml`; por isso este diretório não cria um arquivo de configuração legado.

| Ajuste | Valor |
| --- | --- |
| Builder | Dockerfile |
| Dockerfile | `integrations/whatsapp-railway/Dockerfile` |
| Contexto / Root Directory | Raiz do contexto isolado produzido por `source_context.py` |
| Réplicas | 1 |
| Volume persistente | Montado em `/data` |
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

A imagem executa como root para permitir inicializar as permissões do volume Railway. O supervisor deve usar `umask 077`, exigir o volume, criar `/data/state` privado e verificar o marcador de migração antes de iniciar bridge ou worker. A bridge precisa de `MEL_WHATSAPP_BRIDGE_TOKEN` e deve iniciar com diretório de trabalho `/data/state`. Seu REST continua restrito a `127.0.0.1:18281`; não publicar essa porta. O worker requer `bridge-token`, `worker-token` e `worker-config.json` no estado persistente e inicia seu MCP internamente, sem um segundo servidor MCP permanente.

A migração deve copiar consistentemente os bancos SQLite/ledger e parar o consumidor local antes de habilitar o consumidor remoto. Não criar uma sessão nova, apagar ledger ou ativar envios como parte do build.

## Verificação offline

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/whatsapp-railway -p 'test_*.py'
```

Os testes verificam bloqueio sobre runtime existente, checksum antes de extração, rejeição de links/traversal, descarte do token de build e isolamento do contexto. O empacotador também é testado com pasta que contém espaços e ponto e vírgula, sem shell ou execução de comandos. Não abrem sessão nem enviam mensagens. O teste do Dockerfile é estático; somente um build Linux concluído comprova a imagem executável.

Validação desta preparação: **48 testes Python passaram**, o build Docker Linux/arm64 no Mac foi concluído e os testes Go passaram no estágio de build. A imagem final carregou o worker e o MCP, listou somente `send_message` e iniciou o bridge em simulação, com rede externa desativada e sem estado pessoal. O build Next.js também passou. Implantação Linux/amd64, autenticação na Railway, consumo em conexão real e troca do runtime continuam pendentes da decisão de orçamento; esta prova local não os substitui.

## Troca de execução, depois de resolver o orçamento

1. Revisar o patch staged pelo MCP. Provisionar somente o serviço e seu volume, sem fonte/conta WhatsApp. Aplicar limites de CPU/RAM, uma réplica e conferir por leitura antes de fazer o upload do contexto isolado. Não adicionar GitHub autodeploys ou réplicas extras durante a migração.
2. Validar a imagem Linux e os imports sem sessão. No Railway, iniciar o supervisor sem marcadores de importação/ativação: ele apenas espera. `/healthz` é liveness do supervisor e não comprova autenticação do WhatsApp.
3. Impedir novos cliques durante a troca; aguardar qualquer envio em curso terminar. Conferir ACKs pendentes, parar primeiro o LaunchAgent próprio do worker e depois o do bridge. Preservar a origem completa como rollback. Nunca iniciar a mesma sessão em dois hosts.
4. Com os serviços locais parados, exportar cópias SQLite consistentes de `store/whatsapp.db`, `store/activity.db`, `store/messages.db` e `worker-ledger.db`, e os mesmos `bridge-token`, `worker-token` e `worker-config.json`. Conferir schemas, integridade e hashes. Não enviar logs, QR, histórico de conversas, mídias, Go ou caches. O token do bridge também é o segredo HMAC dos registros de interação e deve ser preservado.
5. Transferir por SSH autenticado, diretamente para o volume privado, sem gravar conteúdo em comando/log, variável pública, Git ou imagem. Fixar `/data/state` e `/data/state/store` em `0700`, arquivos em `0600`; fechar/checkpointar SQLite antes de comparar hashes. Não publicar a API do bridge nem criar domínio público de envio.
6. Criar `/data/state/.cloud-ready.json` com conteúdo exato `{"version":1}` somente após validar o import. Rodar `python /app/integrations/whatsapp-railway/cloud.py --check`. Criar o arquivo privado `/data/enable-cloud` somente com a origem local parada e o orçamento autorizado. O supervisor espera o bridge confirmar conexão autenticada antes de iniciar o worker/MCP.
7. Conferir conexão, worker, ledger e reconciliação dos ACKs sem enviar mensagem de teste não solicitada. Confirmar que as flags do formulário e a confirmação de recebimento continuam desligadas. Mensagens, pausas, botões e condições permanecem iguais. Após a troca, atualizar a orientação operacional do toast de `BotaoLembrete.tsx`, que hoje informa dependência do WhatsApp no Mac, para refletir a execução online.
8. A cobertura de silêncio **recomeça** após reconectar: aguardar 5/15 dias contínuos para contatos reais. Não fabricar histórico ou restaurar cobertura em memória. A exceção temporária de testes do owner conserva seu prazo e não é ampliada.
9. Após a migração validada, impedir reinício dos dois LaunchAgents locais próprios, mantendo o backup privado para recuperação. Em rollback, parar/desativar a nuvem antes de reutilizar a sessão no Mac e trazer de volta o estado persistente mais recente, incluindo ledger/ACKs. Nunca restaurar um ledger antigo sobre o atual.

O supervisor recusa execução padrão sem mount em `/data`, usa uma trava no volume, não possui pareamento automático e não publica logs dos filhos. Remover `/data/enable-cloud` encerra worker/MCP antes do bridge. Resultado desconhecido de envio continua bloqueado pelo ledger e pela fila existente; nenhum cron ou automação de envio é criado por esta implantação.

Fontes oficiais conferidas: [Docker Python](https://hub.docker.com/_/python), [Docker Go](https://hub.docker.com/_/golang), [uv em Docker](https://docs.astral.sh/uv/guides/integration/docker/), [uv 0.12.7](https://github.com/astral-sh/uv/releases/tag/0.12.7), [Dockerfile específico e dockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files), [configuração Railway](https://docs.railway.com/config-as-code).
