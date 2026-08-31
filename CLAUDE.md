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
assets/templates       PDFs base do Figma: <arte>.<tabela>.pdf (5 artes x tabela de preço)
lib/pdf/precos.ts      Tabelas de preço e qual vale para cada ano de evento
scripts/preparar-arte  Exporta > comprime (Ghostscript) > une as páginas de uma arte
scripts/derivar-tabela Deriva a arte de uma tabela de preço da arte de outra
scripts/arte-raster    Parâmetros e rotina de raster, comuns aos dois scripts acima
assets/fonts           Fontes da marca (.ttf)
supabase/schema.sql    Schema completo
```

## Decisões travadas (NUNCA reabrir nem "melhorar")

1. PDF gerado com pdf-lib sobre os PDFs base do Figma. Nunca Puppeteer, Chromium, headless browser ou API do Figma em runtime.
2. E-mail sempre pela interface `MailAdapter`, com `GmailAdapter` (SMTP do Gmail da Mel, App Password) como único provider. Nunca chamar Nodemailer direto de uma rota: é a interface que garante que a trava do `MAIL_DRY_RUN` não seja contornada. **Sem serviço transacional de e-mail** — a conta Workspace entrega 2.000 destinatários/dia e o volume da Mel é muito menor. Não introduzir um sem que o volume mude de ordem de grandeza.
2b. O remetente é `mel@wama.digital`, e isso é **deliberado** — não é migração pendente para `@melstorymaker.com.br`. Decisão do owner em 18/08/2026: o nome de exibição ("Mel Simão | Storymaker") é o que o lead lê, e o endereço da agência não atrapalha. Não trocar sem pedido explícito: mudar exigiria criar o endereço no Workspace e alteraria `GMAIL_USER` junto, já que o Google reescreve o remetente.
3. WhatsApp = links `wa.me` gerados no painel. Nenhuma API de WhatsApp (Twilio, Z-API, Evolution, Baileys) **para falar com o lead ou enviar do número da Mel** — a trava protege o número dela de banimento. Exceção aprovada pelo owner (18/08/2026): notificação interna de lead novo via CallMeBot (`lib/notifica/`), em que a Mel só RECEBE de um gateway; conteúdo mínimo (sem e-mail nem telefone do lead na mensagem), falha nunca quebra o submit (`after()` + try/catch), e sem `NOTIFICA_WHATSAPP_APIKEY` é no-op. Essa exceção também retira a notificação de lead novo do escopo v2 proibido da regra 8. **A única env obrigatória é a apikey**: o número vem de `MEL_WHATSAPP`, e `NOTIFICA_WHATSAPP_FONE` só existe para mandar o aviso a um aparelho diferente. Pedir o mesmo telefone em duas variáveis já deixou a notificação muda em produção (20/08/2026, apikey configurada e fone não). A notificação dispara **no submit** (`incompleto` → `aguardando_revisao`), não na criação do lead: avisar na criação significaria uma mensagem para cada pessoa que escolheu a categoria e desistiu.
4. Human-in-the-loop: nenhum e-mail sai para o lead sem ação explícita da Mel no painel. Não criar envio automático pós-submit.
5. Formulário renderizado 100% a partir de `lib/form/arvore.json`. Perguntas nunca hardcoded em componentes. Nova pergunta = mudança no JSON.
6. Sem lógica de preço. Valores estão desenhados na arte estática dos templates. **Formato: `R$ XXX`** — o cifrão é um nó de texto SEPARADO do número no Figma (DM Sans Bold 18,11, mesma cor do número, borda direita ~10px à esquerda dele). Por ser separado, ele some sem alarde: em 20/08/2026 nove preços estavam sem cifrão em `aniversario_infantil_03`, `corporativo_03` e `corporativo_04`. Ao mexer em preço, auditar que todo número de 3–5 dígitos tem um `R$` pareado na mesma linha.
6b. Categoria (4, enum do Postgres) e arte (5, `TemplateId`) são conceitos separados. `aniversario` resolve entre `aniversario_infantil` (14 anos ou menos) e `aniversario_adulto` (15+) via `resolverTemplateId(categoria, respostas)`. Nunca indexar template por categoria, e nunca acrescentar valor ao enum para criar arte nova — isso geraria migration à toa.
6c. **Existe mais de uma TABELA de preço, e cada uma é um jogo próprio de PDFs base**: `assets/templates/<arte>.<tabela>.pdf`. Como o preço é pixel dentro do JPEG da arte (4d/4e), reajuste nunca é mexer em variável — é publicar outra arte. A tabela sai do **ANO DO EVENTO** (`respostas.data`), nunca da data em que o lead preencheu: quem marca festa para 2027 contrata pela tabela de 2027 mesmo tendo preenchido em 2026. Vigências em `lib/pdf/precos.ts`; vale a última tabela cujo ano já chegou, então um evento de 2029 segue na de 2027 até alguém criar outra. O ano é lido da STRING ISO, nunca via `new Date` — `new Date("2027-01-01")` é meia-noite em UTC e `getFullYear()` em São Paulo devolveria 2026, jogando o primeiro dia da tabela nova na tabela velha.
6d. Tabela **2027 aprovada pelo owner em 28/08/2026**: +15% sobre 2026, arredondado para cima até número comercial. **Só os PACOTES mudaram** — opcionais, locomoção, reserva de 30% e validade de 3 meses são idênticos nas duas tabelas. Os valores aprovados vivem em `PACOTES` (`precos.ts`) como ESPECIFICAÇÃO, não como fonte da geração: quem manda é o pixel da arte. O `arte:preparar` imprime a lista na hora do preparo, para conferir contra as páginas exportadas, e `precos.test.ts` prova que o reajuste respeita os 15%.
6e. **Arte de uma tabela faltando ABORTA a geração** (`ArteFaltandoError` → 409 com texto humano no painel, caminho do arquivo só no log). Nunca cair na arte de outro ano: seria enviar proposta com preço defasado sem ninguém perceber — mesma lógica do campo vazio (5b). Pelo mesmo motivo o placeholder só vale para a tabela base: placeholder não tem preço desenhado, então não representa tabela nenhuma.
7. Sem banners de cookies, telas de consentimento ou fluxos de LGPD. Decisão de escopo do owner.
8. Escopo v2 do PRD (seção 19) é proibido no MVP: sem tracking de abertura, sem agenda, sem contrato/pagamento, sem analytics de funil, sem notificações em tempo real.
9. Admin tem usuária única (Mel), criada via dashboard do Supabase. Nunca criar tela ou endpoint de signup.
10. **Quem apaga lead é a Mel, pelo painel** (menu de ações na linha → Excluir lead). Decisão do owner em 19/08/2026. Não escrever script de limpeza nem apagar lead por conta própria — nem "lead de teste", que já foi confundido com lead real. Se a base precisar de faxina, a instrução vai para a Mel, não para o banco.

## Dados e segurança

- O client NUNCA fala direto com o Supabase para leads. Todo acesso via route handlers usando `SUPABASE_SERVICE_ROLE_KEY` (server-side only).
- RLS ativado na tabela `leads` com zero policies públicas. Se um acesso falhar por RLS, a correção é no route handler, nunca criar policy pública.
- `respostas` é jsonb: mudança na árvore de perguntas não gera migration.
- **Leitura do painel passa por `lerComRetentativa`** (`lib/supabase/consulta.ts`). Em 22/08/2026 o quadro mostrou "JWT issued at future" em UMA das quatro colunas enquanto as outras três carregavam no mesmo request. A causa é do lado do Supabase — a chave `sb_secret_` é trocada por um JWT curto dentro da infra deles, e quando o nó que assina está um instante à frente do que valida, o `iat` cai no futuro. Não é o relógio da máquina (medido: 0s de desvio) nem a nossa chave (não é JWT). Repetir resolve, porque a próxima requisição pega outro nó. **Só para leitura** — em insert/update/delete retentativa pode duplicar escrita.
- **Erro de upstream nunca vai cru para a tela.** A Mel não tem o que fazer com "JWT issued at future"; a mensagem técnica vai para o log do servidor e a tela mostra texto humano + "Tentar de novo". O erro da coluna não era logado, e por isso não havia rastro nenhum nos logs da Vercel.
- Colunas promovidas (`nome_display`, `data_evento`, `email`, `whatsapp`) são atualizadas no autosave, junto com o jsonb.
- Transições de status apenas nos endpoints definidos: `incompleto` (criação) > `aguardando_revisao` (submit) > `enviado` (envio de e-mail) e, desde 20/08/2026, **`PATCH /api/admin/leads/[id]/status`**, a única em que uma pessoa (a Mel, arrastando no quadro) escreve status. A matriz de transição vive em `lib/admin/status.ts` e vale nos dois lados: o servidor recusa com 422, o cliente desabilita o item de menu.
- **`incompleto` NUNCA é destino.** Não é só uma raia do funil: é a única que devolve permissão de ESCRITA a quem tiver o UUID — reabre o autosave público sobre respostas já revisadas e re-arma o `submit`, que dispara `notificarMel()` de novo (a Mel recebe "lead novo" por um lead que ela mesma moveu). O `scripts/e2e-quadro.ts` prova isso: depois do 422, confere que o `PATCH /api/leads/[id]` público segue 409.
- **Coluna proibida no quadro nunca usa `disabled` no `useDroppable`.** Com `disabled`, o `closestCorners` elege o droppable mais próximo e o cartão mirado em "Novo" era solto em "Aguardando revisão", em silêncio. A coluna recebe o drop e `mover()` recusa com toast explicando. Coberto por `npm run e2e:arraste`.
- Marcar como "Enviado" pelo quadro **não manda e-mail** (regra 4 continua de pé): pede confirmação quando `enviado_em` é nulo e carimba a data, porque o caso real é a Mel ter mandado pelo WhatsApp. Sair de "Enviado" **nunca** limpa `enviado_em` — e-mail não desenvia.
- Nunca commitar `.env`, App Password ou service role key. Nunca expor a service role no bundle do client.

## PDF: gotchas obrigatórios

1. pdf-lib usa origem no canto INFERIOR esquerdo da página. Converter coordenadas vindas do Figma (origem superior esquerda): `y_pdf = alturaPagina - y_figma - tamanhoFonte`.
2. Chamar `pdfDoc.registerFontkit(fontkit)` ANTES de embutir qualquer fonte custom.
3. Campo com `maxLargura`: reduzir o tamanho da fonte proporcionalmente até caber. Nunca quebrar linha em campo de nome.
4. Criar a rota de calibração `/admin/debug-template?template=X` (grid de coordenadas a cada 20pt sobre o PDF base) ANTES de calibrar o primeiro template. Calibrar sem ela é proibido. O parâmetro é o `TemplateId`, não a categoria: `aniversario` sozinho é ambíguo. Aceita também `&tabela=` (padrão: a base) — cada tabela tem PDF base próprio, e o grid sobre a arte de 2026 não prova nada sobre a de 2027.
4b. **Preparo da arte** (mudança de arte = PR dedicada): esvaziar os placeholders no Figma (manter só `Olá,` no bloco de saudação, ocultar o cabeçalho), exportar cada frame com `download_assets` em PDF e rodar `npm run arte:preparar -- <template> <tabela> <pasta>`. A **tabela é posicional e obrigatória**, não flag com padrão: errá-la sobrescreve em silêncio a arte de um ano com as páginas de outro. O Ghostscript roda SÓ nesse preparo, rasterizando cada página; em produção continua apenas pdf-lib. **Depois de mudar a arte, os PDFs já gerados continuam com a arte velha** — só saem atualizados quando a Mel clicar em Gerar PDF de novo (o link não muda, RF-14).
4c. As cinco capas compartilham o mesmo desenho, montado por `camposCapa()` em `templates.config.ts`. Arte nova = uma chamada, variando a composição do cabeçalho e o `x` do nome.
4d. **A arte base é RASTERIZADA: um JPEG por página, sobre página A4 (595x842 pt).** O export do Figma é vetorial e trazia ~96 mil operações de path (o padrão topográfico) + 51 grupos de transparência; o visualizador de PDF do celular estourava o orçamento de renderização e pintava a página **branca**, só mostrando o conteúdo depois de um zoom que o obrigava a redesenhar em blocos. Reduzir a página para A4 sozinho **não resolveu** — foi preciso rasterizar. Resultado: de 96.405 operações de path para 10, e 12,05 → 3,25 MB no conjunto das 5 artes.
4e. O texto que o lead lê como DADO (nome, data, cabeçalho) **não** está no raster: é desenhado pelo pdf-lib em runtime, continua vetorial e nítido em qualquer zoom. O que virou pixel é o texto *da arte* — títulos, corpo, preços. Trade-off aceito pelo owner em 19/08/2026, tendo como alternativa o PDF branco no celular.
4f. `escala: ESCALA_ARTE` (595/1240) em todas as artes, nunca `1`: as coordenadas do config continuam sendo as do painel do Figma e a escala multiplica x, y e tamanho de fonte no `gerar.ts`. Verificação: gere e meça: o cabeçalho do casamento deve terminar em x≈552 pt.
4g. A peça é **100% digital** — ninguém imprime. O alvo é a tela: `--altura 2000` px por página (~171 DPI em A4). Subiu de 1280 (~109 DPI) em 20/08/2026 porque naquela resolução o texto *da arte* ficava visivelmente mole ao dar zoom. Como a arte inteira é imagem, essa altura é o único controle de nitidez que resta. `arte:preparar -- <arte> <pasta> [--altura PX] [--qualidade N]`.
4h. **O caminho vetorial já foi tentado e não resolve — não repetir.** Converter só as ondas em PNG (feito no Figma e que continua valendo) zerou os grupos de transparência (51 → 0), mas os paths caíram apenas de 96.405 para 78.027, e no celular a página continuou branca. A razão: **o Figma exporta texto como CONTORNO, sem fonte embutida** (zero `/FontFile` no PDF). Cada letra vira dezenas de curvas e só o corpo de texto responde por ~12 mil operações por página — nada que o Ghostscript alcance.
4i. As ondas do padrão topográfico **já estão como PNG dentro do Figma**, convertidas em 19/08/2026 com o vetor original oculto ao lado (`ondas (vetor original, oculto)`). Não desfazer: era o que sustentava os 51 grupos de transparência. Ao mexer na arte, o critério de "onda" é ≥3000 segmentos de path **e zero nós de texto** — sem a segunda condição o bloco de contato da Mel (telefone, e-mail, CNPJ) é confundido com decoração.
4j. **Tabela de preço nova NÃO se prepara do zero: deriva-se da anterior.** `npm run arte:derivar -- <arte> <tabelaOrigem> <tabelaDestino> <pasta>` copia a arte já publicada página por página e troca só as que estão na pasta, nomeadas pelo NÚMERO da página (`03.pdf` troca a terceira). Entre duas tabelas muda o preço e mais nada — remontar tudo a partir de um reexport abriria espaço para as páginas comuns divergirem por algo que ninguém pediu (uma foto trocada no Figma desde o último preparo). Derivando, a única diferença possível é a pretendida, e dá para **provar**: rasterize as duas artes e compare página a página; só a de Pacotes pode diferir. Foi assim que a tabela 2027 entrou, em 28/08/2026.
4k. Os parâmetros de raster (altura 2000, qualidade 82, A4) moram em `scripts/arte-raster.ts`, **compartilhados** por `arte:preparar` e `arte:derivar`. Nunca duplicar: se divergirem, a página trocada sai com nitidez diferente das vizinhas dentro do mesmo PDF, e como a arte inteira é imagem isso aparece na tela do lead.
4l. No Figma, cada tabela tem seu próprio frame de Pacotes, nomeado `<arte>_NN_tabela<ano>` (ex.: `casamento_04_tabela2027`), logo abaixo do original na mesma coluna. **Não editar o preço no frame de 2026 para gerar o de 2027** — os dois precisam continuar existindo, senão a arte da tabela antiga deixa de ser reproduzível. Os preços têm largura automática e o dígito do DM Sans não é tabular (o `0` mede ~30px, o `1` ~14px): ao trocar o número, ancore pela **borda direita** (`x = direitaAntiga - larguraNova`) e desloque o nó `R$` mantendo o mesmo respiro — fora do casamento, onde o `R$` faz parte do mesmo nó de texto.
5. Formatação sempre via `lib/pdf/formatadores.ts`: **data em DD/MM/AAAA** ("14/03/2026") em TODOS os PDFs, hora no padrão "19h30". O formatador `data_extenso` continua disponível no registry, mas nenhuma arte usa.
5b. **Campo do config vazio aborta a geração.** Todo campo de `templates.config.ts` é obrigatório salvo `opcional: true`. Faltando qualquer um, `gerarProposta` lança `CamposFaltandoError` com a lista, a rota devolve 422 e nada é gravado no banco nem no Storage. Nunca pular campo vazio em silêncio: PDF com buraco onde deveria estar o nome do lead é pior do que PDF nenhum. Pela mesma razão, `resolverTemplateId` devolve `null` em vez de escolher uma arte padrão quando a idade falta.
6. Regerar PDF sobrescreve `{leadId}.pdf` no bucket `propostas` (URL estável para o link do WhatsApp). Preview no painel usa query param de cache-bust.
7. **O link público da proposta é `{APP_URL}/p/{slug}`** — 4 caracteres (707 mil combinações), coluna `slug` na tabela, gerada por `garantirSlug()` na primeira geração do PDF e nunca mais alterada (RF-14). Nunca devolver a URL crua do Supabase: esse link vai por WhatsApp e o lead lê o domínio. `APP_URL` errada em produção = link quebrado no celular de quem recebeu. A rota antiga `/proposta/{leadId}.pdf` continua viva porque links já enviados não podem morrer — mas não usar em código novo.
7b. **Os 4 caracteres são decisão consciente do owner (19/08/2026), não descuido.** O risco foi medido e apresentado: o espaço é varrível e um acerto expõe nome e data do evento. O owner manteve, pelo volume real (~3 leads/dia, trabalho artesanal que não escala) — nesse volume a colisão é desprezível e o espaço fica esparso. O que segura a porta é o **rate limit de 30/min por IP em `/p/[slug]`**: essa proteção não é opcional, é o que substitui o tamanho do slug. Nunca remover. Se um dia o volume mudar de ordem de grandeza, a correção é `TAMANHO_SLUG = 6` (594 milhões), e links antigos seguem valendo.

8. **A prévia da proposta no painel tem dois visualizadores, e isso é de propósito.** Acima de 640px é o `<iframe>` de sempre: o visualizador nativo dá rolagem contínua, zoom e impressão de graça. Abaixo de 640px ele não serve — o WebKit desenha o PDF dentro do iframe como uma miniatura de UMA página, com barra de rolagem própria e sem caminho para as outras páginas. No celular a prévia é desenhada por nós em canvas (`components/admin/PreviaProposta.tsx`, pdf.js), página inteira, uma por vez, com paginação embaixo. Não unificar nos dois lados: no desktop o card tem ~900px e a página A4 inteira sairia mais alta que a tela, o que exigiria encaixar também pela altura — problema que no celular não existe.
8b. O pdf.js entra por **import dinâmico** e só nessa tela: ele é grande e o bundle de `/formulario` é sagrado. Build `legacy` (já transpilado, roda em WebView antigo), e o arquivo é baixado com **um `fetch` só**, com os bytes entregues prontos ao `getDocument` — solto, o pdf.js fatia o PDF em vários range requests e `/p/{slug}` tem limite de 30/min por IP (7b).
8c. **Qual visualizador aparece é decidido por `clientWidth`, com `matchMedia` E `ResizeObserver` como gatilhos.** Só o `change` do `matchMedia` não basta: em emulação de dispositivo e em parte dos WebView a media não é reavaliada e o evento nunca chega, então girar o aparelho deixava o visualizador errado na tela.

## Convenções de código

- Domínio em pt-BR: categorias, status, chaves do jsonb e do `arvore.json` (`aguardando_revisao`, `making_of`, `local_festa`). Código e infra em inglês: variáveis, funções, componentes, commits.
- **`nome` é sempre quem PREENCHEU o formulário, nunca o sujeito do evento.** O sujeito mora em chave própria por categoria (`debutante`, `aniversariante`, `noivos`, `empresa`), com o mesmo nome da variável na arte do Figma. Use `nomeContato()` e `sujeitoDoEvento()` de `lib/leads.ts` — nunca leia `respostas.nome` direto esperando o nome do evento. `nome_display` guarda o sujeito; a saudação do e-mail e do WhatsApp usa quem preencheu.
- Toda string visível ao usuário em pt-BR. Copy do e-mail: a da seção 14 do PRD. A do **WhatsApp** é escrita pelo owner e mora em `mensagemProposta` (`lib/whatsapp.ts`) — versão atual de 20/08/2026, com emoji e o link em linha própria. Não restaurar a do PRD nem a versão sem emoji de 19/08. Mudança de copy = mudar a função e o teste `lib/whatsapp.test.ts` juntos.
- **Datas e horas para a Mel sempre em `America/Sao_Paulo`**, via `dataHoraLocal`. Nunca `getHours()`/`getDate()` direto: a lista do painel é renderizada no servidor da Vercel, que roda em UTC, e um lead das 15h08 aparecia como 18h08.
- Um componente por tipo de pergunta (`texto`, `data`, `hora`, `escolha_unica`, `email`, `telefone`, `numero`), todos consumindo o schema do `arvore.json`.
- Sem dependências novas sem justificativa de 1 linha no PR. O bundle de `/formulario` é sagrado: LCP < 2.5s em 4G.
- Mobile-first de verdade: desenvolver em viewport 360px. Cenário real de uso é o navegador in-app do WhatsApp.
- Datas no banco em ISO; formatação pt-BR só na borda (UI e PDF).

### Identidade visual do SITE (não do PDF)

**As duas identidades são separadas e não se contaminam.** O site tem a paleta abaixo; o PDF tem a arte do Figma, com as cores e fontes que a Mel desenhou lá. Unificar as duas seria destruir a arte — nunca mexer em `assets/templates/` ou nas cores de `lib/pdf/templates.config.ts` a pretexto de "seguir a paleta".

- **Paleta: duas cores.** O escuro da marca (`#20130A`) e `#F1F1F1`, em `--marca-escuro` e `--marca-claro`. Branco entra só como superfície de card. Tom intermediário se deriva com opacidade (`rgb(var(--marca-escuro-rgb) / 12%)`), nunca acrescentando um hex novo — por isso existe `--marca-escuro-rgb`, os componentes soltos da mesma tinta.
- **A identidade da Mel (Figma, frame `7120:556`) tem quatro tons**: `#20130A` (escuro, e a cor do logo), `#4D2B22`, `#823B25` (terracota) e `#CBAD95` (areia), mais um creme `#F0E0C7`. O app usa **dois**: o escuro e `#F1F1F1`. A terracota entra num lugar só, o **anel de foco** (`--ring`) — é o acento da marca onde ele aparece em toda tela sem repintar nada. Os outros dois ficam registrados no comentário do `globals.css` para ninguém inventar um marrom diferente; não estão em uso.
- **O claro continua `#F1F1F1`, e não o creme da marca.** Troca pedida pelo owner em 29/08/2026 foi só das cores **escuras** (preto → `#20130A`), para o painel seguir clean. Trocar o fundo pelo creme é decisão nova, não consequência desta.
- **`--muted-foreground` é 65%, não 60%.** O marrom é mais claro que o preto: a 60% caía para 4,56:1 sobre `#F1F1F1` — passa no AA, mas sem folga. A 65% dá 5,37:1. Ao mexer na tinta escura, refaça essa conta.
- **O logo é `components/marca/LogoMel.tsx`**, SVG inline com `fill="currentColor"` (o arquivo original vinha com `#20130A` fixo). Inline e não `<img>`: aparece no cabeçalho de toda tela autenticada, e uma requisição a mais atrasaria a primeira pintura. Altura por classe (`h-7` = 28px), largura automática pelo viewBox 274x38.
- **A regra das duas cores vale para as telas do LEAD** (`/formulario`, `/p/[slug]`, `/`). O **painel interno** usa também as cores de status do quadro — slate/âmbar/sky/emerald —, definidas só em `CLASSE_STATUS`/`TEMA_COLUNA` (`lib/admin/rotulos.ts`). Decisão do owner em 20/08/2026, ao pedir o kanban com "visual Notion". Já havia precedente não documentado (`emerald-100` no badge de enviado, `amber-50`/`emerald-50` nos avisos do detalhe). As classes são **literais**: `bg-${cor}-50` some do CSS porque o scanner do Tailwind v4 não lê string interpolada. E **não** apontar `estilo:verificar` para `/admin` — ele falharia por desenho, além de exigir sessão.
- **Fonte: DM Sans em tudo**, servida de `assets/fonts/` via `next/font/local` (não do Google Fonts — ida a terceiro atrasa o LCP). `--font-sans`, `--font-heading` e `--font-mono` apontam todos para ela.
- **Tracking:** títulos, botões e utilitários de peso (`font-semibold/bold/black`) levam `letter-spacing: -0.3px`. É CSS do site apenas — o texto do PDF é desenhado pelo pdf-lib e não passa por aqui.
- **Cursor de mão em tudo que se clica**, sem exceção: botão, link, item de menu, opção de escolha, checkbox, radio, select. Desabilitado usa `not-allowed`. Campo de texto (inclusive data e hora) fica com o cursor de digitação — ali a mão sugeriria botão. A regra é global, em `@layer base`; nunca reintroduzir `cursor-default` num componente (o utilitário vence a camada base e foi o que o shadcn trouxe por padrão). Motivo de existir: o **Tailwind v4 mudou o padrão do `button` de `pointer` para `default`**, então sem a regra o sistema inteiro perde a dica de clicabilidade.
- **Raio: 6px em tudo.** Toda a escala `--radius-sm..4xl` aponta para `--radius`. Não usar `rounded-full`: mudar o raio do app inteiro deve ser mexer em uma linha só.
- `npm run estilo:verificar` (com `npm run dev` em outro terminal) checa cinco coisas no DOM renderizado: raio, fonte, paleta, **cursor de todo clicável** e ausência de scroll horizontal em 360px. Julgar por screenshot não serve — 6px num print em 2x parece 12px.
- `chrome --headless --window-size=360,x` **não** dá viewport de 360px (o Chrome tem largura mínima de janela e a imagem sai só recortada, simulando um estouro que não existe). Use `npm run screenshot -- <url> <saida.png> 360`, que emula via CDP.

## Workflow

- Commits pequenos, mensagens em inglês, padrão convencional (`feat:`, `fix:`, `chore:`).
- Mudança de arte (PDFs base ou coordenadas em `templates.config.ts`): PR dedicada contendo só isso.
- Feature só está pronta depois de rodar o cenário da Definition of Done (PRD seção 18) para a categoria afetada.
- Antes de deploy final: testar manualmente as 4 categorias e as 5 artes (aniversário com idade ≤14 e ≥15), incluindo a ramificação `making_of` com "Sim" e com "Não", e a retomada de lead incompleto. Com mais de uma tabela viva, testar também um evento de cada ano de tabela — é a única forma de ver o preço certo saindo no PDF, já que ele é imagem e nenhum teste o lê.
- `npm run pdf:verificar` cobre o cruzamento **arte × tabela de preço** (5 artes × N tabelas), e falha se alguma combinação ficar sem cenário. Arte ou tabela nova sem cenário = script vermelho, de propósito: senão dá para acrescentar uma arte, ou um ano inteiro de preço, e nunca abri-los em teste nenhum. Enquanto uma tabela não tiver as 5 artes publicadas, ele lista os arquivos que faltam — vermelho esperado, não regressão.
- **Nunca rodar `npm run build` com o `npm run dev` no ar**: os dois escrevem em `.next` e o dev server passa a devolver 500 com `ENOENT ..._buildManifest.js.tmp`. A correção é parar o dev, `rm -rf .next` e subir de novo.
- Quadro de leads: `npm run e2e:quadro` (API, rápido) e `npm run e2e:arraste` (arraste real via CDP, precisa do Chrome). Os dois criam admin e leads temporários e limpam no fim.
- Ao corrigir um bug causado por premissa errada sobre o projeto, registrar a regra correta neste arquivo na mesma PR.

## Nunca fazer

- Nunca inventar perguntas, opções ou textos fora do `arvore.json` e do PRD.
- Nunca adicionar checagem de agenda, validação de conflito de datas ou disponibilidade.
- Nunca enviar e-mail em ambiente de desenvolvimento sem flag explícita (`MAIL_DRY_RUN=1` loga em vez de enviar).
- O Gmail REESCREVE o remetente para a conta autenticada: `MAIL_FROM` precisa usar o mesmo endereço de `GMAIL_USER`. Só o nome de exibição sobrevive.
- Nunca transformar o formulário em página única com todos os campos. Uma pergunta por tela é requisito de produto.
- Nunca remover o autosave ou condicionar a criação do lead ao término do formulário. Lead parcial é lead.
