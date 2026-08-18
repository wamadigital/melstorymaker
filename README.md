# Sistema de Propostas | Mel Simão Storymaker

Lead preenche o formulário em `/formulario`, o sistema gera o PDF sobre a arte do Figma, a Mel aprova em `/admin` e envia por e-mail + WhatsApp.

Especificação do produto: [PRD.md](PRD.md). Contrato de como trabalhar no repo: [CLAUDE.md](CLAUDE.md).

## Rodar local

```bash
npm install
cp .env.example .env.local      # preencha os valores (ver abaixo)
npm run infra:verificar         # testa cada chave de verdade e diz o que falta
npm run templates:placeholder   # PDFs base provisórios, enquanto a arte real não chega
npm run dev
```

O formulário abre em http://localhost:3000/formulario e o painel em http://localhost:3000/admin.

Mantenha `MAIL_DRY_RUN=1` em desenvolvimento: o e-mail vai para o log em vez da caixa do lead.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Ambiente local |
| `npm run build` | Build de produção — rodar antes de todo commit relevante |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes do engine, formatadores, geometria do PDF, WhatsApp e e-mail |
| `npm run infra:verificar` | Diagnostica o `.env.local`: banco, RLS, bucket, usuária da Mel e SMTP/Resend. Não imprime segredo |
| `npm run e2e:formulario` | Fluxo público completo nas 4 categorias e nas duas ramificações, contra as rotas HTTP reais |
| `npm run e2e:admin -- <email>` | Painel: gera PDF, sobe no Storage e **envia e-mail de verdade** para o endereço informado |
| `npm run bundle:verificar` | Procura os **valores** dos segredos no bundle do navegador (grep por nome dá falso positivo) |
| `npm run arte:preparar -- <template> <pasta>` | Comprime e une as páginas exportadas do Figma numa arte base |
| `npm run vercel:env` | Envia o `.env.local` para a Vercel, com `MAIL_DRY_RUN=0` e `APP_URL` de produção |
| `npm run admin:criar -- <email>` | Cria a usuária do painel já confirmada, com senha forte gerada |
| `npm run templates:placeholder` | Regera os 4 PDFs base provisórios |
| `npm run pdf:verificar` | Gera uma proposta por categoria em `.pdf-verificacao/` e confere os limites do PRD |
| `npm run pdf:verificar -- --grid` | Idem + os PDFs de calibração, sem precisar de sessão |

## Setup da infra (uma vez)

### 1. Supabase

1. Criar o projeto.
2. SQL Editor → colar e rodar [supabase/schema.sql](supabase/schema.sql) inteiro. Ele cria os enums, a tabela `leads`, os índices, liga o RLS **sem policies** e cria o bucket público `propostas`.
3. Authentication → Users → **Add user**: e-mail e senha da Mel. Não existe tela de signup no sistema, e não deve existir.
4. Settings → API: copiar `URL`, `anon key` e `service_role key` para o `.env.local`.

> A tabela `leads` tem RLS ligado e nenhuma policy. Isso é proposital: todo acesso passa por route handlers usando a service role. Se algo falhar por RLS, a correção é no route handler — nunca criar policy pública.

### 2. Resend

1. Criar a conta e adicionar o domínio `melstorymaker.com.br`.
2. Copiar os registros DNS que o painel exibir (SPF, DKIM e MX de retorno) para o Registro.br. **Não** hardcodar valores: o painel do Resend é a fonte de verdade.
3. Gerar a API key → `RESEND_API_KEY`.
4. `MAIL_REPLY_TO` = Gmail que a Mel já usa. Não é preciso criar caixa de e-mail no domínio: o Resend só precisa do domínio verificado para enviar, e as respostas voltam pelo reply-to.

Se o DNS não verificar a tempo, a contingência já está pronta: `MAIL_PROVIDER=gmail` com `GMAIL_USER` + `GMAIL_APP_PASSWORD` (exige 2FA ativo na conta Google). Zero mudança de código.

### 3. Vercel

Projeto: `melstorymaker`, no time `wamadigitals-projects`.

```bash
vercel login       # uma vez, abre o navegador
npm run vercel:env # envia as variáveis do .env.local
vercel --prod --scope wamadigitals-projects
```

O `vercel:env` aplica dois overrides de propósito: `MAIL_DRY_RUN=0` (em produção o e-mail sai de verdade) e `APP_URL` apontando para o domínio final. As `NEXT_PUBLIC_*` vão também para preview e development — sem isso o build de preview gera bundle sem a URL do Supabase.

Domínio: **Settings → Domains → Add**. A Vercel mostra na hora os registros a criar no Registro.br (DNS → Editar Zona). Não hardcodar esses valores em lugar nenhum: o painel é a fonte de verdade.

## Como está organizado

```
app/formulario         Form público multi-etapas
app/admin              Login, lista, detalhe, rota de calibração
app/api/leads          Endpoints públicos: criar, retomar, autosave, submit
app/api/admin          Endpoints protegidos: salvar, gerar-pdf, enviar
lib/form               arvore.json + engine + validação
lib/pdf                templates.config.ts, gerar.ts, geometria, grid, formatadores
lib/mail               adapter.ts + resend.ts + gmail.ts + templates (copies do PRD)
lib/supabase           admin.ts (service role), server.ts e client.ts (só sessão)
assets/templates       PDFs base exportados do Figma
assets/fonts           Fontes da marca (.ttf)
supabase/schema.sql    Schema completo
```

## Calibrar um template

Ordem obrigatória — a rota de grid existe para não calibrar no olho:

1. Colocar o PDF exportado do Figma em `assets/templates/{categoria}.pdf` e as fontes em `assets/fonts/`.
2. Abrir `/admin/debug-template?categoria=casamento`. O PDF vem com grid a cada 20pt, rótulos a cada 100pt e os campos atuais desenhados com dado de exemplo.
3. Ler as coordenadas e ajustar [lib/pdf/templates.config.ts](lib/pdf/templates.config.ts).

Os rótulos do eixo Y trazem duas leituras: **`f`** é a coordenada como o Figma mostra (origem no topo) e **`p`** é a do pdf-lib (origem embaixo). Cada template declara em qual sistema seus números estão, no campo `origemCoordenadas` — o valor lido direto do grid é `"pdf"`, o copiado do painel do Figma é `"figma"`.

Se o frame do Figma não tiver as mesmas dimensões da página exportada, ajuste `escala` (= largura da página em pt ÷ largura do frame). Ela se aplica a x, y e ao tamanho da fonte.

Mudança de arte sai em PR dedicada contendo só assets + `templates.config.ts`.
