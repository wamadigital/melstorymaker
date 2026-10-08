# Estabilização da Mel — 08/10/2026

Base auditada: `main`, commit `02e51023cd51f3cdc1d78680f67e096a949797b2`. As alterações abaixo foram publicadas pelo commit `da073c2cdb5288e879644d06c12d2e8a7136ab3a`, após autorização do usuário em 08/10/2026. Não houve alteração do schema nem escrita de teste nos leads de produção.

## Alterações implementadas

| Entrega | Implementação | Verificação |
|---|---|---|
| Criação inicial idempotente antes de receber o primeiro UUID confirmado | `lib/form/criacao.ts`, `app/api/leads/route.ts` | Resposta HTTP descartada após INSERT, recarga, dois POSTs concorrentes e replay de lead fechado |
| Autosave ordenado, última pendência e confirmação antes do envio | `lib/form/persistencia.ts`, `app/formulario/FormularioClient.tsx` | Transporte controlado, HTTP e retomada |
| Rascunho por UUID, recuperação de ACK perdido e tolerância ao armazenamento bloqueado | `lib/form/persistencia.ts` | Rede indisponível, recarga, conflito, UUID diferente e fila substituída |
| Conclusão e descarte preservam rascunho divergente de outra aba | `lib/form/persistencia.ts:87` | Três cenários adicionais de limpeza concorrente |
| Snapshot completo substitui respostas e respeita troca A→B→A de categoria | `app/api/leads/[id]/route.ts` | Testes da rota real com SDK e transporte controlados |
| Escrita atômica entre abas, sem JSON de respostas no filtro da URL | `lib/form/versao-lead.ts:46` | PostgreSQL/PostgREST real, texto de 64 mil caracteres e rastreio concorrente |
| Só o submit vencedor agenda notificação e CAPI | `app/api/leads/[id]/submit/route.ts` | Dois submits concorrentes, repetição, conflito e falhas sem efeitos |
| Mínimo de data usa o dia de São Paulo | `lib/data-local.ts`, `lib/form/engine.ts` | Fronteira de meia-noite e fusos distintos |
| Aviso de exclusão inclui contrato e assinatura; contato inicial respeita Novo | `lib/admin/acoes.ts`, `CartaoLead.tsx`, `DetalheLead.tsx` | Testes das regras e referências compartilhadas |
| Dry run de e-mail tem aviso explícito; lembretes respeitam o envio vigente | `lib/admin/acoes.ts`, `lib/admin/lembretes.ts:94` | Datas de cobrança anteriores e posteriores ao reenvio |
| Detalhe lê lead e contrato em paralelo e diferencia falha de ausência | `lib/admin/detalhe.ts`, `app/admin/(painel)/leads/[id]/page.tsx` | Erros independentes, ausência real e repetição de leitura |
| Avisos no celular reservam espaço para as setas de navegação | `app/formulario/FormularioClient.tsx` | Conferência visual em 390 × 844 |
| Documentação acompanha o fluxo atual | `PRD.md`, `CLAUDE.md`, `.env.example` | WhatsApp primeiro, e-mail por último, seis raias, tracking e persistência |

## Validação do código

| Verificação | Resultado |
|---|---|
| Suíte completa | 807 testes aprovados; zero falhas ou testes ignorados |
| TypeScript, ESLint e `git diff --check` | Aprovados |
| Build de produção em cópia isolada | Aprovado |
| Propostas PDF | 15 combinações: cinco artes × três tabelas de preço |
| Contratos | 38 cenários offline, sem IA nem assinatura externa |
| E2E do formulário | Quatro categorias × making of sim/não; oito leads fictícios |
| E2E do Kanban | Status, fechamento público, contato, lembrete, retomada e Esfriou aprovados |
| Concorrência HTTP | PATCHs com a mesma base: 200/409; submits iguais: 200/200; base divergente após fechamento: 409 |
| Texto longo no build final | Criar, salvar 64 mil caracteres, encurtar, enviar e repetir aprovados |
| Criação inicial idempotente | POSTs concorrentes 201/200 com um UUID; resposta perdida seguida de recarga preserva um registro e retoma na pergunta seguinte; replay preserva dados e status fechado |
| Interface móvel com indisponibilidade real do servidor | Rascunho preservado, recarga recuperada, aviso legível, nova tentativa e conclusão aprovadas; um único lead no banco isolado |
| Segredos no bundle final | 68 arquivos verificados contra cinco valores privados; nenhum encontrado |

Os testes HTTP usaram PostgreSQL 17 e PostgREST 14.17 locais, com `supabase/schema.sql` aplicado em banco descartável. Auth foi simulado, e Storage foi simulado em memória. SMTP, notificação, Meta e assinatura externos estavam desligados ou em dry run. Esses resultados não certificam a disponibilidade dos provedores de produção.

## Carregamento

Ensaio local de builds de produção: três cargas sem cache e três com cache por rota e perfil. Mobile: 360 × 780, CPU 4× e rede configurada em 1,6 Mbps/150 ms. Desktop: 1440 × 900 e 10 Mbps/40 ms. O Kanban tinha mais de 300 leads fictícios, mantendo o limite existente de 50 por raia. Pixel desligado em ambos os builds.

Os resultados completos e medianas estão em `/private/tmp/mel-perf-before.json`, `/private/tmp/mel-perf-before-300.json`, `/private/tmp/mel-perf-before-desktop.json` e `/private/tmp/mel-perf-final.json`. Esta medição é de laboratório local; não representa Core Web Vitals de visitantes reais. Não houve justificativa medida para substituir animações, recodificar os vídeos ou criar índices adicionais neste lote.

| Rota | LCP móvel antes | LCP móvel final | LCP desktop final | CLS final |
|---|---:|---:|---:|---:|
| `/casamento` | 1.192 ms | 1.188 ms | 248 ms | 0 |
| `/formulario` | 892 ms | 872 ms | 236 ms | 0 |
| `/orcamento` | 880 ms | 888 ms | 228 ms | 0 |
| `/admin`, mais de 300 leads | 1.264 ms | 1.284 ms | 588 ms | 0 |

Valores são medianas sem cache. Nenhuma rota excedeu a largura da tela nos dois perfis. Persistência e recuperação acrescentaram aproximadamente 5 kB ao First Load JS do formulário: 164 → 169 kB. Variações de poucos milissegundos não demonstram ganho ou regressão relevante neste ensaio. O prefetch dos cartões permanece no comportamento padrão do Next, limitado pela fronteira `loading.tsx` do painel.

## Meta e publicação

A nova conversão **2b · Clique no WhatsApp**, ID `1797452484628079`, foi criada pelo usuário e conferida salva no Gerenciador de Eventos em 08/10/2026: evento Contact, fonte Site, Mel Pixel `28251176377887999`, URL contendo `melstorymaker.com.br` e parâmetro `canal` igual a `whatsapp`. A conferência exibiu **Inativo**, zero e **Nunca recebeu o evento**; o recebimento de uma conversão real ainda não está confirmado.

As colunas de total e custo foram salvas com a nova conversão na predefinição **Funil Mel (site → cliente)**. A visualização rápida **Funil Mel** mantinha uma cópia das colunas antigas; suas colunas foram atualizadas, a predefinição correspondente foi nomeada **Funil Mel** e a visualização (ID `1120806977043412`) foi salva. Ao sair e reabrir a visualização, o Meta exibiu **Salva**, total e custo de **2b · Clique no WhatsApp**, e o ID `1797452484628079` nos parâmetros das colunas.

A conversão antiga continua preservada; seu Contact sem filtro de canal também inclui e-mail. A visita ao formulário continua limitada a `/formulario`; `/orcamento` tem Pixel, mas está fora dessa métrica. Clique no WhatsApp mede abertura de contato, sem confirmar mensagem enviada.

A Vercel confirmou o deployment `dpl_6JqMB72MXx7oFhw4RwCWtZ38Q485` como **READY**, ambiente **production**, com o SHA completo acima e os domínios `melstorymaker.com.br` e `www.melstorymaker.com.br` vinculados. [Registro da versão publicada](https://vercel.com/wamadigitals-projects/melstorymaker/6JqMB72MXx7oFhw4RwCWtZ38Q485).

| Conferência da publicação | Resultado |
|---|---|
| Páginas públicas e login | `/casamento`, `/formulario`, `/formulario?evento=casamento`, `/orcamento` e `/admin/login`: HTTP 200 |
| Redirecionamentos | `/` → `/formulario`; `/admin` anônimo → `/admin/login` |
| Proteções das APIs | Admin anônimo: 401; UUID inválido: 404; GET nas três rotas de escrita: 405 |
| JavaScript servido pelo domínio | 19 arquivos referenciados pelo HTML responderam 200; marcadores de criação idempotente e rascunho encontrados |
| Pixel no HTML | ID `28251176377887999` e PageView nas quatro páginas públicas; ViewContent da landing com `content_category=casamento` e `content_name=lp_casamento`; ausente no login administrativo |
| Segredos no JavaScript público | Cinco valores privados conferidos; nenhum encontrado |
| Logs da versão publicada | Consulta às 18h31 BRT, janela de 30 minutos, filtros error/fatal e agrupamento por nível: nenhum grupo retornado |

Relatório das requisições: `/private/tmp/mel-production-smoke.json`. A conferência usou somente GET, sem cookies, execução de JavaScript, IDs reais ou ações de provedores. Não disparou conversões de teste nem acessou o Kanban autenticado. O vínculo SHA/deployment confirma qual código foi publicado; os fluxos de gravação continuam sustentados pela validação isolada acima. A consulta de logs se limita à janela e aos filtros informados. Os testes não modificaram campanhas, orçamento de anúncios, contratos ou contatos reais.

Evidências visuais locais: `/private/tmp/mel-formulario-rascunho-final.jpg`, `/private/tmp/mel-formulario-confirmacao-final.jpg` e `/private/tmp/mel-criacao-recuperada-final.jpg` usam dados fictícios e banco isolado. `/private/tmp/mel-meta-conversao-preparada.jpg` registra a preparação histórica anterior à criação. `/private/tmp/mel-meta-whatsapp-criado.jpg` comprova a conversão salva e suas regras; `/private/tmp/mel-meta-funil-site-cliente-atualizado.jpg` registra o salvamento da predefinição; `/private/tmp/mel-meta-funil-mel-salvo.jpg` registra a visualização Funil Mel reaberta com as novas colunas.

## Limites mantidos

| Limite | Consequência e referência |
|---|---|
| Um rascunho por UUID/navegador | Abas compartilham o último snapshot persistido; não há histórico individual por aba. `CLAUDE.md:247` |
| Armazenamento bloqueado | O estado fica em memória até a página fechar; o aviso exige manter a página aberta. `FormularioClient.tsx` |
| Clientes anteriores sem os novos campos | Sem `base`, não detectam snapshot antigo anterior à leitura; sem `tentativa_id`, mantêm a criação antiga. O cliente atual envia ambos. `CLAUDE.md:243` e `CLAUDE.md:245` |
| CAPI sem fila persistente | Entrega best-effort; revisar falhas reais antes de implementar outbox. `CLAUDE.md:98` |
| Rate limit por instância | O Map atual não é um limite global entre instâncias. `lib/rate-limit.ts:6` |
| Métricas de produção | [inconclusivo]: faltam medição da versão publicada com Pixel ativo e dados de visitantes reais |

Fonte operacional para continuar no Codex: `CLAUDE.md`; produto: `PRD.md`; dados executáveis: `supabase/schema.sql`. Nenhum dos limites acima foi apresentado como corrigido.

### Pendência adicional resolvida durante a revisão

[Severidade P2] Primeiro POST sem recuperação da resposta perdida

Arquivo: `/Users/henrique/Documents/Sistema_Mel/app/api/leads/route.ts:68`

Problema: Na versão auditada, repetir o primeiro POST após perder sua resposta fazia outra inserção, pois o cliente ainda não conhecia o UUID criado.

Evidência: No commit base, `.insert({ categoria, status: "incompleto", respostas, passo_atual, ...promovidas })` não recebia identidade da tentativa.

Impacto: A mesma tentativa produzia dois leads e dois IDs de evento de nascimento.

Correção: Entregue identidade gerada antes do POST, INSERT pela PK existente e recuperação do snapshot sem repetir os efeitos de nascimento.

Situação: corrigida e verificada por testes, HTTP concorrente e interface com perda deliberada do ACK. A garantia é de idempotência dos dados; entrega CAPI permanece best-effort, inclusive quando o ACK se perde entre banco e servidor. Não se emite um novo Pixel Lead em uma recuperação tardia.
