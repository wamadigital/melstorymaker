# CLAUDE.md | Sistema de Propostas Mel Simão

Contrato operacional deste repo. A especificação completa (requisitos, árvore do formulário, critérios de aceite) está em `PRD.md`, que é a fonte de verdade do produto. Este arquivo define como trabalhar aqui. Em conflito entre os dois, o PRD define O QUE, este arquivo define COMO.

## Contexto em 2 linhas

MVP: lead preenche formulário multi-etapas estilo Typeform em `/formulario`, sistema gera PDF fiel à arte do Figma, Mel aprova no painel `/admin` e envia por e-mail + WhatsApp. Prazo de 2 dias, custo de infra R$ 0 (free tiers). Produção: `https://melstorymaker.com.br` (DNS gerenciado no Registro.br).

## Stack (travada, não sugerir alternativas)

- Next.js 14+ App Router, TypeScript strict
- Tailwind + shadcn/ui + Framer Motion (só nas transições do form)
- Supabase: Postgres, Auth, Storage
- pdf-lib + @pdf-lib/fontkit
- Nodemailer + Gmail SMTP, atrás de `MailAdapter`
- Deploy: Vercel

## Comandos

```bash
npm run dev          # ambiente local
npm run build        # build de produção (rodar antes de todo commit relevante)
npm run lint         # ESLint
npx tsc --noEmit     # checagem de tipos
```

Schema do banco: aplicar `supabase/schema.sql` manualmente no SQL Editor do Supabase. Não usar migrations automáticas neste MVP.

## Mapa do repo

```
app/formulario         Form público multi-etapas
app/admin              Login, lista de leads, detalhe
app/api/leads          Endpoints públicos: criar, autosave, submit
app/api/admin          Endpoints protegidos: gerar-pdf, enviar
lib/form               arvore.json + engine de renderização
lib/pdf                templates.config.ts, gerar.ts, formatadores pt-BR
lib/mail               adapter.ts, gmail.ts, templates de e-mail
assets/templates       5 PDFs base exportados do Figma (um por ARTE, não por categoria)
scripts/preparar-arte  Exporta > comprime (Ghostscript) > une as páginas de uma arte
assets/fonts           Fontes da marca (.ttf)
supabase/schema.sql    Schema completo
```

## Decisões travadas (NUNCA reabrir nem "melhorar")

1. PDF gerado com pdf-lib sobre os PDFs base do Figma. Nunca Puppeteer, Chromium, headless browser ou API do Figma em runtime.
2. E-mail sempre pela interface `MailAdapter`, com `GmailAdapter` (SMTP do Gmail da Mel, App Password) como único provider. Nunca chamar Nodemailer direto de uma rota: é a interface que garante que a trava do `MAIL_DRY_RUN` não seja contornada. **Sem serviço transacional de e-mail** — a conta Workspace entrega 2.000 destinatários/dia e o volume da Mel é muito menor. Não introduzir um sem que o volume mude de ordem de grandeza.
2b. O remetente é `mel@wama.digital`, e isso é **deliberado** — não é migração pendente para `@melstorymaker.com.br`. Decisão do owner em 18/08/2026: o nome de exibição ("Mel Simão | Storymaker") é o que o lead lê, e o endereço da agência não atrapalha. Não trocar sem pedido explícito: mudar exigiria criar o endereço no Workspace e alteraria `GMAIL_USER` junto, já que o Google reescreve o remetente.
3. WhatsApp = links `wa.me` gerados no painel. Nenhuma API de WhatsApp (Twilio, Z-API, Evolution, Baileys) **para falar com o lead ou enviar do número da Mel** — a trava protege o número dela de banimento. Exceção aprovada pelo owner (18/08/2026): notificação interna de lead novo via CallMeBot (`lib/notifica/`), em que a Mel só RECEBE de um gateway; conteúdo mínimo (sem e-mail nem telefone do lead na mensagem), falha nunca quebra o submit (`after()` + try/catch), e sem as envs `NOTIFICA_*` é no-op. Essa exceção também retira a notificação de lead novo do escopo v2 proibido da regra 8.
4. Human-in-the-loop: nenhum e-mail sai para o lead sem ação explícita da Mel no painel. Não criar envio automático pós-submit.
5. Formulário renderizado 100% a partir de `lib/form/arvore.json`. Perguntas nunca hardcoded em componentes. Nova pergunta = mudança no JSON.
6. Sem lógica de preço. Valores estão desenhados na arte estática dos templates.
6b. Categoria (4, enum do Postgres) e arte (5, `TemplateId`) são conceitos separados. `aniversario` resolve entre `aniversario_infantil` (14 anos ou menos) e `aniversario_adulto` (15+) via `resolverTemplateId(categoria, respostas)`. Nunca indexar template por categoria, e nunca acrescentar valor ao enum para criar arte nova — isso geraria migration à toa.
7. Sem banners de cookies, telas de consentimento ou fluxos de LGPD. Decisão de escopo do owner.
8. Escopo v2 do PRD (seção 19) é proibido no MVP: sem tracking de abertura, sem agenda, sem contrato/pagamento, sem analytics de funil, sem notificações em tempo real.
9. Admin tem usuária única (Mel), criada via dashboard do Supabase. Nunca criar tela ou endpoint de signup.

## Dados e segurança

- O client NUNCA fala direto com o Supabase para leads. Todo acesso via route handlers usando `SUPABASE_SERVICE_ROLE_KEY` (server-side only).
- RLS ativado na tabela `leads` com zero policies públicas. Se um acesso falhar por RLS, a correção é no route handler, nunca criar policy pública.
- `respostas` é jsonb: mudança na árvore de perguntas não gera migration.
- Colunas promovidas (`nome_display`, `data_evento`, `email`, `whatsapp`) são atualizadas no autosave, junto com o jsonb.
- Transições de status apenas nos endpoints definidos: `incompleto` (criação) > `aguardando_revisao` (submit) > `enviado` (envio de e-mail).
- Nunca commitar `.env`, App Password ou service role key. Nunca expor a service role no bundle do client.

## PDF: gotchas obrigatórios

1. pdf-lib usa origem no canto INFERIOR esquerdo da página. Converter coordenadas vindas do Figma (origem superior esquerda): `y_pdf = alturaPagina - y_figma - tamanhoFonte`.
2. Chamar `pdfDoc.registerFontkit(fontkit)` ANTES de embutir qualquer fonte custom.
3. Campo com `maxLargura`: reduzir o tamanho da fonte proporcionalmente até caber. Nunca quebrar linha em campo de nome.
4. Criar a rota de calibração `/admin/debug-template?template=X` (grid de coordenadas a cada 20pt sobre o PDF base) ANTES de calibrar o primeiro template. Calibrar sem ela é proibido. O parâmetro é o `TemplateId`, não a categoria: `aniversario` sozinho é ambíguo.
4b. **Preparo da arte** (mudança de arte = PR dedicada): esvaziar os placeholders no Figma (manter só `Olá,` no bloco de saudação, ocultar o cabeçalho), exportar cada frame com `download_assets` em PDF e rodar `npm run arte:preparar -- <template> <pasta>`. O Ghostscript roda SÓ nesse preparo; em produção continua apenas pdf-lib. Sem a compressão a arte estoura o anexo de e-mail — uma página de galeria exportou com 11,4 MB.
4c. As cinco capas compartilham o mesmo desenho, montado por `camposCapa()` em `templates.config.ts`. Arte nova = uma chamada, variando a composição do cabeçalho e o `x` do nome. As páginas são 1240x1754 pt, iguais ao frame em px, então `escala: 1`.
5. Formatação sempre via `lib/pdf/formatadores.ts`: **data em DD/MM/AAAA** ("14/03/2026") em TODOS os PDFs, hora no padrão "19h30". O formatador `data_extenso` continua disponível no registry, mas nenhuma arte usa.
5b. **Campo do config vazio aborta a geração.** Todo campo de `templates.config.ts` é obrigatório salvo `opcional: true`. Faltando qualquer um, `gerarProposta` lança `CamposFaltandoError` com a lista, a rota devolve 422 e nada é gravado no banco nem no Storage. Nunca pular campo vazio em silêncio: PDF com buraco onde deveria estar o nome do lead é pior do que PDF nenhum. Pela mesma razão, `resolverTemplateId` devolve `null` em vez de escolher uma arte padrão quando a idade falta.
6. Regerar PDF sobrescreve `{leadId}.pdf` no bucket `propostas` (URL estável para o link do WhatsApp). Preview no painel usa query param de cache-bust.
7. **O link público da proposta é `{APP_URL}/proposta/{leadId}.pdf`**, servido por `app/proposta/[arquivo]/route.ts`, que lê o objeto do Storage. Nunca devolver a URL crua do Supabase: esse link vai por WhatsApp e o lead lê o domínio. Por isso `APP_URL` errada em produção = link quebrado no celular de quem recebeu.

## Convenções de código

- Domínio em pt-BR: categorias, status, chaves do jsonb e do `arvore.json` (`aguardando_revisao`, `making_of`, `local_festa`). Código e infra em inglês: variáveis, funções, componentes, commits.
- **`nome` é sempre quem PREENCHEU o formulário, nunca o sujeito do evento.** O sujeito mora em chave própria por categoria (`debutante`, `aniversariante`, `noivos`, `empresa`), com o mesmo nome da variável na arte do Figma. Use `nomeContato()` e `sujeitoDoEvento()` de `lib/leads.ts` — nunca leia `respostas.nome` direto esperando o nome do evento. `nome_display` guarda o sujeito; a saudação do e-mail e do WhatsApp usa quem preencheu.
- Toda string visível ao usuário em pt-BR. Copies do e-mail e do WhatsApp: usar exatamente as da seção 14 do PRD, sem reescrever o tom da Mel.
- Um componente por tipo de pergunta (`texto`, `data`, `hora`, `escolha_unica`, `email`, `telefone`, `numero`), todos consumindo o schema do `arvore.json`.
- Sem dependências novas sem justificativa de 1 linha no PR. O bundle de `/formulario` é sagrado: LCP < 2.5s em 4G.
- Mobile-first de verdade: desenvolver em viewport 360px. Cenário real de uso é o navegador in-app do WhatsApp.
- Datas no banco em ISO; formatação pt-BR só na borda (UI e PDF).

### Identidade visual do SITE (não do PDF)

**As duas identidades são separadas e não se contaminam.** O site tem a paleta abaixo; o PDF tem a arte do Figma, com as cores e fontes que a Mel desenhou lá. Unificar as duas seria destruir a arte — nunca mexer em `assets/templates/` ou nas cores de `lib/pdf/templates.config.ts` a pretexto de "seguir a paleta".

- **Paleta: duas cores.** Preto (`#000000`) e `#F1F1F1`, em `--marca-preto` e `--marca-claro`. Branco entra só como superfície de card. Tom intermediário se deriva com opacidade (`rgb(0 0 0 / 60%)`), nunca acrescentando um hex novo.
- **Fonte: DM Sans em tudo**, servida de `assets/fonts/` via `next/font/local` (não do Google Fonts — ida a terceiro atrasa o LCP). `--font-sans`, `--font-heading` e `--font-mono` apontam todos para ela.
- **Raio: 6px em tudo.** Toda a escala `--radius-sm..4xl` aponta para `--radius`. Não usar `rounded-full`: mudar o raio do app inteiro deve ser mexer em uma linha só.
- `npm run estilo:verificar` (com `npm run dev` em outro terminal) checa os quatro no DOM renderizado: raio, fonte, paleta e ausência de scroll horizontal em 360px. Julgar por screenshot não serve — 6px num print em 2x parece 12px.
- `chrome --headless --window-size=360,x` **não** dá viewport de 360px (o Chrome tem largura mínima de janela e a imagem sai só recortada, simulando um estouro que não existe). Use `npm run screenshot -- <url> <saida.png> 360`, que emula via CDP.

## Workflow

- Commits pequenos, mensagens em inglês, padrão convencional (`feat:`, `fix:`, `chore:`).
- Mudança de arte (PDFs base ou coordenadas em `templates.config.ts`): PR dedicada contendo só isso.
- Feature só está pronta depois de rodar o cenário da Definition of Done (PRD seção 18) para a categoria afetada.
- Antes de deploy final: testar manualmente as 4 categorias e as 5 artes (aniversário com idade ≤14 e ≥15), incluindo a ramificação `making_of` com "Sim" e com "Não", e a retomada de lead incompleto.
- `npm run pdf:verificar` cobre **uma arte por cenário, as 5**, e falha se algum `TemplateId` ficar sem cenário. Arte nova sem cenário = script vermelho, de propósito: senão dá para acrescentar uma arte e nunca abri-la em teste nenhum.
- Ao corrigir um bug causado por premissa errada sobre o projeto, registrar a regra correta neste arquivo na mesma PR.

## Nunca fazer

- Nunca inventar perguntas, opções ou textos fora do `arvore.json` e do PRD.
- Nunca adicionar checagem de agenda, validação de conflito de datas ou disponibilidade.
- Nunca enviar e-mail em ambiente de desenvolvimento sem flag explícita (`MAIL_DRY_RUN=1` loga em vez de enviar).
- O Gmail REESCREVE o remetente para a conta autenticada: `MAIL_FROM` precisa usar o mesmo endereço de `GMAIL_USER`. Só o nome de exibição sobrevive.
- Nunca transformar o formulário em página única com todos os campos. Uma pergunta por tela é requisito de produto.
- Nunca remover o autosave ou condicionar a criação do lead ao término do formulário. Lead parcial é lead.
