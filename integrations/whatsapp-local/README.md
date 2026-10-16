# Código WhatsApp compartilhado e recuperação do Mac

**Situação após a migração de 15/10/2026:** bridge, observador, MCP stdio e worker
executam na Railway Hobby, no projeto privado `mel-whatsapp`. A implantação
`47e5370d-dd0b-4d9b-a57a-e482a6974b4a` confirmou conexão autenticada e worker em
execução. O Mac pode ficar desligado. Confirmação ao concluir formulário
permanece removida. Habilitados os lembretes de proposta por clique nos botões de 7/30 dias;
a orientação posterior RF-28 autoriza também o primeiro envio após 15 minutos.
A flag própria do formulário ficou desligada na migração; a revisão de 16/10
autoriza ativá-la com a regra de seis horas e não perturbe descrita abaixo.
Preservar histórico, sessão, ledger e ACKs. A cobertura contínua de 5/15 dias
reiniciou na reconexão da nuvem e não é restaurada pelo banco importado.

A cópia em `~/Library/Application Support/MelStorymaker/WhatsApp` é somente
backup. Os dois LaunchAgents próprios foram descarregados e desabilitados;
o worker local tem `enabled:false`, com registro privado `cloud-migration.json`.
Não iniciar a origem, `connect.command`, bridge, worker ou instaladores locais
enquanto a nuvem estiver ativa. Os procedimentos antigos abaixo foram
preservados somente para recuperação acompanhada. Primeiro parar a nuvem e
recuperar seu estado mais recente, inclusive ledger/ACKs; nunca conectar a mesma
sessão em dois hosts nem restaurar ledger antigo sobre o atual.

O sistema web continua na Vercel; o worker da Railway busca a fila privada por
HTTPS e envia pelo MCP stdio. Não há túnel, domínio público, TCP proxy ou
credencial de banco entregue ao worker. Migração e limites de orçamento ficam
em [`../whatsapp-railway/README.md`](../whatsapp-railway/README.md). O owner
autorizou hard limits de US$ 10 compute e US$ 0 Railway Agent no workspace,
aplicados mantendo o Hobby; isso não garante uma fatura mensal fixa.

Os envios autorizados são o primeiro orçamento automático após 15 minutos, o
lembrete de formulário incompleto (ativação autorizada em 16/10, para novos
formulários após o corte) e os lembretes de proposta por clique. Copy e pausas são fechadas;
a confirmação de recebimento permanece removida. Flags, histórico de envios e
sessão não devem ser alterados para executar testes. A publicação inicial habilitou os lembretes de proposta por clique; RF-28 acrescenta o orçamento automático.
A primeira proposta agora segue RF-28: espera de 15 minutos, validação completa,
gerador na Vercel e quatro partes com pausas 3/2/4s (introduzida no protocolo 4).
Só ACK completo move para Enviado. Cliente que já recebeu não é reenviado ao
voltar à revisão. O Mac permanece desligável; e-mail e contratos seguem manuais.

| Componente | Local |
|---|---|
| Formulário, fila e rotas privadas | Vercel + Supabase |
| Bridge autenticado | `127.0.0.1:18281` dentro do container Railway |
| MCP stdio, apenas `send_message` | Processo interno iniciado pelo worker Railway |
| Sessão, tokens, metadados e recibos | `/data/state/`, no volume privado Railway, fora do Git/imagem |
| Cópias do Mac e configuração MCP local anterior | Backup para recuperação acompanhada; não executar enquanto a nuvem estiver ativa |

## Histórico: instalação e conexão no Mac

Instalação original no Mac Apple Silicon, autorizada em 14/10/2026. Estes
comandos não fazem parte da operação atual. Executar somente em recuperação
acompanhada, com a nuvem parada e o estado remoto mais recente preservado.

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

## Histórico: início automático no login do Mac

Antes da migração para a Railway, o runtime canônico dos serviços ficava em
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

A origem da antiga realocação local permanecia como backup. **Naquele procedimento, após sucesso, desativar `enabled` na
configuração da origem e nunca iniciar o `connect.command`, bridge ou worker
antigos**: a sessão e os recibos passarão a evoluir somente em Application
Support. A instrução seguinte também é histórica: hoje Application Support é
backup desativado e a execução canônica está na Railway.

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

## Histórico: ativação local

Não executar estes passos sobre o backup do Mac com a nuvem ativa. A implantação
atual já usa as flags aprovadas e não requer outra ativação ou mudança de SQL.

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

**Regra vigente autorizada em 16/10/2026:** seis horas desde a última resposta
efetivamente salva do formulário. Uma nova resposta reinicia a contagem;
metadados, tracking e atualizações do Kanban não reiniciam. O relógio não depende
de detectar a saída ou o fechamento da aba. Isso substitui a regra histórica de
mais de 24 horas desde a criação, que permaneceu pausada até esta autorização.
A primeira coluna é `Novo` (`incompleto`); nenhum status volta para ela.

O não perturbe deste lembrete é de 21h00 até antes de 08h00 em
`America/Sao_Paulo`. Se as seis horas vencerem entre 21h00 e 23h59, enviar a partir
de 09h00 do dia seguinte; se vencerem entre 00h00 e 07h59, a partir de 09h00 do
mesmo dia. Às 08h00 é permitido, às 21h00 é proibido. Não aplicar esta janela
à primeira proposta nem aos lembretes manuais. Antes de cada parte, revalidar
coluna, última resposta, prazo, horário real, telefone e ativação. Um atraso no
worker não libera envio durante o não perturbe. O link retoma as respostas
salvas da própria pessoa.

| Última resposta salva | Primeiro horário permitido |
|---|---|
| 08h30 | 14h30 do mesmo dia |
| 18h00 | 09h00 do dia seguinte |
| 15h01 | 09h00 do dia seguinte |
| 23h40 | 09h00 do dia seguinte |
| 09h00 | 15h00 do mesmo dia |
| 03h00 | 09h00 do mesmo dia |

Há um único lembrete por lead, composto das quatro partes, separado da
confirmação de conclusão. As partes e as pausas são um snapshot na fila. O envio
não muda status nem carimbos manuais de “já chamei”, e não exige e-mail ou nome.
O worker da Railway busca os itens elegíveis da fila a cada 60 segundos, sem
dependência de energia ou conexão do Mac. As pausas começam após o retorno de sucesso da
mensagem anterior; as verificações e a rede também ocupam tempo.

O worker desta revisão anuncia `X-Mel-Worker-Protocol: 5` e o formulário exige
RPCs V6. Workers antigos não podem reservar ou enviar o lembrete de seis horas.
As duas sequências de proposta por clique preservam a comprovação de
inatividade no bridge da nuvem. Falha, timeout,
interrupção ou recusa após o início encerra a sequência como indeterminada,
sem repetição de partes. Um ACK perdido é reconciliado sem reenviar mensagens.
`sent` exige sucesso de todas as chamadas ao MCP, sem afirmar leitura no celular.
O owner autorizou ativar este fluxo em produção em 16/10/2026. Antes da ativação,
aplicar manualmente `supabase/whatsapp-formulario-6h.sql` no SQL Editor, atualizar
o worker canônico na Railway e publicar o backend. Configurar
`WHATSAPP_LEMBRETE_FORMULARIO_ATIVO=true` e
`WHATSAPP_LEMBRETE_FORMULARIO_INICIO_EM` com o instante de ativação em ISO com
fuso; `APP_URL` precisa ser HTTPS. O corte inclui apenas leads criados a partir
desse instante, evitando mensagens retroativas. O interruptor geral
`WHATSAPP_AUTOMACAO_ATIVA` continua valendo. Flag ausente/falsa, corte ausente ou
inválido e URL inválida mantêm os lembretes desligados. Sem cron ou ferramenta
MCP nova. O `send_message` existente é chamado quatro vezes, em série.
Desenvolvimento permanece desligado. A autorização não comprova implantação;
conferir SQL, versão do backend, worker e flags antes de declarar o fluxo ativo.

## Falhas e recibos

A fila tem RLS e acesso exclusivo ao backend. O worker reserva um item e precisa
receber a autorização de início do servidor antes de chamar o MCP. O servidor
revalida prazo, status do lead e telefone. A fila expira em 24 horas.

O volume privado da Railway guarda ID, hash, estado e ACK pendente em SQLite, sem texto ou telefone.
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

No primeiro preparo de 15/10/2026, o observador e o worker foram instalados no
runtime então canônico do Mac, e a cobertura começou às 10h28 de São Paulo.
Essa cobertura não vale após a migração: a janela de 5/15 dias reiniciou na
conexão da Railway. Os lembretes de proposta atendem somente a fila criada pelos botões;
os fluxos automáticos de RF-25 e RF-28 têm condições próprias. Os SQLs
incrementais são aplicados na conta da Mel antes da publicação do backend;
a observação do bridge, sozinha, não ativa mensagens.

| Fluxo | Prazo desde a proposta | Silêncio mínimo | Sequência |
|---|---|---|---|
| Relembrar cliente | 7 dias | 5 dias | 4 partes; pausas 2/3/2s |
| Última tentativa | 30 dias e primeiro lembrete confirmado para a mesma proposta | 15 dias | 5 partes; pausas 4/4/3/5s |
| Formulário em Novo | 6h desde a última resposta salva, após o corte; não perturbe 21h–08h e adiamento para 09h | não exige histórico de conversa | 4 partes; pausas 2/3/2s |

O primeiro lembrete conta como interação para o segundo. Se for enviado no dia
25, a última tentativa aguarda pelo menos até o dia 40. Nenhum relógio dispara
essas cobranças por conta própria: cada tentativa exige o clique no card. O botão
faz a solicitação somente após o prazo de 7/30 dias e fica bloqueado durante
a fila/envio. Desde o clique, o botão fica oculto, inclusive depois do ACK
completo; o ícone resume as quatro mensagens com estados verde/cinza. Não há
botão desabilitado substituto. O bloqueio também existe no banco para o mesmo lembrete da mesma
proposta: outra aba, clique duplo e POST direto não criam um segundo disparo.

O observador guarda somente hashes privados e horários de mensagens/chamadas,
sem texto, mídia ou nomes, e um checkpoint HMAC vinculado à sessão em `activity.db`.
A cobertura começa após sincronizar os eventos offline. Reinício limpo ou
reconexão de até 30 minutos preserva o início comprovado somente após a nova
barreira de sincronização e validação da assinatura, sessão e relógio. SQLite
WAL/FULL e ACK síncrono preservam a ordem dos registros. Crash, falha de registro,
lacuna não comprovada e identidade PN/LID desconhecida bloqueiam. A primeira
implantação do checkpoint não retroage linhas antigas a uma prova de silêncio.
Os gates permanecem em cinco/quinze dias. Não assumir silêncio com histórico vazio.

O painel diferencia as causas do bloqueio e mostra a previsão em Brasília quando
há prova parcial válida. Essa prova é apenas diagnóstico: STARTED ainda exige a
janela completa. SQL manual: `supabase/whatsapp-historico-feedback.sql`.

A verificação ocorre antes de cada parte. Só as partes da própria tentativa são
excluídas da consulta; resposta do lead, mensagem da Mel em outro aparelho ou
outro disparo interrompem a sequência. Falha depois de começar não reenvia nada.
Se a primeira verificação bloquear antes de começar, outro clique pode tentar
de novo quando houver cobertura e silêncio suficientes. Não existe retentativa
automática para falta de histórico ou interação recente.

## Versões e verificações

Upstream fixado: `lharries/whatsapp-mcp@7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88`.
SDK atualizado: `whatsmeow@v0.0.0-20261014094007-f16f9ca30d6a`.
Go oficial 1.27.2 e MCP 1.30.0. A cópia original do Mac usa Python 3.12.14;
a imagem Railway usa Python 3.12.15. Locks compartilhados em `dependencies/`.
Os checksums e o manifesto impedem compilar um preparo parcial ou alterado.

Os comandos seguintes são de desenvolvimento/recuperação isolada. Não iniciar
nenhum bridge real nem MCP local contra o backup enquanto a nuvem estiver ativa.

```bash
python3 integrations/whatsapp-local/prepare.py --verify
bash integrations/whatsapp-local/run-bridge.sh --simulate
# Em outro terminal, sem WhatsApp conectado:
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/verify_mcp.py
.whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python -m unittest discover -s integrations/whatsapp-local -p 'test_*.py'
```

O modo simulação não abre sessão do WhatsApp nem envia mensagens.
O worker recusa bridge em simulação. Nenhum dado real é fixture de teste.


## Testes de recebimento autorizados em 15/10/2026

O owner pediu cinco cards `TESTE HENRIQUE` que permitam testar os recebimentos
imediatamente no telefone dele. A exceção temporária vale até **17/10/2026 às
15h de São Paulo**, somente para os cinco UUIDs em `testes.ts` e para o número
aprovado. Três cards testam a sequência de 7 dias; dois, a de 30 dias. A
allowlist privada `whatsapp_testes_owner` prende cada permissão à revisão e ao
link da proposta. Não há histórico ou ACK fabricado: somente nesses testes
são dispensadas a cobertura/interação de 5/15 dias e a dependência do primeiro
lembrete para a sequência de 30 dias. O prazo de 7/30 dias da proposta, clique
autenticado, copy/pausas, conexão, aprovação do servidor a cada parte, ACK e
deduplicação permanecem obrigatórios. Cada card continua de uso único.

SQL manual incremental `supabase/whatsapp-testes-owner.sql`, também incluído
no final de `schema.sql`. Instalar bridge/MCP/worker atualizados e backend
antes de liberar os cliques. A resposta local de teste é explícita e vinculada
a card/job/telefone; nunca simula prova de histórico. A autorização local
expira em 30 segundos e é renovada antes de cada parte. O quadro recebe
somente marco/prazo do card visível, sem publicar a allowlist no bundle.
Os eventos de teste da Meta permanecem encerrados. Nenhum fluxo de formulário
é ativado e nenhuma mensagem é disparada pelo preparo dos cards.


## Rodada única legada — protocolo 6 / RPCs V7

Autorização de 16/10/2026: 49 clientes com evento futuro do inventário de Esfriou;
excluir eventos passados e testes. Enviar só o primeiro lembrete aprovado, manter
os cards e confirmar no Kanban exclusivamente após ACK completo. Exceção só para
histórico incompleto; conversa recente, identidade incerta, falha de sync/registro,
proposta/telefone alterados, envio anterior ou indeterminado continuam bloqueando.

Aplicar manualmente `supabase/whatsapp-lote-legado.sql` e publicar backend/worker
compatíveis antes da ativação. Manifesto privado com snapshots imutáveis cria
pausado, expira em até24h e é ativado separadamente. Um ticket HMAC com a chave já
existente do worker vincula lote/job/lead/destinatário/textos por até cinco minutos.
O bridge confere ticket e metadados antes de cada parte; o SQL confere estado e
snapshot. Nunca declarar prova incompleta como completa.

`criar_lote_legado_whatsapp` só prepara; `ativar_lote_legado_whatsapp` libera;
`pausar_lote_legado_whatsapp` impede novas partes/inícios sem desligar os demais
fluxos. As tabelas `whatsapp_lotes_legados` e `whatsapp_lote_legado_itens` são
privadas com RLS e acesso apenas de service_role. Nenhuma rota administrativa
pública foi criada para aceitar destinatários ou textos livres.

Intervalo persistido de120–240s entre leads, sem catch-up. O claim retorna
pollAfterSeconds10 durante o lote ativo e60 depois; limite de cadência no banco
continua obrigatório. ACK tardio é reconciliado sem reenviar. Resultado parcial
ou desconhecido permanece indeterminado. Instalação/criação pausada não é envio.
Não iniciar o backup local. Permanecem o mesmo serviço/volume e limites do Hobby.
