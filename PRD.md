# PRD: Sistema de Propostas Automatizadas | Mel Simão Storymaker

| Campo | Valor |
|---|---|
| Versão | 1.0 (MVP) |
| Owner | Henrique |
| Operadora | Mel Simão |
| Prazo | 2 dias |
| Domínio | melstorymaker.com.br (Registro.br) |
| Custo alvo de infra | R$ 0/mês (free tiers, domínio já registrado) |
| Status | Aprovado para desenvolvimento |

---

## 1. Contexto e problema

A Mel é storymaker e recebe todos os leads pelo WhatsApp. Hoje o processo é 100% manual: ela conversa com o lead, coleta as informações do evento uma a uma, abre a proposta padrão no Figma, troca nome, data, local e horário, exporta em PDF e envia por e-mail.

Isso gera três problemas: tempo gasto por lead, risco de erro na personalização (nome errado em proposta é perda de venda) e demora entre o interesse do lead e o recebimento da proposta.

## 2. Objetivo do MVP

Automatizar o caminho entre "lead interessado" e "proposta na caixa de entrada", mantendo a Mel no controle da aprovação final.

Fluxo alvo: Mel envia 1 link pelo WhatsApp > lead preenche formulário em menos de 2 minutos > sistema gera PDF fiel à arte do Figma > Mel revisa e aprova em 2 cliques > proposta chega no e-mail do lead.

## 3. Decisões de produto travadas

Estas decisões já foram tomadas e não devem ser reabertas durante o desenvolvimento:

1. **Figma é fonte de arte, não runtime.** A arte de cada categoria é exportada do Figma como PDF base. O texto dinâmico é aplicado por cima via `pdf-lib` usando coordenadas fixas. Fidelidade 1:1 com o design original, zero dependência de API do Figma.
2. **Human-in-the-loop obrigatório.** Nenhuma proposta sai sem a Mel aprovar no painel admin.
3. **Envio ao lead por e-mail.** Complementado por botão `wa.me` no painel para a Mel encaminhar o link do PDF pelo WhatsApp dela (canal onde o lead já está). Sem API de WhatsApp, custo zero.
4. **E-mail transacional via Resend com o domínio melstorymaker.com.br.** Domínio já registrado no Registro.br. Remetente: `mel@melstorymaker.com.br`, reply-to no Gmail atual da Mel. Contingência: `GmailAdapter` (Nodemailer + App Password) pronto no repo; se a verificação DNS não concluir dentro do prazo, a troca é o env `MAIL_PROVIDER=gmail`, sem tocar em código.
5. **Form engine próprio com árvore declarativa em JSON.** Uma pergunta por tela, estilo Typeform, mobile-first. Sem Typeform/mensalidade.
6. **Etapa de contato adicionada ao final do formulário.** E-mail obrigatório (sem ele não existe envio), WhatsApp opcional (alimenta o botão de compartilhamento).
7. **Preço e pacotes ficam na arte estática.** Os valores já estão desenhados na proposta de cada categoria. Nenhuma lógica de precificação no MVP.
8. **Lead parcial é lead.** O registro é criado na primeira interação (escolha da categoria) e salvo a cada passo. Abandono no meio ainda deixa dados para a Mel fazer follow-up.

## 4. Escopo

### Dentro do MVP

1. Formulário público multi-etapas em `/formulario` com 4 categorias (5 artes) e ramificações
2. Autosave de respostas parciais (lead incompleto fica salvo)
3. Painel admin protegido por login para a Mel
4. Geração de PDF personalizado por categoria (arte exportada do Figma + campos dinâmicos)
5. Preview do PDF no painel antes do envio
6. Envio por e-mail com PDF anexo + link
7. Botão de envio via WhatsApp (`wa.me` com mensagem pronta e link do PDF)
8. Edição das respostas do lead pelo painel antes de gerar/regerar o PDF

### Fora do MVP (v2)

1. Checagem de agenda / conflito de datas
2. Aceite digital da proposta, contrato e pagamento
3. Notificações em tempo real para a Mel
4. Analytics de funil e abandono por etapa
5. Editor de template para a Mel (arte é controlada pelo Henrique via PR)
6. Tracking de abertura de proposta
7. Multiusuário no admin
8. Upload de arquivos pelo lead
9. Fluxos de consentimento/LGPD (decisão de escopo do owner: não implementar banners nem telas de consentimento)

## 5. Fluxo end-to-end

```
[Mel no WhatsApp] envia link melstorymaker.com.br/formulario
        v
[Lead] abre no navegador in-app do WhatsApp (cenário principal: mobile)
        v
Tela de boas-vindas > escolhe categoria
        v                    (lead criado no banco, status: incompleto)
Responde perguntas da categoria (autosave a cada passo)
        v
Etapa de contato (e-mail obrigatório, WhatsApp opcional)
        v
Tela de confirmação        (status: aguardando_revisao)
        v
[Mel no /admin] vê o lead novo > confere/edita respostas > "Gerar proposta"
        v                    (PDF gerado, salvo no Storage, preview no painel)
Mel revisa o PDF > "Enviar por e-mail" e/ou "Enviar via WhatsApp"
        v                    (status: enviado, timestamp registrado)
[Lead] recebe e-mail com PDF anexo + link
```

## 6. Formulário: árvore de perguntas

Fonte única de verdade em `/lib/form/arvore.json`. O engine renderiza a partir deste JSON. Mudança de pergunta = mudança no JSON, sem refactor.

```json
{
  "boas_vindas": {
    "titulo": "Oi! Eu sou a Mel ✨",
    "texto": "Vou te fazer algumas perguntinhas rápidas pra montar a proposta perfeita pro seu evento. Leva menos de 2 minutos.",
    "cta": "Começar"
  },
  "categoria": {
    "tipo": "escolha_unica",
    "pergunta": "Que momento vamos eternizar? ✨",
    "opcoes": [
      { "valor": "debutante", "rotulo": "Festa de 15 anos" },
      { "valor": "aniversario", "rotulo": "Aniversário" },
      { "valor": "casamento", "rotulo": "Casamento" },
      { "valor": "corporativo", "rotulo": "Evento corporativo" }
    ]
  },
  "fluxos": {
    "debutante": [
      { "id": "nome", "tipo": "texto", "pergunta": "Nome da debutante ✨", "obrigatorio": true },
      { "id": "data", "tipo": "data", "pergunta": "Data da festa", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do convite", "obrigatorio": true },
      { "id": "local", "tipo": "texto", "pergunta": "Local da festa", "obrigatorio": true },
      { "id": "making_of", "tipo": "escolha_unica", "pergunta": "Quer registrar o making of?", "opcoes": ["Sim", "Não"], "obrigatorio": true },
      { "id": "local_making_of", "tipo": "texto", "pergunta": "Local do making of", "obrigatorio": true, "exibir_se": { "making_of": "Sim" } },
      { "id": "entrega", "tipo": "escolha_unica", "pergunta": "Como você prefere a entrega?", "opcoes": ["Em tempo real", "Em até 1 semana"], "obrigatorio": true }
    ],
    "aniversario": [
      { "id": "nome", "tipo": "texto", "pergunta": "Nome do(a) aniversariante ✨", "obrigatorio": true },
      { "id": "idade", "tipo": "numero", "pergunta": "Quantos anos vai completar? ✨", "obrigatorio": true, "min": 1, "max": 120 },
      { "id": "data", "tipo": "data", "pergunta": "Data da festa", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do convite", "obrigatorio": true },
      { "id": "local", "tipo": "texto", "pergunta": "Local da festa", "obrigatorio": true },
      { "id": "entrega", "tipo": "escolha_unica", "pergunta": "Como você prefere a entrega?", "opcoes": ["Em tempo real", "Em até 1 semana"], "obrigatorio": true }
    ],
    "casamento": [
      { "id": "nome", "tipo": "texto", "pergunta": "Nome dos noivos ✨", "placeholder": "Ex: Ana & João", "obrigatorio": true },
      { "id": "data", "tipo": "data", "pergunta": "Data do casamento", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do convite", "obrigatorio": true },
      { "id": "local_cerimonia", "tipo": "texto", "pergunta": "Local da cerimônia", "obrigatorio": true },
      { "id": "local_festa", "tipo": "texto", "pergunta": "Local da festa", "obrigatorio": true },
      { "id": "making_of", "tipo": "escolha_unica", "pergunta": "Quer registrar o making of?", "opcoes": ["Sim", "Não"], "obrigatorio": true },
      { "id": "local_making_of", "tipo": "texto", "pergunta": "Local do making of", "obrigatorio": true, "exibir_se": { "making_of": "Sim" } },
      { "id": "entrega", "tipo": "escolha_unica", "pergunta": "Como você prefere a entrega?", "opcoes": ["Em tempo real", "Em até 1 semana"], "obrigatorio": true }
    ],
    "corporativo": [
      { "id": "nome", "tipo": "texto", "pergunta": "Nome da empresa", "obrigatorio": true },
      { "id": "tipo_evento", "tipo": "texto", "pergunta": "Que tipo de evento vamos cobrir?", "obrigatorio": true },
      { "id": "data", "tipo": "data", "pergunta": "Data do evento", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do evento", "obrigatorio": true },
      { "id": "local", "tipo": "texto", "pergunta": "Local do evento", "obrigatorio": true }
    ]
  },
  "contato": [
    { "id": "contato_email", "tipo": "email", "pergunta": "Qual o seu melhor e-mail? É pra lá que vai a proposta ✨", "obrigatorio": true },
    { "id": "contato_whatsapp", "tipo": "telefone", "pergunta": "E o seu WhatsApp? (opcional)", "obrigatorio": false, "mascara": "(00) 00000-0000" }
  ],
  "confirmacao": {
    "titulo": "Prontinho! ✨",
    "texto": "Recebi tudo com carinho. Em breve sua proposta personalizada chega no seu e-mail.",
    "cta_whatsapp": "Falar com a Mel agora"
  }
}
```

Regras do engine:

1. `exibir_se` define a ramificação: o passo só é renderizado se a condição bater com resposta anterior. Se não bater, o engine pula para o próximo passo do array.
2. A ordem do array é a ordem das telas.
3. Depois do último passo do fluxo da categoria, o engine sempre injeta os passos de `contato` e encerra em `confirmacao`.
4. `cta_whatsapp` da confirmação abre `https://wa.me/{MEL_WHATSAPP}` (env var), mantendo a conversa quente.
5. **Categoria e arte não são a mesma coisa.** `aniversario` é uma categoria só no banco, mas resolve entre duas artes conforme a resposta de `idade`: **14 anos ou menos = infantil, 15 ou mais = adulto**. São 4 categorias e 5 artes. Acrescentar arte não mexe no enum do Postgres, logo não gera migration.

## 7. Requisitos funcionais

| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-01 | Formulário público em `/formulario`, sem login | Link abre direto na tela de boas-vindas em qualquer navegador mobile |
| RF-02 | Escolha da categoria cria o lead imediatamente | Registro aparece no banco com `status = incompleto` antes da 2ª pergunta |
| RF-03 | Uma pergunta por tela, avanço por clique ou Enter, botão voltar, barra de progresso | Navegável 100% por teclado no desktop e por toque no mobile |
| RF-04 | Autosave a cada avanço de passo | Fechar a aba e reabrir o link no mesmo device retoma do passo onde parou (leadId em localStorage) |
| RF-05 | Ramificação do making of | Responder "Não" pula direto para a pergunta de entrega; "Sim" exibe o local do making of |
| RF-06 | Etapa de contato com e-mail validado (obrigatório) e WhatsApp com máscara BR (opcional) | E-mail inválido bloqueia o avanço com mensagem clara |
| RF-07 | Submit final muda status e confirma | `status = aguardando_revisao`, tela de confirmação exibida com CTA de WhatsApp da Mel |
| RF-08 | Admin protegido por login (Supabase Auth), sem tela de signup | Usuária única da Mel criada via seed/dashboard; rota `/admin` inacessível sem sessão |
| RF-09 | Lista de leads com filtro por status e busca por nome | Leads incompletos aparecem na lista com indicação do passo onde pararam |
| RF-10 | Detalhe do lead com respostas editáveis | Mel corrige um nome com erro de digitação e salva antes de gerar o PDF |
| RF-11 | Geração de PDF por categoria | Botão "Gerar proposta" aplica os campos dinâmicos no template da categoria, salva no Storage e exibe preview embedado no painel |
| RF-12 | Envio por e-mail | Botão "Enviar por e-mail" dispara mensagem com PDF anexo + link; `status = enviado` com timestamp |
| RF-13 | Envio via WhatsApp | Botão abre `wa.me` com mensagem pré-preenchida + link público do PDF; com número do lead vai direto pro contato, sem número abre o seletor de conversa |
| RF-14 | Regerar PDF após edição | Novo PDF sobrescreve o anterior (mesma URL, cache-bust no preview) |
| RF-15 | Formatação pt-BR no PDF | Data por extenso ("14 de março de 2026") e horário no padrão "19h30" |

## 8. Painel admin

Rotas:

```
/admin/login          Login (e-mail + senha, Supabase Auth)
/admin                Lista de leads
/admin/leads/[id]     Detalhe + ações
```

Lista (`/admin`):

1. Colunas: Nome, Categoria, Data do evento, Status, Recebido em
2. Filtro por status (Todos / Incompletos / Aguardando revisão / Enviados)
3. Busca por nome
4. Ordenação padrão: mais recente primeiro
5. Badge visual por status (incompleto = cinza, aguardando_revisao = destaque, enviado = verde)

Detalhe (`/admin/leads/[id]`):

1. Todas as respostas em campos editáveis (bind direto no `respostas` jsonb) + botão Salvar
2. Bloco de contato: e-mail e WhatsApp do lead
3. Ação "Gerar proposta" > preview do PDF embedado (iframe)
4. Ação "Enviar por e-mail" (habilitada só com PDF gerado)
5. Ação "Enviar via WhatsApp" (habilitada só com PDF gerado)
6. Ação "Baixar PDF"
7. Histórico simples: gerado em, enviado em

Estados do lead:

| Status | Significado | Transição |
|---|---|---|
| `incompleto` | Começou e não terminou o form | Criado na escolha da categoria |
| `aguardando_revisao` | Form completo, esperando a Mel | Submit final do lead |
| `enviado` | Proposta enviada por e-mail | Clique em "Enviar por e-mail" |

## 9. Pipeline da proposta (PDF)

### Insumos (exportados do Figma, versionados no repo)

```
/assets/templates/debutante.pdf              3-4 páginas, arte final, espaços em branco nos campos dinâmicos
/assets/templates/aniversario_infantil.pdf   até 14 anos
/assets/templates/aniversario_adulto.pdf     15 anos ou mais
/assets/templates/casamento.pdf
/assets/templates/corporativo.pdf
/assets/fonts/*.ttf                          Fontes da marca (necessárias pro pdf-lib desenhar texto idêntico ao design)
```

São **5 artes para 4 categorias**: o nome do arquivo é o `TemplateId`, não a categoria.

Exportar do Figma com imagens comprimidas. Alvo: cada PDF base abaixo de 4MB (vai por anexo de e-mail).

### Geração

Biblioteca: `pdf-lib` + `@pdf-lib/fontkit`. Puro JS, roda em serverless da Vercel sem Chromium, geração em menos de 3s.

Config de coordenadas por categoria em `/lib/pdf/templates.config.ts`:

```ts
export const templates: Record<Categoria, TemplateConfig> = {
  debutante: {
    basePdf: "assets/templates/debutante.pdf",
    campos: [
      { chave: "nome",    fonte: "respostas.nome",    pagina: 0, x: 140, y: 520, font: "BrandSerif-Bold", tamanho: 32, cor: "#3A2E2A", maxLargura: 420 },
      { chave: "data",    fonte: "respostas.data",    pagina: 1, x: 90,  y: 610, font: "BrandSans-Regular", tamanho: 14, cor: "#3A2E2A", formato: "data_extenso" },
      { chave: "horario", fonte: "respostas.horario", pagina: 1, x: 90,  y: 580, font: "BrandSans-Regular", tamanho: 14, cor: "#3A2E2A", formato: "hora_br" },
      { chave: "local",   fonte: "respostas.local",   pagina: 1, x: 90,  y: 550, font: "BrandSans-Regular", tamanho: 14, cor: "#3A2E2A", maxLargura: 380 }
    ]
  }
  // aniversario, casamento e corporativo seguem a mesma estrutura,
  // casamento inclui local_cerimonia e local_festa como campos separados
};
```

Notas de implementação (importantes pro agente de código):

1. **Origem do eixo Y no pdf-lib é o canto inferior esquerdo da página.** Coordenadas do Figma (origem superior esquerda) precisam ser convertidas: `y_pdf = alturaPagina - y_figma - tamanhoFonte`.
2. Criar rota de calibração `/admin/debug-template?template=X` que gera o PDF base com um grid de coordenadas a cada 20pt sobreposto. Corta o tempo de ajuste fino de horas para minutos. O parâmetro é o `TemplateId` (5 valores), não a categoria.
3. Registrar fontkit e embutir as fontes da marca antes de desenhar qualquer texto.
4. `maxLargura`: se o texto exceder, reduzir o tamanho da fonte proporcionalmente até caber (nunca quebrar linha em campo de nome).
5. Respostas de `idade`, `making_of` e `entrega` não são impressas no PDF: a idade serve para escolher a arte, as outras aparecem no painel como contexto da Mel. `tipo_evento` (corporativo) É impresso — a arte reserva espaço para ele.
6. A resolução da arte é `resolverTemplateId(categoria, respostas)`, não um acesso direto por categoria. Idade ausente ou ilegível cai em `aniversario_adulto`, e o painel mostra à Mel qual arte foi usada — um lead incompleto nunca gera proposta infantil por acidente.

### Armazenamento

Supabase Storage, bucket `propostas` (público). Arquivo: `{leadId}.pdf`. Regerar sobrescreve o mesmo arquivo (URL estável para o link do WhatsApp).

## 10. Envio: e-mail + WhatsApp

### Adapter de e-mail

```ts
interface MailAdapter {
  send(opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer }[];
  }): Promise<void>;
}
```

Implementação principal: `ResendAdapter` (API do Resend, domínio `melstorymaker.com.br` verificado). Remetente: `Mel Simão | Storymaker <mel@melstorymaker.com.br>`. Reply-to: Gmail atual da Mel, para as respostas dos leads caírem na caixa que ela já usa no dia a dia.

Importante: NÃO é necessário criar caixa de e-mail no domínio (Google Workspace, Zoho etc). O Resend só precisa do domínio verificado para enviar; as respostas voltam pro Gmail via reply-to. Custo zero.

Contingência: `GmailAdapter` (Nodemailer, SMTP `smtp.gmail.com:465`, auth via `GMAIL_USER` + `GMAIL_APP_PASSWORD`; exige 2FA ativo na conta Google da Mel). Seleção do provider via env `MAIL_PROVIDER` (`resend` | `gmail`): se o DNS do Resend não verificar até a tarde do Dia 2, o envio sai pelo Gmail sem mudança de código.

### E-mail ao lead

PDF em anexo (`Proposta - Mel Simão.pdf`) + link público do PDF no corpo (redundância caso o anexo caia em filtro).

### Botão WhatsApp no painel

```
https://wa.me/55{whatsapp_lead}?text={mensagem_encoded}
```

Sem número do lead: `https://wa.me/?text={mensagem_encoded}` (abre o seletor de conversas da Mel).

## 11. Modelo de dados

```sql
create type lead_categoria as enum ('debutante', 'aniversario', 'casamento', 'corporativo');
create type lead_status as enum ('incompleto', 'aguardando_revisao', 'enviado');

create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  categoria lead_categoria not null,
  status lead_status not null default 'incompleto',
  respostas jsonb not null default '{}'::jsonb,
  passo_atual text,
  nome_display text,
  data_evento date,
  email text,
  whatsapp text,
  pdf_url text,
  pdf_gerado_em timestamptz,
  enviado_em timestamptz
);

create index leads_status_idx on leads (status);
create index leads_created_idx on leads (created_at desc);

alter table leads enable row level security;
```

Regras:

1. **Nenhuma policy pública.** Todo acesso do formulário passa por route handlers do Next.js usando a service role key (server-side). O client nunca fala direto com o Supabase para leads.
2. `respostas` em jsonb: mudanças na árvore de perguntas não exigem migration.
3. `nome_display` e `data_evento` são colunas promovidas (preenchidas no autosave) para a lista do admin ser rápida sem parse de jsonb.

## 12. Arquitetura e stack

| Camada | Escolha | Free tier |
|---|---|---|
| Framework | Next.js 14+ (App Router, TypeScript) | n/a |
| Hosting | Vercel Hobby | Suficiente |
| UI | Tailwind + shadcn/ui + Framer Motion (transições do form) | n/a |
| Banco/Auth/Storage | Supabase Free | 500MB DB, 1GB Storage, 50k MAU auth |
| PDF | pdf-lib + @pdf-lib/fontkit | Open source |
| E-mail | Resend (principal) + Gmail SMTP (contingência), atrás de MailAdapter | Resend: 3.000/mês, 100/dia; Gmail: 500/dia |
| WhatsApp | Links wa.me | Gratuito |

### Estrutura do repo

```
/app
  /formulario            Form público multi-etapas
  /admin                 Painel (login, lista, detalhe)
  /api
    /leads               POST (criar), PATCH [id] (autosave), POST [id]/submit
    /admin/leads/[id]    POST gerar-pdf, POST enviar
/lib
  /form                  arvore.json, engine de renderização
  /pdf                   templates.config.ts, gerar.ts, formatadores pt-BR
  /mail                  adapter.ts, gmail.ts, templates de e-mail
/assets
  /templates             4 PDFs base exportados do Figma
  /fonts                 Fontes da marca
/supabase
  schema.sql
```

### Variáveis de ambiente

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MAIL_PROVIDER=resend
RESEND_API_KEY=
MAIL_FROM="Mel Simão | Storymaker <mel@melstorymaker.com.br>"
MAIL_REPLY_TO=
MAIL_DRY_RUN=0
GMAIL_USER=
GMAIL_APP_PASSWORD=
MEL_WHATSAPP=5519XXXXXXXXX
APP_URL=https://melstorymaker.com.br
```

### DNS (painel do Registro.br)

Criar no Dia 1 de manhã, para a propagação correr em paralelo ao desenvolvimento:

1. Apontamento do apex `melstorymaker.com.br` para a Vercel (usar exatamente os registros que o painel da Vercel exibir ao adicionar o domínio ao projeto)
2. `www` com CNAME para a Vercel + redirect www para apex configurado na própria Vercel
3. Registros de verificação do Resend (SPF, DKIM e MX de retorno): copiar exatamente os valores gerados ao adicionar o domínio no painel do Resend

Não hardcodar IPs ou valores de DNS em código ou docs: os painéis da Vercel e do Resend são a fonte de verdade.

### Rotas públicas x protegidas

1. `/formulario` e `/api/leads/*`: públicas (rate limit básico por IP nos handlers)
2. `/admin/*` e `/api/admin/*`: middleware exigindo sessão Supabase Auth

## 13. Requisitos não funcionais

1. **Mobile-first real.** Viewport de referência: 360px. Cenário principal de uso é o navegador in-app do WhatsApp (testar nele desde o dia 1, ele tem quirks de viewport e teclado).
2. Performance: LCP < 2.5s em 4G na tela de boas-vindas; zero libs pesadas no bundle do form.
3. Transições entre perguntas suaves (slide + fade, 200-300ms), sem layout shift.
4. Geração de PDF em menos de 10s; PDF final abaixo de 5MB.
5. Idioma: 100% pt-BR, incluindo mensagens de erro e formatação de datas.
6. Estética alinhada à marca da Mel: extrair paleta, tipografia e tom diretamente da arte do Figma. O form é a primeira impressão da experiência de contratação.

## 14. Copies prontas

### E-mail ao lead (categorias pessoais)

Assunto: `Sua proposta chegou, {nome_display} ✨ | Mel Simão Storymaker`

```
Oi, {nome_display}!

Que alegria saber que você quer eternizar esse momento 🤍

Sua proposta personalizada está em anexo (e também nesse link, se preferir: {pdf_url}).

Dá uma olhada com carinho e, se pintar qualquer dúvida, é só me chamar no WhatsApp: {link_whatsapp_mel}

Mal posso esperar pra contar essa história com você!

Com carinho,
Mel Simão | Storymaker
```

### E-mail ao lead (corporativo)

Assunto: `Proposta de cobertura ✨ | Mel Simão Storymaker`

```
Olá!

Obrigada pelo interesse da {nome_display} 🤍

A proposta de cobertura do evento está em anexo (e nesse link: {pdf_url}).

Fico à disposição pra alinhar qualquer detalhe pelo WhatsApp: {link_whatsapp_mel}

Até já,
Mel Simão | Storymaker
```

### Mensagem pré-preenchida do botão WhatsApp (painel)

```
Oi, {primeiro_nome}! ✨ Preparei sua proposta com todo carinho. Dá uma olhada aqui: {pdf_url}

Qualquer dúvida, me chama! 🤍
```

Regra do `nome_display`: debutante/aniversariante/noivos/empresa conforme o campo `nome` de cada fluxo. `primeiro_nome` = primeira palavra do `nome_display` (em casamento, usa o primeiro nome do casal).

## 15. Insumos necessários antes de codar (checklist Henrique/Mel)

1. [ ] 5 PDFs base exportados do Figma (com espaços em branco nos campos dinâmicos, < 4MB cada): `debutante`, `aniversario_infantil`, `aniversario_adulto`, `casamento`, `corporativo`
2. [ ] Arquivos .ttf/.otf das fontes da marca
3. [ ] Paleta de cores da marca (hex)
4. [ ] Acesso ao DNS de melstorymaker.com.br no painel do Registro.br
5. [ ] Conta Resend criada, domínio adicionado e API key gerada
6. [ ] Contingência de e-mail: conta Gmail da Mel com 2FA ativo + App Password gerada
7. [ ] Número de WhatsApp da Mel (formato internacional)
8. [ ] E-mail e senha para a conta admin da Mel no Supabase Auth

## 16. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Ajuste fino das coordenadas do texto no PDF consumir tempo | Atraso no D2 | Rota de calibração com grid (item 2 da seção 9); conversão automatizada Figma > pdf-lib |
| PDFs exportados do Figma muito pesados | Anexo rejeitado / e-mail lento | Comprimir imagens no export; fallback: enviar só o link se > 8MB |
| Navegador in-app do WhatsApp com bugs de viewport/teclado | Form quebrado no cenário principal | Testar nele no primeiro deploy, não no último |
| DNS não propagar a tempo (domínio recém-registrado no Registro.br pode levar horas) | Envio pelo Resend bloqueado no Dia 2 | Registros DNS criados logo no Dia 1 de manhã; GmailAdapter pronto como contingência, troca via env MAIL_PROVIDER |
| Texto do lead maior que o espaço da arte (nomes longos) | PDF desalinhado | Auto-shrink de fonte via `maxLargura` |

## 17. Milestones (2 dias)

### Dia 1

Manhã:
1. DNS no Registro.br: apontar melstorymaker.com.br para a Vercel + criar os registros de verificação do Resend (a propagação corre em paralelo ao resto do dia)
2. Setup do repo (Next + TS + Tailwind + shadcn), projeto Supabase, `schema.sql` aplicado, usuária admin criada
3. Route handlers de leads (criar, autosave, submit) com service role

Tarde:
4. Form engine lendo `arvore.json`: telas, progresso, voltar, transições, `exibir_se`
5. Autosave + retomada via localStorage
6. Etapa de contato com validações
7. Deploy inicial na Vercel com o domínio ativo + teste no navegador do WhatsApp

### Dia 2

Manhã:
8. Export dos 4 PDFs base + fontes no repo
9. Pipeline pdf-lib: config de coordenadas, rota de calibração, geração + upload no Storage
10. Admin: login, lista com filtros, detalhe com edição

Tarde:
11. Preview do PDF, envio por e-mail (Resend verificado, ou fallback Gmail via MAIL_PROVIDER), botão wa.me
12. Polimento visual do form (marca da Mel)
13. Teste ponta a ponta das 4 categorias + ramificações
14. Deploy final + walkthrough gravado pra Mel

## 18. Definition of Done

O MVP está pronto quando este cenário roda sem intervenção técnica:

1. Mel envia o link pelo WhatsApp
2. Lead abre no celular, escolhe "Casamento", responde tudo (incluindo making of = Sim) em menos de 2 minutos
3. Lead que abandona no meio aparece no admin como incompleto, com as respostas parciais
4. Lead completo aparece como aguardando revisão
5. Mel loga, corrige um typo no nome dos noivos, gera o PDF e o preview é visualmente idêntico à arte do Figma
6. Mel envia por e-mail: lead recebe com anexo + link
7. Mel clica no botão de WhatsApp e a conversa abre com a mensagem e o link prontos
8. Status do lead vira "enviado" com timestamp
9. Custo de infra do mês: R$ 0

## 19. Roadmap v2 (não implementar agora)

1. Tracking de abertura de e-mail e da proposta (webhooks do Resend)
2. Aceite da proposta na própria página (proposta como link web, PDF como derivado)
3. Contrato e sinal (Stripe/Pix)
4. Notificação de novo lead pra Mel
5. Funil de abandono por etapa pra otimizar as perguntas
6. Precificação dinâmica por pacote no formulário
